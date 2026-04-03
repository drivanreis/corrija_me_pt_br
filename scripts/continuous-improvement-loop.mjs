import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { GoogleGenAI } from "@google/genai";

const DEFAULT_AUDIT = "data/test-cases/latest-audit.json";
const DEFAULT_OUTPUT = "data/rules/phrase_rules_continuous.json";
const TOKEN_PATTERN = /(?<![\p{L}\p{N}\p{M}])[\p{L}][\p{L}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;

function parseArgs(argv) {
  const args = {
    audit: DEFAULT_AUDIT,
    output: DEFAULT_OUTPUT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--audit" && next) {
      args.audit = next;
      index += 1;
    } else if (current === "--output" && next) {
      args.output = next;
      index += 1;
    }
  }

  return args;
}

function toTokens(text) {
  return [...text.matchAll(TOKEN_PATTERN)].map((match) => match[0]);
}

function stripTerminalPunctuation(text) {
  return text.replace(/[.!?]\s*$/u, "").trim();
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function collectFailedItems(audit) {
  const failed = [];

  for (const phase of audit.phases || []) {
    for (const item of phase.items || []) {
      if ((item.remaining_errors || 0) > 0 || (item.corrected_wrong_errors || 0) > 0 || (item.new_errors || 0) > 0) {
        failed.push({
          id: item.id,
          original: item.original,
          expected: item.expected,
          category: item.category,
          phase: phase.title,
          remaining: item.remaining_errors || 0,
          wrong: item.corrected_wrong_errors || 0,
          newErrors: item.new_errors || 0
        });
      }
    }
  }

  return failed;
}

async function getApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  try {
    const raw = (await readFile(path.resolve(process.cwd(), ".env"), "utf8")).trim();
    if (raw && !raw.includes("=")) {
      return raw;
    }
  } catch {
    return "";
  }

  return "";
}

async function askGeminiForPriorityIds(failedItems) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return [];
  }

  const ai = new GoogleGenAI({ apiKey });
  const sample = failedItems.slice(0, 120).map((item) => ({
    id: item.id,
    original: item.original,
    expected: item.expected,
    remaining: item.remaining,
    wrong: item.wrong,
    newErrors: item.newErrors
  }));

  const prompt = `Analise os casos falhos abaixo de um corretor pt-BR.
Responda somente com JSON puro no formato {"safe_exact_rule_ids":["id1","id2"]}.
Critério: inclua IDs seguros para virar regra frasal exata de melhoria contínua.
Priorize frases estáveis, erros ortográficos claros, locuções fixas, pontuação recorrente e contextos explícitos.
Evite sugestões perigosas que possam generalizar errado.
Casos: ${JSON.stringify(sample)}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });
    const parsed = JSON.parse(response.text.trim().replace(/^```json\s*|```$/g, ""));
    return Array.isArray(parsed.safe_exact_rule_ids)
      ? parsed.safe_exact_rule_ids.map((value) => String(value))
      : [];
  } catch {
    return [];
  }
}

function buildContinuousRules(failedItems, priorityIds) {
  const prioritySet = new Set(priorityIds);
  const chosen = prioritySet.size
    ? failedItems.filter((item) => prioritySet.has(item.id))
    : failedItems;
  const seenIds = new Map();

  return chosen
    .map((item) => {
      const pattern = toTokens(item.original);
      const replacement = stripTerminalPunctuation(item.expected);

      if (!pattern.length || !replacement) {
        return null;
      }

      const baseId = `PT_BR_CONTINUOUS_${slugify(`${item.phase}_${item.id}`)}`;
      const occurrence = seenIds.get(baseId) || 0;
      seenIds.set(baseId, occurrence + 1);
      const ruleId = occurrence ? `${baseId}_${occurrence + 1}` : baseId;

      return {
        id: ruleId,
        pattern,
        replacements: [replacement],
        message: "A forma esperada foi aprendida a partir da bateria contínua.",
        description: `Regra exata derivada da auditoria contínua para '${item.id}'.`
      };
    })
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = JSON.parse(await readFile(path.resolve(process.cwd(), args.audit), "utf8"));
  const failedItems = collectFailedItems(audit);
  const priorityIds = await askGeminiForPriorityIds(failedItems);
  const continuousRules = buildContinuousRules(failedItems, priorityIds);

  await writeFile(
    path.resolve(process.cwd(), args.output),
    `${JSON.stringify(continuousRules, null, 2)}\n`,
    "utf8"
  );

  console.log(`Falhas analisadas: ${failedItems.length}`);
  console.log(`IDs priorizados pelo Gemini: ${priorityIds.length}`);
  console.log(`Regras contínuas geradas: ${continuousRules.length}`);
  console.log(`Arquivo atualizado: ${path.resolve(process.cwd(), args.output)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
