import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_BASE_AUDIT = "data/test-cases/latest-audit.json";
const DEFAULT_TARGET_SCORE = 99;
const DEFAULT_MAX_CYCLES = 10;
const DEFAULT_ROUNDS = 2;
const DEFAULT_REPLACEMENTS_PATH = "data/replacements_proof.json";
const DEFAULT_PHRASE_RULES_PATH = "data/rules/phrase_rules_proof.json";
const DEFAULT_CONTEXT_RULES_PATH = "data/rules/context_rules_proof.json";

function parseArgs(argv) {
  const args = {
    baseAudit: DEFAULT_BASE_AUDIT,
    rounds: DEFAULT_ROUNDS,
    targetScore: DEFAULT_TARGET_SCORE,
    maxCycles: DEFAULT_MAX_CYCLES,
    replacementsPath: DEFAULT_REPLACEMENTS_PATH,
    phraseRulesPath: DEFAULT_PHRASE_RULES_PATH,
    contextRulesPath: DEFAULT_CONTEXT_RULES_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--base-audit" && next) {
      args.baseAudit = next;
      index += 1;
    } else if (current === "--rounds" && next) {
      args.rounds = Number(next);
      index += 1;
    } else if (current === "--target-score" && next) {
      args.targetScore = Number(next);
      index += 1;
    } else if (current === "--max-cycles" && next) {
      args.maxCycles = Number(next);
      index += 1;
    }
  }

  return args;
}

function runCommand(command, args, label = `${command} ${args.join(" ")}`, timeoutMs = 180_000) {
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
  await fs.writeFile(path.resolve(process.cwd(), filePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function ensureJsonArray(filePath) {
  const current = await readJson(filePath, null);
  if (Array.isArray(current)) {
    return current;
  }

  await writeJson(filePath, []);
  return [];
}

async function readAuditMetrics(filePath) {
  const audit = await readJson(filePath);
  return {
    globalScore: audit.global_score,
    totals: audit.totals
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let auditPath = args.baseAudit;
  const history = [];

  await Promise.all([
    ensureJsonArray(args.replacementsPath),
    ensureJsonArray(args.phraseRulesPath),
    ensureJsonArray(args.contextRulesPath)
  ]);

  const initialMetrics = await readAuditMetrics(auditPath);
  history.push({
    cycle: 0,
    audit: auditPath,
    global_score: initialMetrics.globalScore,
    totals: initialMetrics.totals
  });

  console.log(`Score inicial (proof sob proof-pardau): ${initialMetrics.globalScore}%`);

  for (let cycle = 1; cycle <= args.maxCycles; cycle += 1) {
    const candidatePath = `/tmp/proof-improvement-cycle-${cycle}.json`;
    const nextAuditPath = `/tmp/corrija-proof-audit-cycle-${cycle}.json`;

    console.log(`Ciclo ${cycle}: gerando candidatos a partir de ${auditPath} sob regime proof-pardau`);
    await runCommand("node", [
      "scripts/proof-driven-improvement-loop.mjs",
      "--audit", auditPath,
      "--output", candidatePath
    ], `proof improvement loop cycle ${cycle}`);

    const candidates = await readJson(candidatePath, {
      replacements: [],
      phraseRules: [],
      contextRules: []
    });

    const [currentReplacements, currentPhraseRules, currentContextRules] = await Promise.all([
      readJson(args.replacementsPath, []),
      readJson(args.phraseRulesPath, []),
      readJson(args.contextRulesPath, [])
    ]);

    const mergedReplacements = mergeByKey(currentReplacements, candidates.replacements || [], (entry) => (
      JSON.stringify([entry.from, entry.replacements])
    ));
    const mergedPhraseRules = mergeByKey(currentPhraseRules, candidates.phraseRules || [], (entry) => (
      JSON.stringify([entry.pattern, entry.replacements])
    ));
    const mergedContextRules = mergeByKey(currentContextRules, candidates.contextRules || [], (entry) => (
      JSON.stringify([entry.pattern, entry.targetIndex, entry.replacements])
    ));

    await Promise.all([
      writeJson(args.replacementsPath, mergedReplacements),
      writeJson(args.phraseRulesPath, mergedPhraseRules),
      writeJson(args.contextRulesPath, mergedContextRules)
    ]);

    console.log(
      `Ciclo ${cycle}: assets do proof-pardau -> replacements ${currentReplacements.length} -> ${mergedReplacements.length}, `
      + `phraseRules ${currentPhraseRules.length} -> ${mergedPhraseRules.length}, `
      + `contextRules ${currentContextRules.length} -> ${mergedContextRules.length}`
    );

    console.log(`Ciclo ${cycle}: rebuild com assets do proof-pardau`);
    await runCommand("npm", ["run", "build"], "build");
    console.log(`Ciclo ${cycle}: bateria do proof-pardau rounds=${args.rounds}`);
    await runCommand("npm", [
      "run",
      "automate:battery",
      "--",
      "--rounds", String(args.rounds),
      "--skip-generate",
      "--audit-output", nextAuditPath
    ], `proof battery cycle ${cycle}`);

    const previousMetrics = await readAuditMetrics(auditPath);
    const nextMetrics = await readAuditMetrics(nextAuditPath);
    const delta = nextMetrics.globalScore - previousMetrics.globalScore;

    history.push({
      cycle,
      audit: nextAuditPath,
      global_score: nextMetrics.globalScore,
      delta,
      totals: nextMetrics.totals
    });

    console.log(`Ciclo ${cycle}: score ${previousMetrics.globalScore}% -> ${nextMetrics.globalScore}% (delta ${delta >= 0 ? "+" : ""}${delta})`);

    auditPath = nextAuditPath;

    if (nextMetrics.globalScore >= args.targetScore) {
      console.log(`Meta atingida: ${nextMetrics.globalScore}% >= ${args.targetScore}%`);
      break;
    }

    if (delta <= 0) {
      console.log(`Ciclo ${cycle}: sem ganho adicional. Interrompendo para revisar os candidatos gerados.`);
      break;
    }
  }

  console.log("\nHistorico dos ciclos proof-driven sob proof-pardau:");
  console.log(JSON.stringify(history, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
