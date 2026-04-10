import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CheckResult, RuleMatch } from "../core/types.js";

export interface LlmCoreConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface LlmRoutingDecision {
  shouldRoute: boolean;
  reason: string;
  confidenceFloor: number;
  ambiguousMatchCount: number;
  matchCount: number;
  triggers: string[];
  routeTarget: "motor" | "jandaia_1";
}

export interface LlmCoreSuggestion {
  correctedText: string;
  latencyMs: number;
  model: string;
}

export interface JandaiaArchitectureProfile {
  runtimeMode: string;
  primaryRole: string;
  instructors: string[];
  externalAdvisor: string;
  correctionStyle: string[];
  executionPolicy: {
    strategy: string;
    serviceLevelBudgetMs: number;
    simpleCasesLayer: string;
    complexCasesLayer: string;
  };
}

export interface JandaiaRuntimeReadiness {
  baseProfile: string;
  configuredModel: string;
  localModelFilePresent: boolean;
  ollamaReachable: boolean;
  llmCoreEnabled: boolean;
  configuredModelPresent: boolean;
  readyForActivation: boolean;
  localModelPath: string;
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "jandaia-1";
const DEFAULT_TIMEOUT_MS = 15_000;
const BASE_PROFILE_PATH = path.join(process.cwd(), "data", "ai", "jandaia-base-profiles.json");

function readBaseProfileConfig(env: NodeJS.ProcessEnv = process.env): { id: string; localModelCandidates: string[] } {
  const raw = JSON.parse(readFileSync(BASE_PROFILE_PATH, "utf8")) as {
    preferredProfile?: string;
    profiles?: Record<string, { localModelCandidates?: string[] }>;
  };
  const profileId = env.CORRIJA_ME_JANDAIA_BASE_PROFILE || raw.preferredProfile || "qwen2_5_1_5b";
  const profile = raw.profiles?.[profileId];

  if (!profile) {
    return {
      id: profileId,
      localModelCandidates: []
    };
  }

  return {
    id: profileId,
    localModelCandidates: Array.isArray(profile.localModelCandidates)
      ? profile.localModelCandidates.map((candidate) => path.join(process.cwd(), candidate))
      : []
  };
}

function resolveLocalModelPath(env: NodeJS.ProcessEnv = process.env): string {
  const profile = readBaseProfileConfig(env);
  return profile.localModelCandidates.find((candidate) => existsSync(candidate)) || profile.localModelCandidates[0] || "";
}
const MIN_ROUTE_TEXT_LENGTH = 12;
const MAX_ROUTE_TEXT_LENGTH = 280;
const MIN_ROUTE_WORD_COUNT = 3;
const HOMOPHONE_TRIGGER_PATTERN = /\b(?:sess[aã]o|se[cç][aã]o|cess[aã]o|concerto|conserto|concertar|consertar|taxar|tachar|ratificar|retificar|infligir|infringir|onde|aonde|porque|por que|porquê|por quê)\b/iu;
const JANDAIA_DIRECTIVE = [
  "Você é jandaia 1, especialista em correção de português do Brasil.",
  "Sua tarefa é corrigir a frase com a MENOR quantidade de mudanças possível.",
  "Preserve o sentido original, a estrutura da frase e as palavras já corretas.",
  "Não reescreva por estilo, não resuma, não melhore fluidez e não troque palavras por sinônimos.",
  "Não invente detalhes, não acrescente informação e não remova conteúdo.",
  "Se a frase já estiver correta, devolva a mesma frase.",
  "Responda somente com JSON válido em uma única linha.",
  "Formato obrigatório: {\"final\":\"FRASE_CORRIGIDA\",\"changed\":true}.",
  "Não escreva nada antes ou depois do JSON."
].join("\n");

function buildJandaiaPrompt(text: string): string {
  return [
    JANDAIA_DIRECTIVE,
    "",
    "Exemplos:",
    "Errada: A gente vamos no cinema amanhã.",
    "{\"final\":\"A gente vai ao cinema amanhã.\",\"changed\":true}",
    "",
    "Errada: A seção de cinema começa às 20h.",
    "{\"final\":\"A sessão de cinema começa às 20h.\",\"changed\":true}",
    "",
    "Errada: Ele não sabe porque você faltou.",
    "{\"final\":\"Ele não sabe por que você faltou.\",\"changed\":true}",
    "",
    "Errada: Os dois garotos foi na rua comprar pão mas eles não lembro do dinheiro e esqueceu a chave de casa.",
    "{\"final\":\"Os dois garotos foram à rua comprar pão, mas eles não se lembraram do dinheiro e esqueceram a chave de casa.\",\"changed\":true}",
    "",
    "Agora corrija apenas a frase abaixo.",
    `Errada: ${text}`,
    "{\"final\":"
  ].join("\n");
}

function looksLikeCleanSentence(text: string): boolean {
  if (!text) {
    return false;
  }

  if (/[<>{}\[\]]/u.test(text)) {
    return false;
  }

  if (/\b(?:resposta|instruction|instrução|prompt|correta:|errada:)\b/iu.test(text)) {
    return false;
  }

  if (text.length < 3 || text.length > 280) {
    return false;
  }

  const letterCount = (text.match(/\p{L}/gu) || []).length;
  if (letterCount < 2) {
    return false;
  }

  const weirdPunctuationCount = (text.match(/["`]/gu) || []).length;
  if (weirdPunctuationCount > 2) {
    return false;
  }

  return true;
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on", "sim"].includes(value.trim().toLowerCase());
}

function normalizeGeneratedText(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/u);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { final?: string };
      const structuredFinal = String(parsed?.final || "").trim();
      if (looksLikeCleanSentence(structuredFinal)) {
        return structuredFinal;
      }
    } catch {
      // fallback below
    }
  }

  const cleaned = text
    .trim()
    .replace(/<[^>]+>/gu, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^corrigida:\s*/iu, "")
    .replace(/^frase corrigida:\s*/iu, "")
    .replace(/^correta:\s*/iu, "")
    .trim();

  const firstLine = cleaned.split(/\r?\n/u)[0]?.trim() || "";
  if (!looksLikeCleanSentence(firstLine)) {
    return "";
  }

  return firstLine;
}

export function readJandaiaArchitectureProfile(): JandaiaArchitectureProfile {
  return {
    runtimeMode: "motor_first_with_budgeted_specialized_llm_fallback",
    primaryRole: "fallback_qualificado_pt_br",
    instructors: ["tucano_2", "quillbot"],
    externalAdvisor: "gemini",
    correctionStyle: [
      "preservar_sentido",
      "menor_correcao_suficiente",
      "evitar_sofisticacao_desnecessaria",
      "priorizar_pt_br_natural"
    ],
    executionPolicy: {
      strategy: "motor_imediato_com_jandaia_orcada_em_segundo_plano",
      serviceLevelBudgetMs: DEFAULT_TIMEOUT_MS,
      simpleCasesLayer: "motor",
      complexCasesLayer: "jandaia_1"
    }
  };
}

export function readLlmCoreConfig(env: NodeJS.ProcessEnv = process.env): LlmCoreConfig {
  return {
    enabled: parseBooleanFlag(env.CORRIJA_ME_LLM_CORE_ENABLED),
    baseUrl: (env.CORRIJA_ME_LLM_CORE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/u, ""),
    model: env.CORRIJA_ME_LLM_CORE_MODEL || DEFAULT_OLLAMA_MODEL,
    timeoutMs: Number(env.CORRIJA_ME_LLM_CORE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

export async function checkLlmCoreHealth(config: LlmCoreConfig): Promise<{ reachable: boolean; model: string; version?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 10_000));
    const response = await fetch(`${config.baseUrl}/api/version`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        reachable: false,
        model: config.model,
        error: `http_${response.status}`
      };
    }

    const payload = await response.json() as { version?: string };
    return {
      reachable: true,
      model: config.model,
      version: payload.version || "unknown"
    };
  } catch (error) {
    return {
      reachable: false,
      model: config.model,
      error: error instanceof Error ? error.message : "llm_core_unreachable"
    };
  }
}

export async function readJandaiaRuntimeReadiness(config: LlmCoreConfig): Promise<JandaiaRuntimeReadiness> {
  const health = await checkLlmCoreHealth(config);
  const baseProfile = readBaseProfileConfig().id;
  const resolvedLocalModelPath = resolveLocalModelPath();
  const localModelFilePresent = existsSync(resolvedLocalModelPath);
  let configuredModelPresent = false;

  if (health.reachable) {
    try {
      const response = await fetch(`${config.baseUrl}/api/tags`);
      if (response.ok) {
        const payload = await response.json() as { models?: Array<{ name?: string }> };
        configuredModelPresent = Array.isArray(payload.models)
          && payload.models.some((entry) => String(entry?.name || "").startsWith(`${config.model}:`));
      }
    } catch {
      configuredModelPresent = false;
    }
  }

  return {
    baseProfile,
    configuredModel: config.model,
    localModelFilePresent,
    ollamaReachable: Boolean(health.reachable),
    llmCoreEnabled: config.enabled,
    configuredModelPresent,
    readyForActivation: config.enabled && Boolean(health.reachable) && configuredModelPresent,
    localModelPath: resolvedLocalModelPath
  };
}

export function decideLlmRouting(text: string, result: CheckResult): LlmRoutingDecision {
  const normalizedText = text.trim();
  const wordCount = (normalizedText.match(/[\p{L}\p{N}]+/gu) || []).length;
  const matchCount = result.matches.length;
  const confidenceScores = result.matches
    .map((match) => match.confidence?.score)
    .filter((score): score is number => typeof score === "number");
  const confidenceFloor = confidenceScores.length ? Math.min(...confidenceScores) : 0;
  const ambiguousMatchCount = result.matches.filter((match) => (match.replacements?.length || 0) > 1).length;
  const hasHomophoneTrigger = HOMOPHONE_TRIGGER_PATTERN.test(text);
  const hasWholeTextMatch = result.matches.some((match) => match.offset === 0 && match.length === normalizedText.length);
  const hasMultiPassMatch = result.matches.some((match) => match.rule?.id === "PT_BR_MULTI_PASS");
  const triggers: string[] = [];

  if (normalizedText.length < MIN_ROUTE_TEXT_LENGTH || wordCount < MIN_ROUTE_WORD_COUNT) {
    return {
      shouldRoute: false,
      reason: "texto_curto_ou_pouco_informativo",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "motor"
    };
  }

  if (normalizedText.length > MAX_ROUTE_TEXT_LENGTH) {
    return {
      shouldRoute: false,
      reason: "texto_grande_demais_para_fallback",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "motor"
    };
  }

  if (!matchCount) {
    triggers.push("motor_sem_saida");
    return {
      shouldRoute: true,
      reason: "motor_sem_saida",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }

  if (hasHomophoneTrigger && (confidenceFloor < 0.96 || ambiguousMatchCount > 0)) {
    triggers.push("homofono_ou_contexto_ambiguo");
    return {
      shouldRoute: true,
      reason: "homofono_ou_contexto_ambiguo",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }

  if (confidenceFloor < 0.85) {
    triggers.push("confianca_baixa");
    return {
      shouldRoute: true,
      reason: "confianca_baixa",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }

  if (matchCount >= 3) {
    triggers.push("muitas_edicoes_acopladas");
    return {
      shouldRoute: true,
      reason: "muitas_edicoes_acopladas",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }

  if (ambiguousMatchCount > 0) {
    triggers.push("candidatos_competindo");
    return {
      shouldRoute: true,
      reason: "candidatos_competindo",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }

  if (hasWholeTextMatch && confidenceFloor < 0.94) {
    triggers.push("correcao_integral_com_confianca_intermediaria");
    return {
      shouldRoute: true,
      reason: "correcao_integral_com_confianca_intermediaria",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }

  if (hasMultiPassMatch && confidenceFloor < 0.95) {
    triggers.push("consolidacao_multipla_passagem");
    return {
      shouldRoute: true,
      reason: "consolidacao_multipla_passagem",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }

  return {
    shouldRoute: false,
    reason: "motor_confiavel",
    confidenceFloor,
    ambiguousMatchCount,
    matchCount,
    triggers,
    routeTarget: "motor"
  };
}

export async function requestLlmCoreSuggestion(text: string, config: LlmCoreConfig): Promise<LlmCoreSuggestion | null> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        options: {
          temperature: 0,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.35,
          num_predict: 80,
          stop: ["}\n", "\n\n"]
        },
        prompt: buildJandaiaPrompt(text)
      })
    });

    if (!response.ok) {
      throw new Error(`llm_core_http_${response.status}`);
    }

    const payload = await response.json() as { response?: string };
    const correctedText = normalizeGeneratedText(payload.response || "");
    if (!correctedText) {
      return null;
    }

    return {
      correctedText,
      latencyMs: Date.now() - startedAt,
      model: config.model
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildWholeTextLlmMatch(text: string, correctedText: string, reason: string): RuleMatch {
  return {
    message: "Sugestão do núcleo local para pt-BR.",
    shortMessage: "Sugestão do núcleo local.",
    offset: 0,
    length: text.length,
    replacements: [{ value: correctedText }],
    confidence: {
      level: "medium",
      score: 0.74,
      reason
    },
    rule: {
      id: "PT_BR_LLM_CORE",
      description: "Correção integral sugerida pela camada local de IA.",
      issueType: "misspelling"
    },
    context: {
      text,
      offset: 0,
      length: text.length
    }
  };
}
