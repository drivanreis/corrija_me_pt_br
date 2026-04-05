import fs from "node:fs/promises";
import path from "node:path";

const KNOW_PATH = "data/test-cases/curated-know.json";
const PROOF_PATH = "data/test-cases/curated-proof.json";
const PARTITIONS_REPORT_PATH = "data/test-cases/curated-partitions-report.json";
const REBALANCE_REPORT_PATH = "data/test-cases/curated-proof-rebalance-report.json";

const CATEGORY_TARGETS = {
  acentuacao: 40,
  pontuacao: 50,
  hifen: 45,
  ortografia: 70,
  anuncios: 60,
  "texto tecnico": 80
};

const DIFFICULTY_TARGETS = {
  1: 60,
  2: 280,
  3: 180,
  4: 260,
  5: 180
};

const MULTI_ERROR_TARGET = 540;

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function stripDiacritics(value) {
  return normalizeWhitespace(value).normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function normalizeKey(value) {
  return stripDiacritics(value).toLowerCase();
}

async function readJsonArray(filePath) {
  const content = await fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeJson(filePath, payload) {
  await fs.writeFile(path.resolve(process.cwd(), filePath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function buildCounter(items, selector) {
  const counts = new Map();
  for (const item of items) {
    increment(counts, selector(item));
  }
  return counts;
}

function summarizeCounts(items) {
  const byDifficulty = Object.fromEntries(
    [...buildCounter(items, (item) => String(Number(item.difficulty) || 0)).entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
  );
  const byErrorCount = Object.fromEntries(
    [...buildCounter(items, (item) => String(Number(item.error_count) || 0)).entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
  );
  const byCategory = Object.fromEntries(
    [...buildCounter(items, (item) => normalizeKey(item.category) || "__none__").entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
  );

  return {
    total: items.length,
    by_difficulty: byDifficulty,
    by_error_count: byErrorCount,
    by_category: byCategory
  };
}

function buildCoverageSummary(items) {
  const counts = new Map();
  for (const item of items) {
    const familyKeys = item.partition_metadata?.family_keys || [];
    for (const key of familyKeys) {
      increment(counts, key);
    }
  }

  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family, "pt-BR"));
}

function toShortSample(item) {
  return {
    id: item.id,
    category: item.category,
    difficulty: item.difficulty,
    error_count: item.error_count,
    errado: item.errado,
    correto: item.correto
  };
}

function mainCategoryKey(item) {
  return normalizeKey(item.category);
}

function hasMultipleErrors(item) {
  return Number(item.error_count) > 1;
}

function computeState(proofItems) {
  const categoryCounts = buildCounter(proofItems, (item) => mainCategoryKey(item));
  const difficultyCounts = buildCounter(proofItems, (item) => Number(item.difficulty) || 0);
  const multiErrorCount = proofItems.filter(hasMultipleErrors).length;

  return {
    categoryCounts,
    difficultyCounts,
    multiErrorCount
  };
}

function categoryDeficit(state, categoryKey) {
  return Math.max(0, (CATEGORY_TARGETS[categoryKey] || 0) - (state.categoryCounts.get(categoryKey) || 0));
}

function difficultyDeficit(state, difficulty) {
  return Math.max(0, (DIFFICULTY_TARGETS[difficulty] || 0) - (state.difficultyCounts.get(difficulty) || 0));
}

function scoreCandidate(item, state) {
  const categoryKey = mainCategoryKey(item);
  const difficulty = Number(item.difficulty) || 0;
  const categoryGap = categoryDeficit(state, categoryKey);
  const difficultyGap = difficultyDeficit(state, difficulty);
  const familyWeight = item.partition_metadata?.family_keys?.length || 0;
  const tagWeight = Array.isArray(item.tags) ? item.tags.length : 0;

  return (
    categoryGap * 1000
    + difficultyGap * 250
    + (hasMultipleErrors(item) ? 200 : 0)
    + Math.max(0, (Number(item.error_count) || 0) - 1) * 35
    + familyWeight * 3
    + tagWeight * 5
  );
}

function chooseBestCandidate(knowItems, movedIds, predicate, state) {
  let best = null;
  let bestScore = -1;

  for (const item of knowItems) {
    if (movedIds.has(item.id) || !predicate(item)) {
      continue;
    }

    const score = scoreCandidate(item, state);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

function applyMove(item, proofItems, movedIds, movedItems, state) {
  proofItems.push(item);
  movedIds.add(item.id);
  movedItems.push(item);
  increment(state.categoryCounts, mainCategoryKey(item));
  increment(state.difficultyCounts, Number(item.difficulty) || 0);
  if (hasMultipleErrors(item)) {
    state.multiErrorCount += 1;
  }
}

async function main() {
  const know = await readJsonArray(KNOW_PATH);
  const proof = await readJsonArray(PROOF_PATH);

  const movedIds = new Set();
  const movedItems = [];
  const state = computeState(proof);

  const categoryPriority = Object.entries(CATEGORY_TARGETS)
    .sort((left, right) => categoryDeficit(state, right[0]) - categoryDeficit(state, left[0]));

  for (const [categoryKey, target] of categoryPriority) {
    while ((state.categoryCounts.get(categoryKey) || 0) < target) {
      const candidate = chooseBestCandidate(
        know,
        movedIds,
        (item) => mainCategoryKey(item) === categoryKey,
        state
      );

      if (!candidate) {
        break;
      }

      applyMove(candidate, proof, movedIds, movedItems, state);
    }
  }

  for (const [difficultyText, target] of Object.entries(DIFFICULTY_TARGETS)) {
    const difficulty = Number(difficultyText);
    while ((state.difficultyCounts.get(difficulty) || 0) < target) {
      const candidate = chooseBestCandidate(
        know,
        movedIds,
        (item) => Number(item.difficulty) === difficulty,
        state
      );

      if (!candidate) {
        break;
      }

      applyMove(candidate, proof, movedIds, movedItems, state);
    }
  }

  while (state.multiErrorCount < MULTI_ERROR_TARGET) {
    const candidate = chooseBestCandidate(
      know,
      movedIds,
      (item) => hasMultipleErrors(item),
      state
    );

    if (!candidate) {
      break;
    }

    applyMove(candidate, proof, movedIds, movedItems, state);
  }

  const newKnow = know.filter((item) => !movedIds.has(item.id));
  const proofIds = new Set(proof.map((item) => item.id));
  const overlap = newKnow.filter((item) => proofIds.has(item.id)).map((item) => item.id);

  if (overlap.length) {
    throw new Error(`Rebalance gerou sobreposição entre know e proof (${overlap.length} ids).`);
  }

  const proofFamilyKeys = new Set(proof.flatMap((item) => item.partition_metadata?.family_keys || []));
  const knowFamilyKeys = new Set(newKnow.flatMap((item) => item.partition_metadata?.family_keys || []));
  const allFamilyKeys = new Set([...proofFamilyKeys, ...knowFamilyKeys]);

  const previousReport = JSON.parse(await fs.readFile(path.resolve(process.cwd(), PARTITIONS_REPORT_PATH), "utf8"));
  const partitionsReport = {
    ...previousReport,
    generated_at: new Date().toISOString(),
    know_total: newKnow.length,
    proof_total: proof.length,
    proof_ratio: Number((proof.length / (proof.length + newKnow.length)).toFixed(4)),
    proof_family_keys: proofFamilyKeys.size,
    know_family_keys: knowFamilyKeys.size,
    uncovered_families_in_proof: [...allFamilyKeys].filter((key) => !proofFamilyKeys.has(key)).sort(),
    coverage_ok: [...allFamilyKeys].every((key) => proofFamilyKeys.has(key)),
    proof_coverage_by_family: buildCoverageSummary(proof),
    know_coverage_by_family: buildCoverageSummary(newKnow),
    rebalance: {
      moved_from_know_to_proof: movedItems.length,
      category_targets: CATEGORY_TARGETS,
      difficulty_targets: DIFFICULTY_TARGETS,
      multi_error_target: MULTI_ERROR_TARGET,
      moved_ids: movedItems.map((item) => item.id)
    }
  };

  const rebalanceReport = {
    generated_at: new Date().toISOString(),
    moved_total: movedItems.length,
    before: {
      know: summarizeCounts(know),
      proof: summarizeCounts(await readJsonArray(PROOF_PATH))
    },
    after: {
      know: summarizeCounts(newKnow),
      proof: summarizeCounts(proof)
    },
    moved_samples: movedItems.slice(0, 50).map(toShortSample)
  };

  await Promise.all([
    writeJson(KNOW_PATH, newKnow),
    writeJson(PROOF_PATH, proof),
    writeJson(PARTITIONS_REPORT_PATH, partitionsReport),
    writeJson(REBALANCE_REPORT_PATH, rebalanceReport)
  ]);

  console.log(`Movidos de know para proof: ${movedItems.length}`);
  console.log(`Know: ${know.length} -> ${newKnow.length}`);
  console.log(`Proof: ${rebalanceReport.before.proof.total} -> ${proof.length}`);
  console.log(`Relatório: ${path.resolve(process.cwd(), REBALANCE_REPORT_PATH)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
