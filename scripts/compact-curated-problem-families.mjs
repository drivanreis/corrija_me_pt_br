import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "data/test-cases/curated.json";
const DEFAULT_OUTPUT = "data/test-cases/curated.json";
const DEFAULT_REPORT = "data/test-cases/curated-problem-compaction-report.json";

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
    keepPerSignature: 1,
    apply: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--input" && next) {
      args.input = next;
      index += 1;
    } else if (current === "--output" && next) {
      args.output = next;
      index += 1;
    } else if (current === "--report" && next) {
      args.report = next;
      index += 1;
    } else if (current === "--keep-per-signature" && next) {
      args.keepPerSignature = Number(next);
      index += 1;
    } else if (current === "--apply") {
      args.apply = true;
    }
  }

  if (!Number.isInteger(args.keepPerSignature) || args.keepPerSignature < 1 || args.keepPerSignature > 10) {
    throw new Error("Use --keep-per-signature com inteiro entre 1 e 10.");
  }

  return args;
}

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return normalizeWhitespace(value).toLocaleLowerCase("pt-BR");
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
  let sourceCursor = 0;
  let targetCursor = 0;

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
      sourceCursor += 1;
      targetCursor += 1;
      continue;
    }

    if (!current) {
      current = { srcTokens: [], tgtTokens: [] };
    }

    if (operation.type === "replace") {
      current.srcTokens.push(sourceTokens[operation.srcIndex]);
      current.tgtTokens.push(targetTokens[operation.tgtIndex]);
      sourceCursor += 1;
      targetCursor += 1;
    } else if (operation.type === "delete") {
      current.srcTokens.push(sourceTokens[operation.srcIndex]);
      sourceCursor += 1;
    } else {
      current.tgtTokens.push(targetTokens[operation.tgtIndex]);
      targetCursor += 1;
    }
  }

  closeGroup();

  return groups.filter((group) => group.srcTokens.length || group.tgtTokens.length);
}

function buildProblemSignature(item) {
  const sourceTokens = tokenizeWords(item.errado);
  const targetTokens = tokenizeWords(item.correto);
  const groups = buildWordDiffGroups(sourceTokens, targetTokens);

  if (!groups.length) {
    return "no_diff";
  }

  const pairs = groups
    .map((group) => `${group.srcTokens.join(" ")}=>${group.tgtTokens.join(" ")}`)
    .filter((value) => value !== "=>")
    .sort();

  return JSON.stringify({
    pairs,
    groupCount: groups.length
  });
}

function countWordTokens(text) {
  return tokenizeWords(text).length;
}

function rankingTuple(item) {
  const difficulty = Number(item.difficulty) || 3;
  const errorCount = Number(item.error_count) || 1;
  const distanceFromBaseline = Math.abs(difficulty - 2);
  const tokenCount = countWordTokens(item.errado) + countWordTokens(item.correto);
  return [
    distanceFromBaseline,
    errorCount,
    tokenCount,
    normalizeToken(item.id || "")
  ];
}

function compareTuple(leftTuple, rightTuple) {
  for (let index = 0; index < Math.max(leftTuple.length, rightTuple.length); index += 1) {
    const left = leftTuple[index];
    const right = rightTuple[index];
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), args.input);
  const outputPath = path.resolve(process.cwd(), args.output);
  const reportPath = path.resolve(process.cwd(), args.report);

  const content = await fs.readFile(inputPath, "utf8");
  const testCases = JSON.parse(content);
  if (!Array.isArray(testCases)) {
    throw new Error(`Arquivo de entrada deve ser array JSON: ${inputPath}`);
  }

  const groups = new Map();
  testCases.forEach((item, index) => {
    const signature = buildProblemSignature(item);
    const bucket = groups.get(signature) || [];
    bucket.push({ item, index, tuple: rankingTuple(item) });
    groups.set(signature, bucket);
  });

  const keptIndexes = new Set();
  const reportGroups = [];

  for (const [signature, bucket] of groups.entries()) {
    const ordered = [...bucket].sort((left, right) => compareTuple(left.tuple, right.tuple));
    const kept = ordered.slice(0, args.keepPerSignature);
    const removed = ordered.slice(args.keepPerSignature);

    for (const entry of kept) {
      keptIndexes.add(entry.index);
    }

    reportGroups.push({
      signature,
      total_cases: bucket.length,
      kept_ids: kept.map((entry) => entry.item.id),
      removed_ids: removed.map((entry) => entry.item.id)
    });
  }

  const compacted = testCases.filter((_, index) => keptIndexes.has(index));
  const removedCount = testCases.length - compacted.length;

  const reportPayload = {
    generated_at: new Date().toISOString(),
    input: args.input,
    output: args.output,
    keep_per_signature: args.keepPerSignature,
    total_before: testCases.length,
    total_after: compacted.length,
    removed_count: removedCount,
    apply: args.apply,
    signatures: reportGroups
      .filter((entry) => entry.total_cases > args.keepPerSignature)
      .sort((left, right) => right.total_cases - left.total_cases)
  };

  await fs.writeFile(reportPath, `${JSON.stringify(reportPayload, null, 2)}\n`, "utf8");

  if (args.apply) {
    await fs.writeFile(outputPath, `${JSON.stringify(compacted, null, 2)}\n`, "utf8");
  }

  console.log(`input_total=${testCases.length}`);
  console.log(`output_total=${compacted.length}`);
  console.log(`removed_total=${removedCount}`);
  console.log(`signatures_total=${groups.size}`);
  console.log(`signatures_compacted=${reportPayload.signatures.length}`);
  console.log(`apply=${args.apply ? "1" : "0"}`);
  console.log(`report_file=${reportPath}`);
  if (args.apply) {
    console.log(`output_file=${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
