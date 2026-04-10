import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES = [
  path.join(ROOT, "data", "ai", "jandaia-1-eval.json"),
  path.join(ROOT, "data", "test-cases", "curated-proof.json"),
  path.join(ROOT, "data", "test-cases", "curated-know.json")
];
const OUTPUT_JSONL = path.join(ROOT, "data", "ai", "jandaia-specialization-corpus.jsonl");
const OUTPUT_SUMMARY = path.join(ROOT, "data", "ai", "jandaia-specialization-corpus-summary.json");

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

function buildInstruction(errado) {
  return [
    "Corrija a frase com a menor quantidade de mudanças possível.",
    "Preserve o sentido original e não reescreva por estilo.",
    `Frase: ${errado}`
  ].join("\n");
}

function toTrainingRecord(item, sourceLabel) {
  const errado = normalizeText(item.errado || item.input || item.original);
  const correto = normalizeText(item.correto || item.expected);

  if (!errado || !correto) {
    return null;
  }

  return {
    source: sourceLabel,
    id: String(item.id || ""),
    instruction: buildInstruction(errado),
    input: errado,
    output: JSON.stringify({
      final: correto,
      changed: errado !== correto
    }),
    metadata: {
      category: String(item.category || ""),
      difficulty: Number(item.difficulty || 0),
      tags: Array.isArray(item.tags) ? item.tags : []
    }
  };
}

async function main() {
  const records = [];

  for (const sourcePath of SOURCES) {
    const raw = JSON.parse(await fs.readFile(sourcePath, "utf8"));
    const items = Array.isArray(raw) ? raw : [];
    const sourceLabel = path.relative(ROOT, sourcePath);

    for (const item of items) {
      const record = toTrainingRecord(item, sourceLabel);
      if (record) {
        records.push(record);
      }
    }
  }

  const uniqueRecords = Array.from(new Map(records.map((record) => [`${record.input}=>${record.output}`, record])).values());
  await fs.writeFile(
    OUTPUT_JSONL,
    `${uniqueRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );

  const summary = {
    total: uniqueRecords.length,
    sources: SOURCES.map((sourcePath) => path.relative(ROOT, sourcePath))
  };

  await fs.writeFile(OUTPUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
