import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const CURATED_PATH = "data/test-cases/curated.json";
const GENERATED_PATH = "data/test-cases/generated.json";
const CORE_CATEGORIES = [
  "ortografia",
  "acentuacao",
  "hifen",
  "pontuacao",
  "localizacao",
  "contexto",
  "homofonos",
  "anuncios",
  "texto_tecnico"
];
const DEFAULT_TARGETS = {
  1: 100,
  2: 400,
  3: 1200,
  4: 1600,
  5: 2000,
  6: 4000
};
const SUPPORTED_DIFFICULTIES = [1, 2, 3, 4, 5, 6];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    maxRoundsPerDifficulty: 8,
    overgenerateFactor: 1.6,
    perCategoryCap: 30,
    targets: { ...DEFAULT_TARGETS }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--dry-run") {
      args.dryRun = true;
    } else if (current === "--max-rounds-per-difficulty" && next) {
      args.maxRoundsPerDifficulty = Number(next);
      index += 1;
    } else if (current === "--overgenerate-factor" && next) {
      args.overgenerateFactor = Number(next);
      index += 1;
    } else if (current === "--per-category-cap" && next) {
      args.perCategoryCap = Number(next);
      index += 1;
    } else if (current === "--target-d1" && next) {
      args.targets[1] = Number(next);
      index += 1;
    } else if (current === "--target-d2" && next) {
      args.targets[2] = Number(next);
      index += 1;
    } else if (current === "--target-d3" && next) {
      args.targets[3] = Number(next);
      index += 1;
    } else if (current === "--target-d4" && next) {
      args.targets[4] = Number(next);
      index += 1;
    } else if (current === "--target-d5" && next) {
      args.targets[5] = Number(next);
      index += 1;
    } else if (current === "--target-d6" && next) {
      args.targets[6] = Number(next);
      index += 1;
    }
  }

  if (!Number.isInteger(args.maxRoundsPerDifficulty) || args.maxRoundsPerDifficulty < 1 || args.maxRoundsPerDifficulty > 50) {
    throw new Error("Use --max-rounds-per-difficulty com um inteiro entre 1 e 50.");
  }

  if (!Number.isFinite(args.overgenerateFactor) || args.overgenerateFactor < 1 || args.overgenerateFactor > 5) {
    throw new Error("Use --overgenerate-factor com um número entre 1 e 5.");
  }

  if (!Number.isInteger(args.perCategoryCap) || args.perCategoryCap < 1 || args.perCategoryCap > 50) {
    throw new Error("Use --per-category-cap com um inteiro entre 1 e 50.");
  }

  for (const difficulty of SUPPORTED_DIFFICULTIES) {
    if (!Number.isInteger(args.targets[difficulty]) || args.targets[difficulty] < 1 || args.targets[difficulty] > 5000) {
      throw new Error(`Use --target-d${difficulty} com um inteiro entre 1 e 5000.`);
    }
  }

  return args;
}

async function readJsonArray(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function getCountsByDifficulty() {
  const curatedPath = path.resolve(process.cwd(), CURATED_PATH);
  const generatedPath = path.resolve(process.cwd(), GENERATED_PATH);
  const [curatedItems, generatedItems] = await Promise.all([
    readJsonArray(curatedPath),
    readJsonArray(generatedPath)
  ]);

  const curatedCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const generatedCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const item of curatedItems) {
    const difficulty = Number(item.difficulty);
    if (difficulty >= 1 && difficulty <= 6) {
      curatedCounts[difficulty] += 1;
    }
  }

  for (const item of generatedItems) {
    const difficulty = Number(item.difficulty);
    if (difficulty >= 1 && difficulty <= 6) {
      generatedCounts[difficulty] += 1;
    }
  }

  return {
    curatedCounts,
    generatedCounts,
    curatedTotal: curatedItems.length,
    generatedTotal: generatedItems.length
  };
}

function buildDeficitReport(targets, curatedCounts) {
  return SUPPORTED_DIFFICULTIES.map((difficulty) => ({
    difficulty,
    current: curatedCounts[difficulty],
    target: targets[difficulty],
    deficit: Math.max(0, targets[difficulty] - curatedCounts[difficulty])
  }));
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

function selectPerCategoryCount(deficit, overgenerateFactor, perCategoryCap) {
  const estimated = Math.ceil((deficit * overgenerateFactor) / CORE_CATEGORIES.length);
  return Math.max(1, Math.min(perCategoryCap, estimated));
}

async function topUpDifficulty(difficulty, target, args) {
  let rounds = 0;
  let stalledRounds = 0;
  let current = (await getCountsByDifficulty()).curatedCounts[difficulty];

  while (current < target && rounds < args.maxRoundsPerDifficulty) {
    const deficit = target - current;
    let perCategoryCount = selectPerCategoryCount(deficit, args.overgenerateFactor, args.perCategoryCap);
    const categoriesArg = CORE_CATEGORIES.join(",");

    rounds += 1;
    console.log(`\n[D${difficulty}] rodada ${rounds} | atual=${current} alvo=${target} deficit=${deficit} | gerando ${perCategoryCount} por categoria`);

    let generated = false;
    let attempts = 0;

    while (!generated && perCategoryCount >= 1) {
      attempts += 1;
      try {
        await runCommand("node", [
          "scripts/generate-test-cases.mjs",
          "--categories", categoriesArg,
          "--count-per-category", String(perCategoryCount),
          "--difficulty", String(difficulty)
        ], `generate difficulty ${difficulty}`);
        generated = true;
      } catch (error) {
        const nextPerCategoryCount = Math.max(1, Math.floor(perCategoryCount / 2));
        if (nextPerCategoryCount === perCategoryCount) {
          throw error;
        }
        console.log(`[D${difficulty}] falha na geração (tentativa ${attempts}). Recuando lote para ${nextPerCategoryCount} por categoria.`);
        perCategoryCount = nextPerCategoryCount;
      }
    }

    await runCommand("node", ["scripts/curate-test-cases.mjs"], "curate test cases");

    const afterCounts = await getCountsByDifficulty();
    const nextCurrent = afterCounts.curatedCounts[difficulty];
    const delta = nextCurrent - current;
    console.log(`[D${difficulty}] ganho curado na rodada: ${delta >= 0 ? `+${delta}` : delta} | novo total=${nextCurrent}`);

    if (delta <= 0) {
      stalledRounds += 1;
    } else {
      stalledRounds = 0;
    }

    current = nextCurrent;

    if (stalledRounds >= 2) {
      console.log(`[D${difficulty}] interrompido por estagnação após ${stalledRounds} rodadas sem ganho curado.`);
      break;
    }
  }

  return {
    difficulty,
    final: current,
    target,
    completed: current >= target,
    rounds
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const initial = await getCountsByDifficulty();
  const initialReport = buildDeficitReport(args.targets, initial.curatedCounts);

  console.log("Panorama inicial por dificuldade:");
  console.log(JSON.stringify({
    curated_total: initial.curatedTotal,
    generated_total: initial.generatedTotal,
    difficulties: initialReport
  }, null, 2));

  if (args.dryRun) {
    return;
  }

  const results = [];
  for (const difficulty of SUPPORTED_DIFFICULTIES) {
    if (initial.curatedCounts[difficulty] >= args.targets[difficulty]) {
      results.push({
        difficulty,
        final: initial.curatedCounts[difficulty],
        target: args.targets[difficulty],
        completed: true,
        rounds: 0
      });
      continue;
    }

    results.push(await topUpDifficulty(difficulty, args.targets[difficulty], args));
  }

  const finalCounts = await getCountsByDifficulty();
  const finalReport = buildDeficitReport(args.targets, finalCounts.curatedCounts);

  console.log("\nPanorama final por dificuldade:");
  console.log(JSON.stringify({
    curated_total: finalCounts.curatedTotal,
    generated_total: finalCounts.generatedTotal,
    difficulties: finalReport,
    rounds: results
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
