import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const GENERATED_PATH = "data/test-cases/generated.json";
const CURATED_PATH = "data/test-cases/curated.json";
const REJECTED_PATH = "data/test-cases/rejected.json";
const MAX_PER_PROBLEM_SIGNATURE = 1;

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

function normalizeToken(value) {
  return normalizeWhitespace(value).toLocaleLowerCase("pt-BR");
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

function tokenizeWords(text) {
  return (normalizeWhitespace(text).match(/[\p{L}\p{N}]+/gu) || []).map((token) => normalizeToken(token));
}

function buildWordDiffGroups(sourceTokens, targetTokens) {
  const rows = sourceTokens.length + 1;
  const cols = targetTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) dp[row][0] = row;
  for (let col = 0; col < cols; col += 1) dp[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (sourceTokens[row - 1] === targetTokens[col - 1]) {
        dp[row][col] = dp[row - 1][col - 1];
      } else {
        dp[row][col] = Math.min(
          dp[row - 1][col] + 1,
          dp[row][col - 1] + 1,
          dp[row - 1][col - 1] + 1
        );
      }
    }
  }

  const operations = [];
  let row = sourceTokens.length;
  let col = targetTokens.length;

  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && sourceTokens[row - 1] === targetTokens[col - 1]) {
      operations.push({ type: "equal", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
      continue;
    }

    const replaceCost = row > 0 && col > 0 ? dp[row - 1][col - 1] : Number.POSITIVE_INFINITY;
    const deleteCost = row > 0 ? dp[row - 1][col] : Number.POSITIVE_INFINITY;
    const currentCost = dp[row][col];

    if (row > 0 && col > 0 && currentCost === replaceCost + 1) {
      operations.push({ type: "replace", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
    } else if (row > 0 && currentCost === deleteCost + 1) {
      operations.push({ type: "delete", srcIndex: row - 1 });
      row -= 1;
    } else {
      operations.push({ type: "insert", tgtIndex: col - 1 });
      col -= 1;
    }
  }

  operations.reverse();

  const groups = [];
  let current = null;

  function closeGroup() {
    if (!current) {
      return;
    }
    groups.push({
      srcTokens: [...current.srcTokens],
      tgtTokens: [...current.tgtTokens]
    });
    current = null;
  }

  for (const operation of operations) {
    if (operation.type === "equal") {
      closeGroup();
      continue;
    }

    if (!current) {
      current = { srcTokens: [], tgtTokens: [] };
    }

    if (operation.type === "replace") {
      current.srcTokens.push(sourceTokens[operation.srcIndex]);
      current.tgtTokens.push(targetTokens[operation.tgtIndex]);
    } else if (operation.type === "delete") {
      current.srcTokens.push(sourceTokens[operation.srcIndex]);
    } else {
      current.tgtTokens.push(targetTokens[operation.tgtIndex]);
    }
  }

  closeGroup();
  return groups.filter((group) => group.srcTokens.length || group.tgtTokens.length);
}

function buildProblemSignature(testCase) {
  const sourceTokens = tokenizeWords(testCase.errado);
  const targetTokens = tokenizeWords(testCase.correto);
  const groups = buildWordDiffGroups(sourceTokens, targetTokens);

  if (!groups.length) {
    return "no_diff";
  }

  const pairs = groups
    .map((group) => `${group.srcTokens.join(" ")}=>${group.tgtTokens.join(" ")}`)
    .filter((entry) => entry !== "=>")
    .sort();

  return JSON.stringify({
    pairs,
    groupCount: groups.length
  });
}

function scoreRepresentative(testCase) {
  const difficulty = Number(testCase.difficulty) || 3;
  const errorCount = Number(testCase.error_count) || 1;
  const balanceScore = Math.abs(difficulty - 2);
  const lengthScore = countWordTokens(testCase.errado) + countWordTokens(testCase.correto);
  return [
    balanceScore,
    errorCount,
    lengthScore,
    normalizeToken(testCase.id || "")
  ];
}

function compareScore(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function dedupeByProblemSignature(testCases, maxPerSignature = MAX_PER_PROBLEM_SIGNATURE) {
  const buckets = new Map();

  for (const testCase of testCases) {
    const signature = buildProblemSignature(testCase);
    const bucket = buckets.get(signature) || [];
    bucket.push(testCase);
    buckets.set(signature, bucket);
  }

  const deduped = [];
  for (const bucket of buckets.values()) {
    const selected = [...bucket]
      .sort((left, right) => compareScore(scoreRepresentative(left), scoreRepresentative(right)))
      .slice(0, maxPerSignature);
    deduped.push(...selected);
  }

  return deduped;
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
  const nextCuratedByProblem = dedupeByProblemSignature(nextCurated, MAX_PER_PROBLEM_SIGNATURE);
  await fs.writeFile(curatedPath, `${JSON.stringify(nextCuratedByProblem, null, 2)}\n`, "utf8");
  await fs.writeFile(rejectedPath, `${JSON.stringify(rejected, null, 2)}\n`, "utf8");

  console.log(`Curated preservado: ${preservedCurated.length}`);
  console.log(`Generated avaliado: ${generatedSourceItems.length}`);
  console.log(`Itens fonte avaliados: ${preservedCurated.length + generatedSourceItems.length}`);
  console.log(`Curated após dedupe por par: ${nextCurated.length}`);
  console.log(`Curated total (1 por problema): ${nextCuratedByProblem.length}`);
  console.log(`Removidos por problema repetido: ${nextCurated.length - nextCuratedByProblem.length}`);
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
