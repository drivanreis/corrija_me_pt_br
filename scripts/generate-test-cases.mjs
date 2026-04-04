import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { GoogleGenAI } from "@google/genai";

const DEFAULT_OUTPUT = "data/test-cases/generated.json";
const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-3-flash-preview"
];
const GENERATION_TIMEOUT_MS = 90000;
const VALID_CATEGORIES = [
  "ortografia",
  "acentuacao",
  "hifen",
  "pontuacao",
  "localizacao",
  "contexto",
  "homofonos",
  "anuncios",
  "texto_tecnico",
  "misto"
];
const MAX_DIFFICULTY = 6;

function parseArgs(argv) {
  const args = {
    category: "misto",
    categories: [],
    count: 12,
    countPerCategory: null,
    difficulty: 3,
    output: DEFAULT_OUTPUT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--category" && next) {
      args.category = next;
      index += 1;
    } else if (current === "--categories" && next) {
      args.categories = next.split(",").map((entry) => entry.trim()).filter(Boolean);
      index += 1;
    } else if (current === "--count" && next) {
      args.count = Number(next);
      index += 1;
    } else if (current === "--count-per-category" && next) {
      args.countPerCategory = Number(next);
      index += 1;
    } else if (current === "--difficulty" && next) {
      args.difficulty = Number(next);
      index += 1;
    } else if (current === "--output" && next) {
      args.output = next;
      index += 1;
    }
  }

  if (!VALID_CATEGORIES.includes(args.category)) {
    throw new Error(`Categoria inválida: ${args.category}. Use uma destas: ${VALID_CATEGORIES.join(", ")}`);
  }

  if (args.categories.length) {
    const invalidCategories = args.categories.filter((entry) => !VALID_CATEGORIES.includes(entry));
    if (invalidCategories.length) {
      throw new Error(`Categorias inválidas: ${invalidCategories.join(", ")}. Use apenas: ${VALID_CATEGORIES.join(", ")}`);
    }
  }

  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 50) {
    throw new Error("O parâmetro --count deve ser um inteiro entre 1 e 50.");
  }

  if (args.countPerCategory !== null && (!Number.isInteger(args.countPerCategory) || args.countPerCategory < 1 || args.countPerCategory > 50)) {
    throw new Error("O parâmetro --count-per-category deve ser um inteiro entre 1 e 50.");
  }

  if (!Number.isInteger(args.difficulty) || args.difficulty < 1 || args.difficulty > MAX_DIFFICULTY) {
    throw new Error(`O parâmetro --difficulty deve ser um inteiro entre 1 e ${MAX_DIFFICULTY}.`);
  }

  return args;
}

function buildPrompt({ category, categories, count, countPerCategory, difficulty }) {
  const activeCategories = categories.length ? categories : [category];
  const perCategoryCount = countPerCategory ?? count;
  const minErrorCount = difficulty >= 2 ? 2 : 1;
  const categoryInstructions = activeCategories.length === 1
    ? `- Categoria principal: ${activeCategories[0]}`
    : `- Distribua os itens igualmente entre estas categorias: ${activeCategories.join(", ")}
- Gere exatamente ${perCategoryCount} itens por categoria`;

  return `Você está ajudando a montar um banco curado de casos de teste para um corretor ortográfico e gramatical pt-BR.

Gere exatamente ${activeCategories.length * perCategoryCount} itens em JSON puro, sem markdown, sem explicações, sem texto antes e sem texto depois.

Regras:
${categoryInstructions}
- Dificuldade alvo: ${difficulty} numa escala de 1 a ${MAX_DIFFICULTY}
- Produza frases úteis para testes reais de correção textual em pt-BR.
- Misture contextos de mensagens, anúncios, textos profissionais e uso cotidiano quando fizer sentido.
- Cada item deve ter erro(s) reais e plausíveis.
- O campo "errado" deve conter o texto com erro.
- O campo "correto" deve conter a forma revisada esperada.
- O campo "error_count" deve estimar quantos erros conhecidos existem no texto errado.
- Para dificuldade ${difficulty}, cada item deve ter no mínimo ${minErrorCount} erro(s) real(is).
- Para dificuldade 2 ou maior, prefira frases com múltiplos erros combinados na mesma frase.
- O campo "tags" deve ser um array curto com 2 a 5 tags relevantes.
- Evite repetir ideias.
- Evite frases artificiais demais.
- Não inclua conteúdo ofensivo, político ou sensível.

Formato obrigatório de cada item:
{
  "id": "gerado_sem_uuid_pode_usar_slug_curto",
  "category": "${activeCategories[0]}",
  "difficulty": ${difficulty},
  "errado": "texto com erro",
  "correto": "texto corrigido",
  "error_count": ${Math.max(2, minErrorCount)},
  "tags": ["tag1", "tag2"]
}

Responda com um array JSON válido.`;
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
      throw new Error("Não foi possível localizar o início de um array JSON na resposta do Gemini.");
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

function normalizeItem(item, fallbackCategory, fallbackDifficulty) {
  if (!item || typeof item !== "object") {
    throw new Error("Item inválido recebido do Gemini.");
  }

  const errado = String(item.errado || "").trim();
  const correto = String(item.correto || "").trim();

  if (!errado || !correto) {
    throw new Error("Cada item precisa de 'errado' e 'correto'.");
  }

  const tags = Array.isArray(item.tags)
    ? item.tags.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 5)
    : [];

  return {
    id: String(item.id || `${fallbackCategory}-${Date.now()}`).trim(),
    category: VALID_CATEGORIES.includes(item.category) ? item.category : fallbackCategory,
    difficulty: Number.isInteger(item.difficulty) ? item.difficulty : fallbackDifficulty,
    errado,
    correto,
    error_count: Number.isInteger(item.error_count) ? item.error_count : fallbackDifficulty >= 2 ? 2 : 1,
    tags
  };
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

function dedupeCases(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.errado}|||${item.correto}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = await readApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não encontrada. Use 'GEMINI_API_KEY=...' no .env ou deixe apenas a chave bruta na primeira linha.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const requestedCategories = args.categories.length ? args.categories : [args.category];
  const prompt = buildPrompt({
    ...args,
    categories: requestedCategories
  });
  let response = null;
  let lastError = null;

  for (const model of MODEL_CANDIDATES) {
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: prompt
        }),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Timeout ao gerar conteúdo com ${model} após ${GENERATION_TIMEOUT_MS}ms.`));
          }, GENERATION_TIMEOUT_MS);
        })
      ]);
      console.log(`Modelo usado: ${model}`);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!response) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const batches = extractJson(response.text).map((item) =>
    normalizeItem(item, requestedCategories[0], args.difficulty)
  );

  const outputPath = path.resolve(process.cwd(), args.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const existingItems = await readJsonArray(outputPath);
  const mergedItems = dedupeCases([...existingItems, ...batches]);

  await fs.writeFile(outputPath, `${JSON.stringify(mergedItems, null, 2)}\n`, "utf8");

  console.log(`Categorias processadas: ${requestedCategories.join(", ")}`);
  console.log(`Casos gerados nesta execução: ${batches.length}`);
  console.log(`Arquivo atualizado: ${outputPath}`);
  console.log(`Total após deduplicação: ${mergedItems.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
