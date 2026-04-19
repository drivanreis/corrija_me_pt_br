import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { GoogleGenAI } from "@google/genai";

const DEFAULT_CASE_FILE = "test/bravo-cases.json";
const DEFAULT_TARGET = 100;
const DEFAULT_BATCH_SIZE = 20;
const GENERATION_TIMEOUT_MS = 90_000;
const MODEL_CANDIDATES = [
  "gemini-2.5-flash"
];
const DEFAULT_COMPLEXITY = "normal"; // normal | hard

function parseArgs(argv) {
  const args = {
    caseFile: DEFAULT_CASE_FILE,
    target: DEFAULT_TARGET,
    batch: DEFAULT_BATCH_SIZE,
    model: "",
    maxRounds: 12,
    excludeFiles: [],
    complexity: DEFAULT_COMPLEXITY
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--case-file" && next) {
      args.caseFile = next;
      index += 1;
    } else if (current === "--target" && next) {
      args.target = Number(next);
      index += 1;
    } else if (current === "--batch" && next) {
      args.batch = Number(next);
      index += 1;
    } else if (current === "--model" && next) {
      args.model = next;
      index += 1;
    } else if (current === "--max-rounds" && next) {
      args.maxRounds = Number(next);
      index += 1;
    } else if (current === "--exclude-file" && next) {
      args.excludeFiles.push(next);
      index += 1;
    } else if (current === "--complexity" && next) {
      args.complexity = next;
      index += 1;
    }
  }

  if (!Number.isInteger(args.target) || args.target < 10 || args.target > 500) {
    throw new Error("--target deve ser um inteiro entre 10 e 500.");
  }

  if (!Number.isInteger(args.batch) || args.batch < 1 || args.batch > 50) {
    throw new Error("--batch deve ser um inteiro entre 1 e 50.");
  }

  if (!Number.isInteger(args.maxRounds) || args.maxRounds < 1 || args.maxRounds > 40) {
    throw new Error("--max-rounds deve ser um inteiro entre 1 e 40.");
  }

  if (!["normal", "hard"].includes(args.complexity)) {
    throw new Error("--complexity deve ser normal|hard.");
  }

  return args;
}

async function readJsonArray(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("[");
    if (start === -1) {
      throw new Error("Não foi possível localizar um array JSON na resposta do Gemini.");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(candidate.slice(start, index + 1));
        }
      }
    }

    throw new Error("Não foi possível isolar um array JSON válido na resposta do Gemini.");
  }
}

function normalizeChallenge(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function isValidSentence(text) {
  const value = String(text || "").trim();
  if (!value || value.length < 10 || value.length > 220) {
    return false;
  }
  if (/[<>{}\[\]]/u.test(value)) {
    return false;
  }
  const letterCount = (value.match(/\p{L}/gu) || []).length;
  return letterCount >= 6;
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") {
    throw new Error("Item inválido recebido do Gemini.");
  }

  const challenge = normalizeChallenge(item.challenge);
  const errado = String(item.errado || "").trim();
  const esperado = String(item.esperado || "").trim();

  if (!challenge) {
    throw new Error("Item sem challenge válido.");
  }
  if (!isValidSentence(errado) || !isValidSentence(esperado)) {
    throw new Error("Item com errado/esperado inválidos.");
  }

  return { challenge, errado, esperado };
}

function buildPrompt({ count, existingChallenges, complexity }) {
  const challengeBlock = existingChallenges.length
    ? `Desafios já usados (NÃO repetir): ${existingChallenges.slice(0, 120).join(", ")}`
    : "Ainda não há desafios usados.";

  const complexityRules = complexity === "hard"
    ? `Complexidade (HARD):
- Frases com 18 a 38 palavras e pelo menos 2 orações (ex.: oração subordinada/relativa).
- Use pontuação realista (vírgulas, travessões ou ponto e vírgula quando fizer sentido).
- Evite casos triviais de 1 palavra (ex.: apenas acento em uma palavra isolada).
- Prefira 2 a 4 erros por frase, com um desafio principal bem claro.`
    : `Complexidade (NORMAL):
- Prefira 1 a 3 erros por frase, com um desafio principal bem claro.`;

  return `Você está ajudando a criar um teste BRAVO (pt-BR) para um corretor local.

Gere exatamente ${count} itens em JSON puro (array), sem markdown e sem texto fora do JSON.

Objetivo do BRAVO:
- Cada item precisa ter um "Desafio Principal" DIFERENTE (um por item).
- O desafio deve ser nomeado em snake_case curto no campo "challenge".
- O campo "errado" deve conter uma frase com erro(s) plausíveis de pt-BR.
- O campo "esperado" deve conter a correção com a MENOR correção suficiente (não reescrever por estilo).
- Preserve o sentido e não invente informação.
- Evite conteúdo ofensivo, político, sensível ou nomes próprios reais.
- Evite frases artificiais e evite repetir ideias.

Regras importantes:
- "challenge" deve ser ÚNICO dentro do seu array e também não pode repetir nenhum desafio já usado.
- Não reescreva a frase por estilo; corrija apenas o necessário.
- Misture fenômenos: crase, concordância, regência, pronomes, porquês, homófonos, pontuação, colocação pronominal, tempos verbais, hífen, acentuação, pluralização, "aonde/onde", etc.

${complexityRules}

${challengeBlock}

Formato obrigatório de cada item:
{
  "challenge": "slug_unico",
  "errado": "frase com erro",
  "esperado": "frase corrigida"
}

Responda com um array JSON válido.`;
}

async function readApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  const envPath = path.resolve(process.cwd(), ".env");
  try {
    const rawEnv = (await fs.readFile(envPath, "utf8")).trim();
    if (rawEnv && !rawEnv.includes("=")) {
      return rawEnv;
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  return "";
}

function nextId(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const match = String(id || "").match(/bravo-(\d+)/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }
  return max + 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = await readApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não encontrado (env ou .env).");
  }

  const cases = await readJsonArray(args.caseFile);
  const normalizedExisting = cases
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id || "").trim(),
      challenge: normalizeChallenge(entry.challenge),
      errado: String(entry.errado || "").trim(),
      esperado: String(entry.esperado || "").trim()
    }))
    .filter((entry) => entry.challenge && entry.errado && entry.esperado);

  const existingChallenges = new Set(normalizedExisting.map((entry) => entry.challenge));
  const existingPairs = new Set(normalizedExisting.map((entry) => `${entry.errado}|||${entry.esperado}`));
  const existingIds = new Set(normalizedExisting.map((entry) => entry.id));

  for (const excludeFile of args.excludeFiles) {
    const excluded = await readJsonArray(excludeFile);
    for (const entry of excluded) {
      if (!entry || typeof entry !== "object") continue;
      const challenge = normalizeChallenge(entry.challenge);
      const errado = String(entry.errado || "").trim();
      const esperado = String(entry.esperado || "").trim();
      if (challenge) {
        existingChallenges.add(challenge);
      }
      if (errado && esperado) {
        existingPairs.add(`${errado}|||${esperado}`);
      }
    }
  }

  const missing = Math.max(0, args.target - normalizedExisting.length);
  if (!missing) {
    console.log(`OK: já existem ${normalizedExisting.length} casos em ${args.caseFile}.`);
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelCandidates = args.model ? [args.model] : MODEL_CANDIDATES;

  let cursorId = nextId(existingIds);
  let rounds = 0;
  let modelIndex = 0;

  async function persistCases() {
    await fs.mkdir(path.dirname(args.caseFile), { recursive: true });
    await fs.writeFile(args.caseFile, `${JSON.stringify(normalizedExisting, null, 2)}\n`, "utf8");
  }

  while (normalizedExisting.length < args.target && rounds < args.maxRounds) {
    rounds += 1;
    const remaining = args.target - normalizedExisting.length;
    const batchCount = Math.min(args.batch, remaining);
    const prompt = buildPrompt({
      count: batchCount,
      existingChallenges: [...existingChallenges],
      complexity: args.complexity
    });

    const model = modelCandidates[modelIndex % modelCandidates.length];

    let response;
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: prompt
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), GENERATION_TIMEOUT_MS))
      ]);
    } catch (error) {
      // Salva o que já foi obtido, para não perder progresso.
      await persistCases();

      // Falha comum: limite/quotas. Mantém mensagem clara pro operador.
      const message = error instanceof Error ? error.message : String(error);
      if (/RESOURCE_EXHAUSTED|quota|429|rate/i.test(message)) {
        throw new Error(`Gemini quota/rate limit: ${message}\nProgresso salvo em ${args.caseFile}. Reexecute depois (ou com --model).`);
      }
      throw error;
    }

    modelIndex += 1;

    const rawText = response?.text ?? "";
    const parsed = extractJson(rawText);
    if (!Array.isArray(parsed)) {
      throw new Error("Resposta do Gemini não foi um array JSON.");
    }

    const batch = [];
    for (const item of parsed) {
      try {
        const normalized = normalizeItem(item);
        if (existingChallenges.has(normalized.challenge)) {
          continue;
        }
        const key = `${normalized.errado}|||${normalized.esperado}`;
        if (existingPairs.has(key)) {
          continue;
        }
        batch.push(normalized);
        existingChallenges.add(normalized.challenge);
        existingPairs.add(key);
      } catch {
        // ignora item ruim
      }
    }

    for (const item of batch) {
      const id = `bravo-${String(cursorId).padStart(3, "0")}`;
      cursorId += 1;
      normalizedExisting.push({
        id,
        challenge: item.challenge,
        errado: item.errado,
        esperado: item.esperado
      });
    }

    console.log(`Rodada ${rounds}: +${batch.length} (total=${normalizedExisting.length}/${args.target}) usando ${model}`);
    await persistCases();
  }

  if (normalizedExisting.length < args.target) {
    throw new Error(`Não foi possível chegar em ${args.target} casos. Total atual: ${normalizedExisting.length}.`);
  }

  await persistCases();
  console.log(`OK: atualizado ${args.caseFile} com ${normalizedExisting.length} casos.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
