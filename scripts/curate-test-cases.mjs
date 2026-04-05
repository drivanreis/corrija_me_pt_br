import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const GENERATED_PATH = "data/test-cases/generated.json";
const CURATED_PATH = "data/test-cases/curated.json";
const REJECTED_PATH = "data/test-cases/rejected.json";

const CATEGORY_MAP = new Map([
  ["acentuacao", "acentuação"],
  ["acentuação", "acentuação"],
  ["homofonos", "homófonos"],
  ["homófonos", "homófonos"],
  ["localizacao", "localização"],
  ["localização", "localização"],
  ["anuncios", "anúncios"],
  ["anúncio", "anúncios"],
  ["anúncios", "anúncios"],
  ["texto_tecnico", "texto técnico"],
  ["técnico", "texto técnico"],
  ["texto técnico", "texto técnico"],
  ["contexto", "contexto"],
  ["ortografia", "ortografia"],
  ["pontuacao", "pontuação"],
  ["pontuação", "pontuação"],
  ["hifen", "hífen"],
  ["hífen", "hífen"]
]);

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeLabel(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return CATEGORY_MAP.get(normalized) || normalized;
}

function uniqueBy(items, keyBuilder) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyBuilder(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

function countWordTokens(value) {
  return (normalizeWhitespace(value).match(/\p{L}+/gu) || []).length;
}

function extractNumbers(value) {
  return normalizeWhitespace(value).match(/\d+/g) || [];
}

function hasForbiddenFormattingShift(errado, correto) {
  const wrongNumbers = extractNumbers(errado).join("|");
  const rightNumbers = extractNumbers(correto).join("|");
  if (wrongNumbers !== rightNumbers) {
    return true;
  }

  const wrongMoney = /(?:R\$|US\$|€|\$)/.exec(errado)?.[0] || "";
  const rightMoney = /(?:R\$|US\$|€|\$)/.exec(correto)?.[0] || "";
  if (wrongMoney !== rightMoney) {
    return true;
  }

  if (/\b(?:am|pm)\b/i.test(errado) || /\b(?:am|pm)\b/i.test(correto)) {
    return true;
  }

  return false;
}

function normalizeCase(testCase) {
  const errado = normalizeWhitespace(testCase.errado);
  const correto = normalizeWhitespace(testCase.correto);
  const category = normalizeLabel(testCase.category || "misto");
  const tags = uniqueBy(
    (Array.isArray(testCase.tags) ? testCase.tags : [])
      .map((entry) => normalizeLabel(entry))
      .filter(Boolean),
    (entry) => entry
  ).slice(0, 5);

  return {
    id: normalizeWhitespace(testCase.id || `${category}-${Date.now()}`),
    category,
    difficulty: Number.isInteger(testCase.difficulty) ? testCase.difficulty : 3,
    errado,
    correto,
    error_count: Number.isInteger(testCase.error_count) ? testCase.error_count : 1,
    tags
  };
}

function classifyCase(testCase) {
  const normalized = normalizeCase(testCase);
  const reasons = [];

  if (!normalized.errado || !normalized.correto) {
    reasons.push("missing_text");
  }

  if (normalized.errado === normalized.correto) {
    reasons.push("same_text");
  }

  if (normalized.error_count < 1 || normalized.error_count > 6) {
    reasons.push("error_count_out_of_range");
  }

  if (normalized.difficulty >= 2 && normalized.error_count < 2) {
    reasons.push("difficulty_requires_multiple_errors");
  }

  if (normalized.difficulty < 1 || normalized.difficulty > 6) {
    reasons.push("difficulty_out_of_range");
  }

  if (countWordTokens(normalized.errado) < 3 || countWordTokens(normalized.correto) < 3) {
    reasons.push("too_short");
  }

  if (Math.abs(countWordTokens(normalized.errado) - countWordTokens(normalized.correto)) > 1) {
    reasons.push("token_jump_too_large");
  }

  if (hasForbiddenFormattingShift(normalized.errado, normalized.correto)) {
    reasons.push("formatting_or_numeric_conversion");
  }

  const bannedTags = new Set([
    "jurídico",
    "política",
    "finanças",
    "data",
    "formatação",
    "localização",
    "pt_br",
    "vocabulário",
    "tradução",
    "reescrita"
  ]);
  if ([normalized.category, ...normalized.tags].some((entry) => bannedTags.has(entry))) {
    reasons.push("out_of_scope_for_curated_battery");
  }

  return {
    accepted: reasons.length === 0,
    normalized,
    reasons
  };
}

function dedupePairKey(testCase) {
  return `${testCase.errado}|||${testCase.correto}`;
}

function runCommand(command, args, label = `${command} ${args.join(" ")}`) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Falha ao executar: ${label} (exit ${code ?? "null"})`));
      }
    });
  });
}

async function main() {
  const generatedPath = path.resolve(process.cwd(), GENERATED_PATH);
  const curatedPath = path.resolve(process.cwd(), CURATED_PATH);
  const rejectedPath = path.resolve(process.cwd(), REJECTED_PATH);

  const [generatedItems, curatedItems] = await Promise.all([
    readJsonArray(generatedPath),
    readJsonArray(curatedPath)
  ]);

  const preservedCurated = uniqueBy(curatedItems.map(normalizeCase), dedupePairKey);
  const generatedSourceItems = uniqueBy(generatedItems.map(normalizeCase), dedupePairKey);
  const accepted = [...preservedCurated];
  const rejected = [];

  for (const item of generatedSourceItems) {
    const result = classifyCase(item);
    if (result.accepted) {
      accepted.push(result.normalized);
    } else {
      rejected.push({
        ...result.normalized,
        rejected_reasons: result.reasons
      });
    }
  }

  const nextCurated = uniqueBy(accepted, dedupePairKey);
  await fs.writeFile(curatedPath, `${JSON.stringify(nextCurated, null, 2)}\n`, "utf8");
  await fs.writeFile(rejectedPath, `${JSON.stringify(rejected, null, 2)}\n`, "utf8");

  console.log(`Curated preservado: ${preservedCurated.length}`);
  console.log(`Generated avaliado: ${generatedSourceItems.length}`);
  console.log(`Itens fonte avaliados: ${preservedCurated.length + generatedSourceItems.length}`);
  console.log(`Curated total: ${nextCurated.length}`);
  console.log(`Rejeitados nesta execução: ${rejected.length}`);
  console.log(`Arquivo curated: ${curatedPath}`);
  console.log(`Arquivo rejected: ${rejectedPath}`);

  await runCommand("node", ["scripts/build-curated-partitions.mjs"], "build curated partitions");
  await runCommand("node", ["scripts/generate-know-learned-rules.mjs"], "generate know learned rules");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
