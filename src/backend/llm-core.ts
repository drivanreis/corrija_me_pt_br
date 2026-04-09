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
}

export interface LlmCoreSuggestion {
  correctedText: string;
  latencyMs: number;
  model: string;
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "jandaia-1";
const DEFAULT_TIMEOUT_MS = 120_000;
const HOMOPHONE_TRIGGER_PATTERN = /\b(?:sess[aã]o|se[cç][aã]o|cess[aã]o|concerto|conserto|concertar|consertar|taxar|tachar|ratificar|retificar|infligir|infringir|onde|aonde|porque|por que|porquê|por quê)\b/iu;
const JANDAIA_DIRECTIVE = [
  "Você é jandaia 1, especialista em correção de português do Brasil.",
  "Corrija a frase preservando o sentido original.",
  "Prefira a menor correção suficiente.",
  "Responda somente com a frase corrigida final.",
  "Não explique, não use rótulos e não use marcação."
].join("\n");

function buildJandaiaPrompt(text: string): string {
  return [
    JANDAIA_DIRECTIVE,
    "",
    "Exemplos:",
    "Errada: A gente vamos no cinema amanhã.",
    "Correta: A gente vai ao cinema amanhã.",
    "",
    "Errada: A seção de cinema começa às 20h.",
    "Correta: A sessão de cinema começa às 20h.",
    "",
    "Errada: Ele não sabe porque você faltou.",
    "Correta: Ele não sabe por que você faltou.",
    "",
    "Agora corrija apenas a frase abaixo.",
    `Errada: ${text}`,
    "Correta:"
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

export function decideLlmRouting(text: string, result: CheckResult): LlmRoutingDecision {
  const confidenceScores = result.matches
    .map((match) => match.confidence?.score)
    .filter((score): score is number => typeof score === "number");
  const confidenceFloor = confidenceScores.length ? Math.min(...confidenceScores) : 0;
  const ambiguousMatchCount = result.matches.filter((match) => (match.replacements?.length || 0) > 1).length;
  const hasHomophoneTrigger = HOMOPHONE_TRIGGER_PATTERN.test(text);

  if (!result.matches.length) {
    return {
      shouldRoute: true,
      reason: "motor_sem_saida",
      confidenceFloor,
      ambiguousMatchCount
    };
  }

  if (hasHomophoneTrigger && (confidenceFloor < 0.96 || ambiguousMatchCount > 0)) {
    return {
      shouldRoute: true,
      reason: "homofono_ou_contexto_ambiguo",
      confidenceFloor,
      ambiguousMatchCount
    };
  }

  if (confidenceFloor < 0.85) {
    return {
      shouldRoute: true,
      reason: "confianca_baixa",
      confidenceFloor,
      ambiguousMatchCount
    };
  }

  if (result.matches.length >= 3) {
    return {
      shouldRoute: true,
      reason: "muitas_edicoes_acopladas",
      confidenceFloor,
      ambiguousMatchCount
    };
  }

  if (ambiguousMatchCount > 0) {
    return {
      shouldRoute: true,
      reason: "candidatos_competindo",
      confidenceFloor,
      ambiguousMatchCount
    };
  }

  return {
    shouldRoute: false,
    reason: "motor_confiavel",
    confidenceFloor,
    ambiguousMatchCount
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
          temperature: 0.05,
          top_k: 40,
          top_p: 0.9,
          repeat_penalty: 1.25,
          num_predict: 96
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
