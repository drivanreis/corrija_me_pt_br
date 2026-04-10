import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_CASES = "data/test-cases/curated-proof.json";
const DEFAULT_OUTPUT = "data/benchmarks/hybrid-routing-report.json";

function parseArgs(argv) {
  const args = {
    cases: DEFAULT_CASES,
    output: DEFAULT_OUTPUT,
    limit: 0,
    skipBuild: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--cases" && next) {
      args.cases = next;
      index += 1;
    } else if (current === "--output" && next) {
      args.output = next;
      index += 1;
    } else if (current === "--limit" && next) {
      args.limit = Number(next);
      index += 1;
    } else if (current === "--skip-build") {
      args.skipBuild = true;
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 0 || args.limit > 10000) {
    throw new Error("Use --limit com um inteiro entre 0 e 10000.");
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
        return;
      }
      reject(new Error(`Falha ao executar: ${label} (exit ${code ?? "null"})`));
    });
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

async function readCases(filePath, limit) {
  const content = JSON.parse(await fs.readFile(path.resolve(process.cwd(), filePath), "utf8"));
  if (!Array.isArray(content)) {
    throw new Error("Arquivo de casos não contém um array JSON.");
  }

  const items = content.map((item, index) => ({
    id: String(item.id || `case-${index + 1}`),
    errado: String(item.errado || item.original || "").trim(),
    correto: String(item.correto || item.expected || "").trim(),
    category: String(item.category || ""),
    difficulty: Number(item.difficulty || 0)
  })).filter((item) => item.errado && item.correto);

  return limit > 0 ? items.slice(0, limit) : items;
}

function applyMatches(original, payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  if (!matches.length) {
    return original;
  }

  const ordered = [...matches]
    .filter((match) => typeof match.offset === "number" && typeof match.length === "number" && Array.isArray(match.replacements) && match.replacements[0]?.value)
    .sort((left, right) => right.offset - left.offset);

  let nextText = original;
  for (const match of ordered) {
    const replacement = String(match.replacements[0].value || "");
    nextText = `${nextText.slice(0, match.offset)}${replacement}${nextText.slice(match.offset + match.length)}`;
  }
  return nextText;
}

async function postCheck(port, endpoint, text) {
  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Falha no endpoint ${endpoint}: http_${response.status}`);
  }

  const payload = await response.json();
  const resultPayload = payload?.result && Array.isArray(payload.result.matches) ? payload.result : payload;
  return {
    payload,
    correctedText: applyMatches(text, resultPayload),
    latencyMs: Date.now() - startedAt
  };
}

async function readHealth(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) {
    throw new Error(`Falha ao consultar /health: http_${response.status}`);
  }
  return response.json();
}

function createEmptySummary() {
  return {
    total: 0,
    exact: 0,
    changed: 0,
    unchanged: 0,
    avgLatencyMs: 0,
    llmUsed: 0,
    llmChanged: 0,
    llmAttempted: 0,
    timedOut: 0,
    fellBackToMotor: 0
  };
}

function createSummaryBucketMap() {
  return Object.create(null);
}

function updateSummary(summary, correctedText, expectedText, originalText, latencyMs, llmMeta = null) {
  summary.total += 1;
  summary.avgLatencyMs += latencyMs;
  if (correctedText === expectedText) {
    summary.exact += 1;
  }
  if (correctedText === originalText) {
    summary.unchanged += 1;
  } else {
    summary.changed += 1;
  }

  if (llmMeta?.used) {
    summary.llmUsed += 1;
  }

  if (llmMeta?.changed) {
    summary.llmChanged += 1;
  }

  if (llmMeta?.attempted) {
    summary.llmAttempted += 1;
  }

  if (llmMeta?.timedOut) {
    summary.timedOut += 1;
  }

  if (llmMeta?.fellBackToMotor) {
    summary.fellBackToMotor += 1;
  }
}

function updateBucketSummary(bucketMap, key, correctedText, expectedText, originalText, latencyMs, llmMeta = null) {
  if (!bucketMap[key]) {
    bucketMap[key] = createEmptySummary();
  }

  updateSummary(bucketMap[key], correctedText, expectedText, originalText, latencyMs, llmMeta);
}

function finalizeSummary(summary) {
  if (summary.total > 0) {
    summary.avgLatencyMs = Number((summary.avgLatencyMs / summary.total).toFixed(2));
    summary.exactRate = Number((summary.exact / summary.total).toFixed(4));
    summary.llmUsedRate = Number((summary.llmUsed / summary.total).toFixed(4));
    summary.llmChangedRate = Number((summary.llmChanged / summary.total).toFixed(4));
    summary.llmAttemptedRate = Number((summary.llmAttempted / summary.total).toFixed(4));
    summary.timedOutRate = Number((summary.timedOut / summary.total).toFixed(4));
    summary.fellBackToMotorRate = Number((summary.fellBackToMotor / summary.total).toFixed(4));
  } else {
    summary.exactRate = 0;
    summary.llmUsedRate = 0;
    summary.llmChangedRate = 0;
    summary.llmAttemptedRate = 0;
    summary.timedOutRate = 0;
    summary.fellBackToMotorRate = 0;
  }
  return summary;
}

function finalizeBucketSummary(bucketMap) {
  return Object.fromEntries(
    Object.entries(bucketMap)
      .sort((left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0], "pt-BR"))
      .map(([key, summary]) => [key, finalizeSummary(summary)])
  );
}

async function writeJson(filePath, value) {
  const fullPath = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = await readCases(args.cases, args.limit);
  const port = await findFreePort();

  if (!args.skipBuild) {
    await runCommand("npm", ["run", "build"], "npm run build");
  }

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

  try {
    await delay(1000);
    const health = await readHealth(port);

    const motorSummary = createEmptySummary();
    const hybridSummary = createEmptySummary();
    const routingReasons = {};
    const routingReasonSummaries = createSummaryBucketMap();
    const routeTargetSummaries = createSummaryBucketMap();
    const targetLayerSummaries = createSummaryBucketMap();
    const items = [];

    for (const testCase of cases) {
      const motor = await postCheck(port, "/v2/check", testCase.errado);
      const hybrid = await postCheck(port, "/v2/check-smart", testCase.errado);
      const routeReason = String(hybrid.payload?.core?.routing?.reason || "desconhecido");
      const routeTarget = String(hybrid.payload?.core?.routing?.routeTarget || "desconhecido");
      const targetLayer = String(hybrid.payload?.core?.targetLayer || "desconhecido");
      const llmMeta = {
        used: Boolean(hybrid.payload?.core?.used),
        changed: Boolean(hybrid.payload?.core?.changed),
        attempted: Boolean(hybrid.payload?.core?.attempted),
        timedOut: Boolean(hybrid.payload?.core?.timedOut),
        fellBackToMotor: routeTarget === "jandaia_1" && targetLayer === "motor"
      };
      routingReasons[routeReason] = (routingReasons[routeReason] || 0) + 1;

      updateSummary(motorSummary, motor.correctedText, testCase.correto, testCase.errado, motor.latencyMs);
      updateSummary(hybridSummary, hybrid.correctedText, testCase.correto, testCase.errado, hybrid.latencyMs, llmMeta);
      updateBucketSummary(routingReasonSummaries, routeReason, hybrid.correctedText, testCase.correto, testCase.errado, hybrid.latencyMs, llmMeta);
      updateBucketSummary(routeTargetSummaries, routeTarget, hybrid.correctedText, testCase.correto, testCase.errado, hybrid.latencyMs, llmMeta);
      updateBucketSummary(targetLayerSummaries, targetLayer, hybrid.correctedText, testCase.correto, testCase.errado, hybrid.latencyMs, llmMeta);

      items.push({
        id: testCase.id,
        category: testCase.category,
        difficulty: testCase.difficulty,
        original: testCase.errado,
        expected: testCase.correto,
        motor: {
          correctedText: motor.correctedText,
          exact: motor.correctedText === testCase.correto,
          latencyMs: motor.latencyMs
        },
        hybrid: {
          correctedText: hybrid.correctedText,
          exact: hybrid.correctedText === testCase.correto,
          latencyMs: hybrid.latencyMs,
          routeReason,
          routeTarget,
          targetLayer,
          llmUsed: llmMeta.used,
          llmChanged: llmMeta.changed,
          llmAttempted: llmMeta.attempted,
          timedOut: llmMeta.timedOut,
          fellBackToMotor: llmMeta.fellBackToMotor
        }
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      casesFile: args.cases,
      total: cases.length,
      runtime: {
        llmCoreEnabled: Boolean(health?.llmCore?.enabled),
        llmCoreReachable: Boolean(health?.llmCore?.reachable),
        llmCoreModel: String(health?.llmCore?.model || ""),
        architecturePhase: String(health?.architecture?.implementation?.phase || ""),
        note: health?.llmCore?.enabled
          ? "llm_core_habilitado"
          : "llm_core_desabilitado"
      },
      systems: {
        motor: finalizeSummary(motorSummary),
        hybrid: finalizeSummary(hybridSummary)
      },
      delta: {
        exact: hybridSummary.exact - motorSummary.exact,
        exactRate: Number((((hybridSummary.exact / Math.max(hybridSummary.total, 1)) - (motorSummary.exact / Math.max(motorSummary.total, 1))) || 0).toFixed(4))
      },
      routingReasons,
      routingReasonSummaries: finalizeBucketSummary(routingReasonSummaries),
      routeTargetSummaries: finalizeBucketSummary(routeTargetSummaries),
      targetLayerSummaries: finalizeBucketSummary(targetLayerSummaries),
      items
    };

    await writeJson(args.output, report);
    console.log(JSON.stringify({
      output: args.output,
      total: report.total,
      runtime: report.runtime,
      motor: report.systems.motor,
      hybrid: report.systems.hybrid,
      delta: report.delta,
      routingReasons: report.routingReasons,
      routeTargetSummaries: report.routeTargetSummaries
    }, null, 2));
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
