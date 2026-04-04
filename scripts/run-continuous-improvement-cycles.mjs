import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_RULES_PATH = "data/rules/phrase_rules_continuous.json";
const DEFAULT_BASE_AUDIT = "data/test-cases/latest-audit.json";
const DEFAULT_TARGET_SCORE = 99;
const DEFAULT_MAX_CYCLES = 10;
const DEFAULT_ROUNDS = 5;

function parseArgs(argv) {
  const args = {
    rulesPath: DEFAULT_RULES_PATH,
    baseAudit: DEFAULT_BASE_AUDIT,
    rounds: DEFAULT_ROUNDS,
    targetScore: DEFAULT_TARGET_SCORE,
    maxCycles: DEFAULT_MAX_CYCLES
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--rules" && next) {
      args.rulesPath = next;
      index += 1;
    } else if (current === "--base-audit" && next) {
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

  if (!Number.isInteger(args.rounds) || args.rounds < 1 || args.rounds > 6) {
    throw new Error("Use --rounds com um inteiro entre 1 e 6.");
  }

  if (!Number.isInteger(args.targetScore) || args.targetScore < 1 || args.targetScore > 100) {
    throw new Error("Use --target-score com um inteiro entre 1 e 100.");
  }

  if (!Number.isInteger(args.maxCycles) || args.maxCycles < 1 || args.maxCycles > 50) {
    throw new Error("Use --max-cycles com um inteiro entre 1 e 50.");
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(process.cwd(), filePath), "utf8"));
}

async function writeJson(filePath, value) {
  await fs.writeFile(path.resolve(process.cwd(), filePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeRules(current, next) {
  const byKey = new Map();

  for (const rule of [...current, ...next]) {
    const key = JSON.stringify([rule.pattern, rule.replacements]);
    if (!byKey.has(key)) {
      byKey.set(key, rule);
    }
  }

  return [...byKey.values()];
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

  const initialMetrics = await readAuditMetrics(auditPath);
  history.push({
    cycle: 0,
    audit: auditPath,
    global_score: initialMetrics.globalScore,
    totals: initialMetrics.totals
  });

  console.log(`Score inicial: ${initialMetrics.globalScore}%`);

  for (let cycle = 1; cycle <= args.maxCycles; cycle += 1) {
    const generatedRulesPath = `/tmp/phrase_rules_continuous.cycle${cycle}.json`;
    const nextAuditPath = `/tmp/corrija-audit-rounds${args.rounds}-cycle${cycle}.json`;

    await runCommand("node", [
      "scripts/continuous-improvement-loop.mjs",
      "--audit", auditPath,
      "--output", generatedRulesPath
    ], `continuous loop cycle ${cycle}`);

    const [currentRules, nextRules] = await Promise.all([
      readJson(args.rulesPath),
      readJson(generatedRulesPath)
    ]);
    const mergedRules = mergeRules(currentRules, nextRules);
    await writeJson(args.rulesPath, mergedRules);
    console.log(`Ciclo ${cycle}: regras contínuas ${currentRules.length} -> ${mergedRules.length}`);

    await runCommand("npm", ["run", "build"], "build");
    await runCommand("npm", [
      "run",
      "automate:battery",
      "--",
      "--rounds", String(args.rounds),
      "--skip-generate",
      "--audit-output", nextAuditPath
    ], `battery cycle ${cycle}`);

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
      console.log(`Ciclo ${cycle}: sem ganho adicional. Interrompendo para evitar trabalho cego.`);
      break;
    }
  }

  console.log("\nHistórico dos ciclos:");
  console.log(JSON.stringify(history, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
