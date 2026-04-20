import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const DEFAULT_AUDIT = "data/test-cases/latest-audit.json";
const DEFAULT_CONTINUOUS_RULES = "data/rules/phrase_rules_continuous.json";

function parseArgs(argv) {
  const args = {
    audit: DEFAULT_AUDIT,
    continuousRules: DEFAULT_CONTINUOUS_RULES
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--audit" && next) {
      args.audit = next;
      index += 1;
    } else if (current === "--continuous-rules" && next) {
      args.continuousRules = next;
      index += 1;
    }
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

async function readJsonArray(filePath, label) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} deve ser um array JSON: ${absolutePath}`);
  }

  return parsed;
}

function validateRuleEntry(rule, label) {
  if (!rule || typeof rule !== "object") {
    throw new Error(`${label}: regra invalida (nao e objeto).`);
  }

  if (typeof rule.id !== "string" || !rule.id.trim()) {
    throw new Error(`${label}: regra sem id valido.`);
  }

  if (!Array.isArray(rule.pattern) || rule.pattern.length === 0) {
    throw new Error(`${label}: regra ${rule.id} sem pattern valido.`);
  }

  if (!Array.isArray(rule.replacements) || rule.replacements.length === 0) {
    throw new Error(`${label}: regra ${rule.id} sem replacements validos.`);
  }
}

function mergeRules(current, generated) {
  const map = new Map();

  for (const rule of [...current, ...generated]) {
    const key = JSON.stringify([rule.pattern, rule.replacements]);
    if (!map.has(key)) {
      map.set(key, rule);
    }
  }

  return [...map.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tmpOutput = path.join(os.tmpdir(), `corrija-continuous-test-${Date.now()}.json`);

  await runCommand("node", [
    "scripts/continuous-improvement-loop.mjs",
    "--audit",
    args.audit,
    "--output",
    tmpOutput
  ]);

  const [currentRules, generatedRules] = await Promise.all([
    readJsonArray(args.continuousRules, "Arquivo de regras contínuas"),
    readJsonArray(tmpOutput, "Arquivo gerado no teste contínuo")
  ]);

  for (const rule of generatedRules) {
    validateRuleEntry(rule, "Saida de continuous-improvement-loop");
  }

  const mergedRules = mergeRules(currentRules, generatedRules);

  if (mergedRules.length < currentRules.length) {
    throw new Error("Merge de regras contínuas reduziu a base existente.");
  }

  console.log(`regras_continuas_base=${currentRules.length}`);
  console.log(`regras_continuas_geradas=${generatedRules.length}`);
  console.log(`regras_continuas_mergeadas=${mergedRules.length}`);
  console.log(`arquivo_temporario=${tmpOutput}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
