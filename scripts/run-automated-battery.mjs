import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const CATEGORY_LIST = "ortografia,acentuacao,hifen,pontuacao,localizacao,contexto,homofonos,anuncios,texto_tecnico";
const DEFAULT_COUNT_PER_CATEGORY = 12;
const DEFAULT_AUDIT_OUTPUT = "data/test-cases/latest-audit.json";
const MIN_VISIBLE_CONFIDENCE_SCORE = 0.68;

function parseArgs(argv) {
  const args = {
    rounds: 1,
    countPerCategory: DEFAULT_COUNT_PER_CATEGORY,
    auditOutput: DEFAULT_AUDIT_OUTPUT,
    publish: false,
    skipGenerate: false,
    skipBuild: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--rounds" && next) {
      args.rounds = Number(next);
      index += 1;
    } else if (current === "--count-per-category" && next) {
      args.countPerCategory = Number(next);
      index += 1;
    } else if (current === "--audit-output" && next) {
      args.auditOutput = next;
      index += 1;
    } else if (current === "--publish") {
      args.publish = true;
    } else if (current === "--skip-generate") {
      args.skipGenerate = true;
    } else if (current === "--skip-build") {
      args.skipBuild = true;
    }
  }

  if (!Number.isInteger(args.rounds) || args.rounds < 1 || args.rounds > 6) {
    throw new Error("Use --rounds com um inteiro entre 1 e 6.");
  }

  if (!Number.isInteger(args.countPerCategory) || args.countPerCategory < 1 || args.countPerCategory > 50) {
    throw new Error("Use --count-per-category com um inteiro entre 1 e 50.");
  }

  return args;
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

function runCommandForExitCode(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "ignore",
      env: process.env
    });

    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function findFreePort(startPort = 18081) {
  let port = startPort;

  while (true) {
    const available = await new Promise((resolve) => {
      const tester = createServer();
      tester.once("error", () => resolve(false));
      tester.once("listening", () => {
        tester.close(() => resolve(true));
      });
      tester.listen(port, "127.0.0.1");
    });

    if (available) {
      return String(port);
    }

    port += 1;
  }
}

function normalizeForComparison(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function tokenizeForAudit(value) {
  return normalizeForComparison(value).match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];
}

function buildTokenChangeGroups(sourceTokens, targetTokens) {
  const rows = sourceTokens.length + 1;
  const cols = targetTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    dp[i][0] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    dp[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (sourceTokens[i - 1] === targetTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }

  const operations = [];
  let i = sourceTokens.length;
  let j = targetTokens.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sourceTokens[i - 1] === targetTokens[j - 1]) {
      operations.push({ type: "equal", srcIndex: i - 1, tgtIndex: j - 1 });
      i -= 1;
      j -= 1;
      continue;
    }

    const replaceCost = i > 0 && j > 0 ? dp[i - 1][j - 1] : Number.POSITIVE_INFINITY;
    const deleteCost = i > 0 ? dp[i - 1][j] : Number.POSITIVE_INFINITY;
    const currentCost = dp[i][j];

    if (i > 0 && j > 0 && currentCost === replaceCost + 1) {
      operations.push({
        type: "replace",
        srcToken: sourceTokens[i - 1],
        tgtToken: targetTokens[j - 1]
      });
      i -= 1;
      j -= 1;
    } else if (i > 0 && currentCost === deleteCost + 1) {
      operations.push({ type: "delete", srcToken: sourceTokens[i - 1] });
      i -= 1;
    } else {
      operations.push({ type: "insert", tgtToken: targetTokens[j - 1] });
      j -= 1;
    }
  }

  operations.reverse();

  const groups = [];
  let currentGroup = null;
  let sourceCursor = 0;
  let targetCursor = 0;

  function closeGroup() {
    if (!currentGroup) {
      return;
    }
    currentGroup.srcEnd = sourceCursor;
    currentGroup.tgtEnd = targetCursor;
    currentGroup.srcText = currentGroup.srcTokens.join(" ");
    currentGroup.tgtText = currentGroup.tgtTokens.join(" ");
    groups.push(currentGroup);
    currentGroup = null;
  }

  for (const operation of operations) {
    if (operation.type === "equal") {
      closeGroup();
      sourceCursor += 1;
      targetCursor += 1;
      continue;
    }

    if (!currentGroup) {
      currentGroup = {
        srcStart: sourceCursor,
        srcEnd: sourceCursor,
        tgtStart: targetCursor,
        tgtEnd: targetCursor,
        srcTokens: [],
        tgtTokens: []
      };
    }

    if (operation.type === "replace") {
      currentGroup.srcTokens.push(operation.srcToken);
      currentGroup.tgtTokens.push(operation.tgtToken);
      sourceCursor += 1;
      targetCursor += 1;
    } else if (operation.type === "delete") {
      currentGroup.srcTokens.push(operation.srcToken);
      sourceCursor += 1;
    } else {
      currentGroup.tgtTokens.push(operation.tgtToken);
      targetCursor += 1;
    }
  }

  closeGroup();
  return groups;
}

function groupsOverlap(left, right) {
  const leftStart = left.srcStart;
  const leftEnd = left.srcEnd;
  const rightStart = right.srcStart;
  const rightEnd = right.srcEnd;

  if (leftStart === leftEnd && rightStart === rightEnd) {
    return leftStart === rightStart;
  }

  if (leftStart === leftEnd) {
    return leftStart >= rightStart && leftStart <= rightEnd;
  }

  if (rightStart === rightEnd) {
    return rightStart >= leftStart && rightStart <= leftEnd;
  }

  return leftStart < rightEnd && rightStart < leftEnd;
}

function analyzeFieldProgress(original, actual, expected) {
  const originalTokens = tokenizeForAudit(original);
  const actualTokens = tokenizeForAudit(actual);
  const expectedTokens = tokenizeForAudit(expected);
  const expectedGroups = buildTokenChangeGroups(originalTokens, expectedTokens);
  const actualGroups = buildTokenChangeGroups(originalTokens, actualTokens);

  let corrected = 0;
  let remained = 0;
  let correctedWrong = 0;

  for (const expectedGroup of expectedGroups) {
    const exactFinalGroup = actualGroups.find((group) =>
      group.srcStart === expectedGroup.srcStart &&
      group.srcEnd === expectedGroup.srcEnd
    );

    if (exactFinalGroup) {
      if (exactFinalGroup.tgtText === expectedGroup.tgtText) {
        corrected += 1;
      } else {
        correctedWrong += 1;
      }
      continue;
    }

    const hasOverlap = actualGroups.some((group) => groupsOverlap(group, expectedGroup));
    if (hasOverlap) {
      correctedWrong += 1;
    } else {
      remained += 1;
    }
  }

  const newErrors = actualGroups.filter((group) => !expectedGroups.some((expectedGroup) => groupsOverlap(group, expectedGroup))).length;
  const existingErrors = expectedGroups.length;
  const accuracy = existingErrors ? Math.round((corrected / existingErrors) * 100) : 100;

  return {
    existing_errors: existingErrors,
    corrected_errors: corrected,
    remaining_errors: remained,
    corrected_wrong_errors: correctedWrong,
    new_errors: newErrors,
    real_accuracy_percentage: accuracy,
    expected_groups: expectedGroups,
    actual_groups: actualGroups
  };
}

function getMatchConfidenceScore(match) {
  if (typeof match?.confidence?.score === "number") {
    return match.confidence.score;
  }

  switch (match?.confidence?.level) {
    case "high":
      return 0.95;
    case "medium":
      return 0.76;
    case "low":
      return 0.45;
    default:
      return 0.9;
  }
}

function shouldHideWeakMatch(match) {
  return match?.confidence?.level === "low" || getMatchConfidenceScore(match) < MIN_VISIBLE_CONFIDENCE_SCORE;
}

function selectVisibleMatchesForUi(matches) {
  return [...matches]
    .filter((match) => !shouldHideWeakMatch(match))
    .sort((left, right) => getMatchConfidenceScore(right) - getMatchConfidenceScore(left) || left.offset - right.offset || left.length - right.length);
}

function applyTopSuggestions(text, matches) {
  const ordered = [...matches]
    .filter((match) => typeof match.offset === "number" && typeof match.length === "number" && Array.isArray(match.replacements) && match.replacements[0]?.value)
    .sort((left, right) => right.offset - left.offset);

  let nextText = text;
  for (const match of ordered) {
    const replacement = String(match.replacements[0].value || "");
    nextText = `${nextText.slice(0, match.offset)}${replacement}${nextText.slice(match.offset + match.length)}`;
  }
  return nextText;
}

async function checkCase(port, testCase) {
  const response = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: testCase.errado
    })
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar o backend para ${testCase.id}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const visibleMatches = selectVisibleMatchesForUi(matches);
  const extensionResult = applyTopSuggestions(testCase.errado, visibleMatches);
  const baselineResult = applyTopSuggestions(testCase.errado, matches);
  return {
    matches,
    visibleMatches,
    extensionResult,
    analysis: analyzeFieldProgress(testCase.errado, extensionResult, testCase.correto),
    baselineAnalysis: analyzeFieldProgress(testCase.errado, baselineResult, testCase.correto)
  };
}

function accumulateTotals(items) {
  return items.reduce((totals, item) => {
    totals.existing_errors += item.existing_errors;
    totals.corrected_errors += item.corrected_errors;
    totals.remaining_errors += item.remaining_errors;
    totals.corrected_wrong_errors += item.corrected_wrong_errors;
    totals.new_errors += item.new_errors;
    return totals;
  }, {
    existing_errors: 0,
    corrected_errors: 0,
    remaining_errors: 0,
    corrected_wrong_errors: 0,
    new_errors: 0
  });
}

function summarizeCategories(itemReports) {
  const bucket = new Map();

  for (const item of itemReports) {
    const labels = [...new Set([item.category, ...(Array.isArray(item.tags) ? item.tags : [])].filter(Boolean))];
    for (const label of labels) {
      const key = String(label);
      const current = bucket.get(key) || { existing_errors: 0, corrected_errors: 0 };
      current.existing_errors += item.existing_errors;
      current.corrected_errors += item.corrected_errors;
      bucket.set(key, current);
    }
  }

  return [...bucket.entries()]
    .map(([category, totals]) => ({
      category,
      score: totals.existing_errors ? Math.round((totals.corrected_errors / totals.existing_errors) * 100) : 100
    }))
    .sort((left, right) => right.score - left.score || left.category.localeCompare(right.category, "pt-BR"));
}

function formatTimestampForCommit(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

async function writeAudit(outputPath, report) {
  const resolved = path.resolve(process.cwd(), outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.skipGenerate) {
    for (let difficulty = 1; difficulty <= args.rounds; difficulty += 1) {
      await runCommand("node", [
        "scripts/generate-test-cases.mjs",
        "--categories", CATEGORY_LIST,
        "--count-per-category", String(args.countPerCategory),
        "--difficulty", String(difficulty)
      ], `generate difficulty ${difficulty}`);
    }

    await runCommand("node", ["scripts/curate-test-cases.mjs"], "curate test cases");
  }

  if (!args.skipBuild) {
    await runCommand("npm", ["run", "build"], "npm run build");
  }

  const curatedProofPath = path.resolve(process.cwd(), "data/test-cases/curated-proof.json");
  try {
    await fs.access(curatedProofPath);
  } catch {
    throw new Error("Base de prova ausente: data/test-cases/curated-proof.json. O proof-pardau nao permite fallback.");
  }

  const curatedItems = JSON.parse(await fs.readFile(curatedProofPath, "utf8"));
  let selectedCases = curatedItems.filter((item) => Number(item.difficulty) <= args.rounds);

  if (!selectedCases.length) {
    throw new Error(`Base de prova insuficiente para --rounds ${args.rounds}. O proof-pardau exige casos elegiveis em curated-proof.`);
  }

  if (!selectedCases.length) {
    throw new Error("Nenhum caso curado encontrado para montar a bateria automática.");
  }

  const port = await findFreePort();
  const server = spawn("node", ["build/node-app/backend/server.cjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CORRIJA_ME_PORT: port
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const startedAt = Date.now();

  try {
    await delay(1000);

    const itemReports = [];
    for (const testCase of selectedCases) {
      const result = await checkCase(port, testCase);
      itemReports.push({
        id: testCase.id,
        category: testCase.category,
        tags: testCase.tags,
        difficulty: testCase.difficulty,
        original: testCase.errado,
        extension_result: result.extensionResult,
        expected: testCase.correto,
        total_matches: result.matches.length,
        visible_matches: result.visibleMatches.length,
        hidden_weak_matches: Math.max(0, result.matches.length - result.visibleMatches.length),
        baseline_existing_errors: result.baselineAnalysis.existing_errors,
        baseline_corrected_errors: result.baselineAnalysis.corrected_errors,
        baseline_remaining_errors: result.baselineAnalysis.remaining_errors,
        baseline_corrected_wrong_errors: result.baselineAnalysis.corrected_wrong_errors,
        baseline_new_errors: result.baselineAnalysis.new_errors,
        baseline_real_accuracy_percentage: result.baselineAnalysis.real_accuracy_percentage,
        ...result.analysis,
        status: result.analysis.corrected_errors === result.analysis.existing_errors && result.analysis.corrected_wrong_errors === 0 && result.analysis.new_errors === 0
          ? "ok"
          : result.analysis.corrected_errors > 0
            ? "parcial"
            : "falhou"
      });
    }

    const phases = [];
    for (let difficulty = 1; difficulty <= args.rounds; difficulty += 1) {
      const items = itemReports.filter((item) => Number(item.difficulty) === difficulty);
      const phaseTotals = accumulateTotals(items);
      phases.push({
        phase: difficulty,
        title: `Dificuldade ${difficulty}`,
        phase_score: phaseTotals.existing_errors ? Math.round((phaseTotals.corrected_errors / phaseTotals.existing_errors) * 100) : 100,
        phase_totals: phaseTotals,
        items
      });
    }

    const totals = accumulateTotals(itemReports);
    const globalScore = totals.existing_errors ? Math.round((totals.corrected_errors / totals.existing_errors) * 100) : 100;
    const categoryScores = summarizeCategories(itemReports);
    const visibilityTotals = itemReports.reduce((accumulator, item) => {
      accumulator.total_matches += item.total_matches;
      accumulator.visible_matches += item.visible_matches;
      accumulator.hidden_weak_matches += item.hidden_weak_matches;
      return accumulator;
    }, {
      total_matches: 0,
      visible_matches: 0,
      hidden_weak_matches: 0
    });
    const baselineTotals = itemReports.reduce((accumulator, item) => {
      accumulator.existing_errors += item.baseline_existing_errors;
      accumulator.corrected_errors += item.baseline_corrected_errors;
      accumulator.remaining_errors += item.baseline_remaining_errors;
      accumulator.corrected_wrong_errors += item.baseline_corrected_wrong_errors;
      accumulator.new_errors += item.baseline_new_errors;
      return accumulator;
    }, {
      existing_errors: 0,
      corrected_errors: 0,
      remaining_errors: 0,
      corrected_wrong_errors: 0,
      new_errors: 0
    });
    const baselineGlobalScore = baselineTotals.existing_errors ? Math.round((baselineTotals.corrected_errors / baselineTotals.existing_errors) * 100) : 100;

    const report = {
      generated_at: new Date().toISOString(),
      mode: "automated_backend_battery",
      rounds: args.rounds,
      count_per_category: args.countPerCategory,
      categories: CATEGORY_LIST.split(","),
      confidence_policy: {
        min_visible_confidence_score: MIN_VISIBLE_CONFIDENCE_SCORE,
        hidden_levels: ["low"]
      },
      elapsed: `${Math.round((Date.now() - startedAt) / 1000)}s`,
      global_score: globalScore,
      baseline_global_score_without_visibility_filter: baselineGlobalScore,
      totals,
      baseline_totals_without_visibility_filter: baselineTotals,
      visibility_totals: visibilityTotals,
      top_strength: categoryScores[0] || null,
      top_gap: categoryScores[categoryScores.length - 1] || null,
      category_scores: categoryScores,
      phases
    };

    const auditPath = await writeAudit(args.auditOutput, report);
    console.log(`Auditoria salva em: ${auditPath}`);

    if (args.publish) {
      const publishTargets = [
        "data/test-cases/generated.json",
        "data/test-cases/curated.json",
        "data/test-cases/curated-know.json",
        "data/test-cases/curated-proof.json",
        "data/test-cases/curated-partitions-report.json",
        "data/test-cases/rejected.json",
        args.auditOutput
      ];
      await runCommand("git", ["add", ...publishTargets], "git add publish targets");
      const diffExitCode = await runCommandForExitCode("git", ["diff", "--cached", "--quiet"]);
      if (diffExitCode === 0) {
        console.log("Nenhuma mudanca nova nos arquivos de dados para publicar.");
      } else {
        await runCommand("git", ["commit", "-m", `atualização ${formatTimestampForCommit()}`], "git commit");
        await runCommand("git", ["push", "origin", "HEAD"], "git push");
      }
    }
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
