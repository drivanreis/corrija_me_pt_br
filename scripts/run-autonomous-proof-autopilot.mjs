import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_ROUNDS = 6;
const DEFAULT_TARGET_SCORE = 100;
const DEFAULT_MAX_CYCLES = 20;
const DEFAULT_STAGNATION_LIMIT = 5;
const DEFAULT_REPLACEMENTS_PATH = "data/replacements_proof.json";
const DEFAULT_PHRASE_RULES_PATH = "data/rules/phrase_rules_proof.json";
const DEFAULT_CONTEXT_RULES_PATH = "data/rules/context_rules_proof.json";
const DEFAULT_HISTORY_PATH = "data/test-cases/autonomous-proof-history.json";
const DEFAULT_REJECTIONS_PATH = "data/rules/proof-improvement-rejections.json";

function parseArgs(argv) {
  const args = {
    rounds: DEFAULT_ROUNDS,
    targetScore: DEFAULT_TARGET_SCORE,
    maxCycles: DEFAULT_MAX_CYCLES,
    stagnationLimit: DEFAULT_STAGNATION_LIMIT,
    replacementsPath: DEFAULT_REPLACEMENTS_PATH,
    phraseRulesPath: DEFAULT_PHRASE_RULES_PATH,
    contextRulesPath: DEFAULT_CONTEXT_RULES_PATH,
    historyPath: DEFAULT_HISTORY_PATH,
    rejectionsPath: DEFAULT_REJECTIONS_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--rounds" && next) {
      args.rounds = Number(next);
      index += 1;
    } else if (current === "--target-score" && next) {
      args.targetScore = Number(next);
      index += 1;
    } else if (current === "--max-cycles" && next) {
      args.maxCycles = Number(next);
      index += 1;
    } else if (current === "--stagnation-limit" && next) {
      args.stagnationLimit = Number(next);
      index += 1;
    }
  }

  if (!Number.isInteger(args.rounds) || args.rounds < 1 || args.rounds > 6) {
    throw new Error("Use --rounds com um inteiro entre 1 e 6.");
  }

  if (!Number.isInteger(args.targetScore) || args.targetScore < 1 || args.targetScore > 100) {
    throw new Error("Use --target-score com um inteiro entre 1 e 100.");
  }

  if (!Number.isInteger(args.maxCycles) || args.maxCycles < 1 || args.maxCycles > 100) {
    throw new Error("Use --max-cycles com um inteiro entre 1 e 100.");
  }

  if (!Number.isInteger(args.stagnationLimit) || args.stagnationLimit < 1 || args.stagnationLimit > 20) {
    throw new Error("Use --stagnation-limit com um inteiro entre 1 e 20.");
  }

  return args;
}

function runCommand(command, args, label = `${command} ${args.join(" ")}`, timeoutMs = 900_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timeout ao executar: ${label}`));
    }, timeoutMs);

    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Falha ao executar: ${label} (exit ${code ?? "null"})`));
      }
    });
  });
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(path.resolve(process.cwd(), filePath), "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(path.resolve(process.cwd(), filePath)), { recursive: true });
  await fs.writeFile(path.resolve(process.cwd(), filePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensureJsonArray(filePath) {
  const current = await readJson(filePath, null);
  if (Array.isArray(current)) {
    return current;
  }

  await writeJson(filePath, []);
  return [];
}

async function ensureRejections(filePath) {
  const current = await readJson(filePath, null);
  if (
    current
    && Array.isArray(current.replacements)
    && Array.isArray(current.phraseRules)
    && Array.isArray(current.contextRules)
  ) {
    return current;
  }

  const empty = {
    replacements: [],
    phraseRules: [],
    contextRules: []
  };
  await writeJson(filePath, empty);
  return empty;
}

function mergeByKey(current, next, keyFactory) {
  const byKey = new Map();

  for (const entry of [...current, ...next]) {
    const key = keyFactory(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()];
}

function replacementKey(entry) {
  return JSON.stringify([entry.from, entry.replacements]);
}

function phraseRuleKey(entry) {
  return JSON.stringify([entry.pattern, entry.replacements]);
}

function contextRuleKey(entry) {
  return JSON.stringify([entry.pattern, entry.targetIndex, entry.replacements]);
}

function filterRejectedCandidates(candidates, rejections) {
  const replacementKeys = new Set(rejections.replacements || []);
  const phraseRuleKeys = new Set(rejections.phraseRules || []);
  const contextRuleKeys = new Set(rejections.contextRules || []);

  return {
    replacements: (candidates.replacements || []).filter((entry) => !replacementKeys.has(replacementKey(entry))),
    phraseRules: (candidates.phraseRules || []).filter((entry) => !phraseRuleKeys.has(phraseRuleKey(entry))),
    contextRules: (candidates.contextRules || []).filter((entry) => !contextRuleKeys.has(contextRuleKey(entry)))
  };
}

function appendRejectedCandidates(rejections, candidates) {
  return {
    replacements: mergeByKey(rejections.replacements || [], (candidates.replacements || []).map(replacementKey), (value) => value),
    phraseRules: mergeByKey(rejections.phraseRules || [], (candidates.phraseRules || []).map(phraseRuleKey), (value) => value),
    contextRules: mergeByKey(rejections.contextRules || [], (candidates.contextRules || []).map(contextRuleKey), (value) => value)
  };
}

async function runFullProofAudit(rounds, auditPath) {
  await runCommand("npm", [
    "run",
    "automate:battery",
    "--",
    "--rounds", String(rounds),
    "--skip-generate",
    "--audit-output", auditPath
  ], `proof full audit rounds=${rounds}`, 1_800_000);
}

async function readAuditMetrics(filePath) {
  const audit = await readJson(filePath);
  return {
    globalScore: audit.global_score,
    totals: audit.totals
  };
}

function summarizeCandidates(candidates) {
  return {
    replacements: (candidates.replacements || []).length,
    phraseRules: (candidates.phraseRules || []).length,
    contextRules: (candidates.contextRules || []).length
  };
}

async function writeAssets(paths, replacements, phraseRules, contextRules) {
  await Promise.all([
    writeJson(paths.replacementsPath, replacements),
    writeJson(paths.phraseRulesPath, phraseRules),
    writeJson(paths.contextRulesPath, contextRules)
  ]);
}

async function tryCandidateSubset({
  label,
  baseAssets,
  subset,
  paths,
  rounds,
  auditPath
}) {
  const mergedReplacements = mergeByKey(baseAssets.replacements, subset.replacements || [], replacementKey);
  const mergedPhraseRules = mergeByKey(baseAssets.phraseRules, subset.phraseRules || [], phraseRuleKey);
  const mergedContextRules = mergeByKey(baseAssets.contextRules, subset.contextRules || [], contextRuleKey);

  await writeAssets(paths, mergedReplacements, mergedPhraseRules, mergedContextRules);
  await runCommand("npm", ["run", "data:validate"], `data validate ${label}`, 300_000);
  await runCommand("npm", ["run", "build"], `build ${label}`, 900_000);
  await runFullProofAudit(rounds, auditPath);

  return {
    mergedReplacements,
    mergedPhraseRules,
    mergedContextRules,
    metrics: await readAuditMetrics(auditPath)
  };
}

function splitCandidatesIntoSingles(candidates) {
  const singles = [];

  for (const entry of candidates.replacements || []) {
    singles.push({
      replacements: [entry],
      phraseRules: [],
      contextRules: []
    });
  }

  for (const entry of candidates.phraseRules || []) {
    singles.push({
      replacements: [],
      phraseRules: [entry],
      contextRules: []
    });
  }

  for (const entry of candidates.contextRules || []) {
    singles.push({
      replacements: [],
      phraseRules: [],
      contextRules: [entry]
    });
  }

  return singles;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  await Promise.all([
    ensureJsonArray(args.replacementsPath),
    ensureJsonArray(args.phraseRulesPath),
    ensureJsonArray(args.contextRulesPath)
  ]);

  let rejections = await ensureRejections(args.rejectionsPath);
  const history = [];
  let stagnation = 0;
  const assetPaths = {
    replacementsPath: args.replacementsPath,
    phraseRulesPath: args.phraseRulesPath,
    contextRulesPath: args.contextRulesPath
  };

  const baselineAuditPath = `/tmp/corrija-proof-autopilot-baseline-${Date.now()}.json`;
  console.log(`Baseline: rodando prova completa rounds=${args.rounds}`);
  await runFullProofAudit(args.rounds, baselineAuditPath);
  let currentAuditPath = baselineAuditPath;
  let currentMetrics = await readAuditMetrics(currentAuditPath);

  history.push({
    cycle: 0,
    audit: currentAuditPath,
    global_score: currentMetrics.globalScore,
    totals: currentMetrics.totals,
    accepted: true
  });

  console.log(`Score inicial do autopiloto: ${currentMetrics.globalScore}%`);

  for (let cycle = 1; cycle <= args.maxCycles; cycle += 1) {
    const candidatePath = `/tmp/proof-autopilot-candidates-${cycle}.json`;
    const nextAuditPath = `/tmp/corrija-proof-autopilot-cycle-${cycle}.json`;

    console.log(`\nCiclo ${cycle}: gerando candidatos a partir da auditoria atual`);
    await runCommand("node", [
      "scripts/proof-driven-improvement-loop.mjs",
      "--audit", currentAuditPath,
      "--output", candidatePath
    ], `proof autopilot candidate generation cycle ${cycle}`, 600_000);

    const rawCandidates = await readJson(candidatePath, {
      replacements: [],
      phraseRules: [],
      contextRules: []
    });
    const candidates = filterRejectedCandidates(rawCandidates, rejections);
    const candidateSummary = summarizeCandidates(candidates);

    console.log(
      `Ciclo ${cycle}: candidatos filtrados -> replacements ${candidateSummary.replacements}, `
      + `phraseRules ${candidateSummary.phraseRules}, contextRules ${candidateSummary.contextRules}`
    );

    if (
      candidateSummary.replacements === 0
      && candidateSummary.phraseRules === 0
      && candidateSummary.contextRules === 0
    ) {
      console.log(`Ciclo ${cycle}: sem candidatos inéditos após filtro de rejeição. Encerrando.`);
      history.push({
        cycle,
        audit: currentAuditPath,
        global_score: currentMetrics.globalScore,
        accepted: false,
        halted_reason: "no_new_candidates",
        candidates: candidateSummary
      });
      break;
    }

    const [currentReplacements, currentPhraseRules, currentContextRules] = await Promise.all([
      readJson(args.replacementsPath, []),
      readJson(args.phraseRulesPath, []),
      readJson(args.contextRulesPath, [])
    ]);

    const baseAssets = {
      replacements: currentReplacements,
      phraseRules: currentPhraseRules,
      contextRules: currentContextRules
    };

    try {
      await tryCandidateSubset({
        label: `cycle-${cycle}-bundle`,
        baseAssets,
        subset: candidates,
        paths: assetPaths,
        rounds: args.rounds,
        auditPath: nextAuditPath
      });
    } catch (error) {
      await writeAssets(assetPaths, currentReplacements, currentPhraseRules, currentContextRules);
      await runCommand("npm", ["run", "build"], "build rollback", 900_000);
      rejections = appendRejectedCandidates(rejections, candidates);
      await writeJson(args.rejectionsPath, rejections);

      history.push({
        cycle,
        audit: currentAuditPath,
        global_score: currentMetrics.globalScore,
        accepted: false,
        halted_reason: "execution_error",
        error: error instanceof Error ? error.message : String(error),
        candidates: candidateSummary
      });
      stagnation += 1;

      if (stagnation >= args.stagnationLimit) {
        console.log(`Ciclo ${cycle}: limite de estagnação atingido após erro. Encerrando.`);
        break;
      }

      continue;
    }

    const nextMetrics = await readAuditMetrics(nextAuditPath);
    const delta = nextMetrics.globalScore - currentMetrics.globalScore;

    if (delta > 0) {
      currentAuditPath = nextAuditPath;
      currentMetrics = nextMetrics;
      stagnation = 0;
      history.push({
        cycle,
        audit: nextAuditPath,
        global_score: nextMetrics.globalScore,
        delta,
        totals: nextMetrics.totals,
        accepted: true,
        candidates: candidateSummary
      });
      console.log(`Ciclo ${cycle}: ganho real ${currentMetrics.globalScore - delta}% -> ${currentMetrics.globalScore}%`);
    } else {
      const singles = splitCandidatesIntoSingles(candidates);
      let acceptedSingle = null;

      if (singles.length > 1) {
        console.log(`Ciclo ${cycle}: pacote neutro. Tentando resgatar ganho local com candidatos individuais.`);

        for (let index = 0; index < singles.length; index += 1) {
          const single = singles[index];
          const singleAuditPath = `/tmp/corrija-proof-autopilot-cycle-${cycle}-single-${index + 1}.json`;

          try {
            await tryCandidateSubset({
              label: `cycle-${cycle}-single-${index + 1}`,
              baseAssets,
              subset: single,
              paths: assetPaths,
              rounds: args.rounds,
              auditPath: singleAuditPath
            });
          } catch {
            continue;
          }

          const singleMetrics = await readAuditMetrics(singleAuditPath);
          const singleDelta = singleMetrics.globalScore - currentMetrics.globalScore;
          if (singleDelta > 0) {
            acceptedSingle = {
              subset: single,
              auditPath: singleAuditPath,
              metrics: singleMetrics,
              delta: singleDelta
            };
            break;
          }
        }
      }

      if (acceptedSingle) {
        currentAuditPath = acceptedSingle.auditPath;
        currentMetrics = acceptedSingle.metrics;
        stagnation = 0;

        const rejectedRemainder = {
          replacements: (candidates.replacements || []).filter((entry) => !acceptedSingle.subset.replacements.includes(entry)),
          phraseRules: (candidates.phraseRules || []).filter((entry) => !acceptedSingle.subset.phraseRules.includes(entry)),
          contextRules: (candidates.contextRules || []).filter((entry) => !acceptedSingle.subset.contextRules.includes(entry))
        };
        rejections = appendRejectedCandidates(rejections, rejectedRemainder);
        await writeJson(args.rejectionsPath, rejections);

        history.push({
          cycle,
          audit: acceptedSingle.auditPath,
          global_score: acceptedSingle.metrics.globalScore,
          delta: acceptedSingle.delta,
          totals: acceptedSingle.metrics.totals,
          accepted: true,
          accepted_via: "single_candidate_rescue",
          candidates: summarizeCandidates(acceptedSingle.subset)
        });
        console.log(`Ciclo ${cycle}: resgate individual bem-sucedido ${currentMetrics.globalScore - acceptedSingle.delta}% -> ${currentMetrics.globalScore}%`);
      } else {
        await writeAssets(assetPaths, currentReplacements, currentPhraseRules, currentContextRules);
        await runCommand("npm", ["run", "build"], "build rollback", 900_000);
        rejections = appendRejectedCandidates(rejections, candidates);
        await writeJson(args.rejectionsPath, rejections);
        stagnation += 1;
        history.push({
          cycle,
          audit: nextAuditPath,
          global_score: nextMetrics.globalScore,
          delta,
          totals: nextMetrics.totals,
          accepted: false,
          candidates: candidateSummary
        });
        console.log(`Ciclo ${cycle}: delta ${delta}. Rollback aplicado e candidatos rejeitados.`);
      }
    }

    await writeJson(args.historyPath, history);

    if (currentMetrics.globalScore >= args.targetScore) {
      console.log(`Meta atingida: ${currentMetrics.globalScore}% >= ${args.targetScore}%`);
      break;
    }

    if (stagnation >= args.stagnationLimit) {
      console.log(`Limite de estagnação atingido (${stagnation} ciclos sem ganho). Encerrando.`);
      break;
    }
  }

  await writeJson(args.historyPath, history);
  await writeJson(args.rejectionsPath, rejections);

  console.log("\nHistórico do autopiloto:");
  console.log(JSON.stringify(history, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
