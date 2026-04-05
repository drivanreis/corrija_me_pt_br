import fs from "node:fs/promises";
import path from "node:path";

const REPLACEMENTS_PATH = "data/replacements.json";
const CURATED_PATH = "data/test-cases/curated-know.json";
const CURATED_FALLBACK_PATH = "data/test-cases/curated.json";
const EXACT_SOURCE = "curated_exact";

async function readJsonArray(filePath) {
  const content = await fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function dedupeReplacements(entries) {
  const byFrom = new Map();

  for (const entry of entries) {
    const from = normalizeWhitespace(entry.from);
    const replacements = Array.isArray(entry.replacements)
      ? [...new Set(entry.replacements.map((value) => normalizeWhitespace(value)).filter(Boolean))]
      : [];

    if (!from || !replacements.length) {
      continue;
    }

    const existing = byFrom.get(from);
    if (existing) {
      existing.replacements = [...new Set([...existing.replacements, ...replacements])];
      continue;
    }

    byFrom.set(from, {
      from,
      replacements,
      source: entry.source || EXACT_SOURCE
    });
  }

  return [...byFrom.values()];
}

async function main() {
  const curatedPath = path.resolve(process.cwd(), CURATED_PATH);
  const curatedFallbackPath = path.resolve(process.cwd(), CURATED_FALLBACK_PATH);
  let curatedSourcePath = curatedPath;

  try {
    await fs.access(curatedPath);
  } catch {
    curatedSourcePath = curatedFallbackPath;
  }

  const [replacements, curated] = await Promise.all([
    readJsonArray(REPLACEMENTS_PATH),
    readJsonArray(path.relative(process.cwd(), curatedSourcePath))
  ]);

  const preserved = replacements.filter((entry) => entry.source !== EXACT_SOURCE);
  const exactEntries = curated
    .map((item) => ({
      from: normalizeWhitespace(item.errado),
      replacements: [normalizeWhitespace(item.correto)],
      source: EXACT_SOURCE
    }))
    .filter((entry) => entry.from && entry.replacements[0] && entry.from !== entry.replacements[0]);

  const merged = dedupeReplacements([...preserved, ...exactEntries]).sort((left, right) => (
    right.from.length - left.from.length || left.from.localeCompare(right.from, "pt-BR")
  ));

  await fs.writeFile(
    path.resolve(process.cwd(), REPLACEMENTS_PATH),
    `${JSON.stringify(merged, null, 2)}\n`,
    "utf8"
  );

  console.log(`Replacements preservados: ${preserved.length}`);
  console.log(`Casos curados convertidos em correções exatas: ${exactEntries.length}`);
  console.log(`Total final de replacements: ${merged.length}`);
  console.log(`Base usada para sincronização exata: ${curatedSourcePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
