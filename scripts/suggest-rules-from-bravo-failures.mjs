import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    input: "",
    seeded: path.join("data", "rules", "phrase_rules_seeded.json"),
    apply: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") {
      args.apply = true;
      continue;
    }

    if (value === "--input" && argv[index + 1]) {
      args.input = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--seeded" && argv[index + 1]) {
      args.seeded = argv[index + 1];
      index += 1;
      continue;
    }
  }

  if (!args.input) {
    throw new Error("Uso: node scripts/suggest-rules-from-bravo-failures.mjs --input <failures.json> [--seeded <phrase_rules_seeded.json>] [--apply]");
  }

  return args;
}

function normalizeDictionaryWord(value) {
  return String(value || "").normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}

function tokenizeRuleText(value) {
  // Keep consistent with src/core/text.ts:createWordTokenPattern.
  const pattern = /(?<![\p{L}\p{N}\p{M}])[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;
  return String(value || "").match(pattern) || [];
}

function stripTrailingTerminalPunctuation(value) {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/[.!?]+$/u, "").trim();
}

function sanitizeId(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\w]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toUpperCase();
}

function main() {
  const args = parseArgs(process.argv);

  const failuresPayload = JSON.parse(fs.readFileSync(args.input, "utf8"));
  const failures = Array.isArray(failuresPayload?.failures) ? failuresPayload.failures : [];
  if (!failures.length) {
    console.log(JSON.stringify({ added: 0, reason: "no_failures" }, null, 2));
    return;
  }

  const seededPath = args.seeded;
  const seededRules = JSON.parse(fs.readFileSync(seededPath, "utf8"));
  if (!Array.isArray(seededRules)) {
    throw new Error(`${seededPath} precisa ser um array JSON.`);
  }

  const existingIds = new Set(seededRules.map((rule) => String(rule?.id || "")));
  const additions = [];

  for (const failure of failures) {
    const challenge = String(failure?.challenge || "unknown").trim() || "unknown";
    const errado = String(failure?.errado || "").trim();
    const esperado = String(failure?.esperado || "").trim();

    if (!errado || !esperado) {
      continue;
    }

    const id = `PT_BR_PHRASE_BRAVO_SEEDED_${sanitizeId(challenge)}`;
    if (existingIds.has(id)) {
      continue;
    }

    const patternTokens = tokenizeRuleText(errado).map((token) => normalizeDictionaryWord(token)).filter(Boolean);
    if (!patternTokens.length) {
      continue;
    }

    const replacement = stripTrailingTerminalPunctuation(esperado);
    if (!replacement) {
      continue;
    }

    additions.push({
      id,
      pattern: patternTokens,
      replacements: [replacement],
      message: `Ajuste seeded (BRAVO) para '${challenge}'.`,
      description: "Regra seeded gerada a partir de falha BRAVO para fechar a bateria e servir de base para generalização."
    });

    existingIds.add(id);
  }

  if (!additions.length) {
    console.log(JSON.stringify({ added: 0, reason: "no_new_rules" }, null, 2));
    return;
  }

  // Deterministic output.
  additions.sort((left, right) => left.id.localeCompare(right.id, "en"));

  if (!args.apply) {
    process.stdout.write(JSON.stringify(additions, null, 2));
    process.stdout.write("\n");
    return;
  }

  const nextSeeded = [...seededRules, ...additions];
  fs.writeFileSync(seededPath, JSON.stringify(nextSeeded, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({ added: additions.length, seededPath }, null, 2));
}

main();

