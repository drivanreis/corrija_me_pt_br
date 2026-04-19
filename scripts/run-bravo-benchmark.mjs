import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CASE_FILE = "test/bravo-cases.json";
const DEFAULT_MODE = "motor"; // motor | jandaia
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "jandaia-1";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_OUT_DIR = "test";

function parseArgs(argv) {
  const args = {
    caseFile: DEFAULT_CASE_FILE,
    mode: DEFAULT_MODE,
    outDir: DEFAULT_OUT_DIR,
    // motor
    motorTransport: "ipc", // ipc | http (http not implemented here)
    // jandaia
    llmCoreUrl: DEFAULT_OLLAMA_URL,
    llmCoreModel: DEFAULT_OLLAMA_MODEL,
    llmTimeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--case-file" && next) {
      args.caseFile = next;
      index += 1;
    } else if (current === "--mode" && next) {
      args.mode = next;
      index += 1;
    } else if (current === "--out-dir" && next) {
      args.outDir = next;
      index += 1;
    } else if (current === "--motor-transport" && next) {
      args.motorTransport = next;
      index += 1;
    } else if (current === "--llm-core-url" && next) {
      args.llmCoreUrl = next;
      index += 1;
    } else if (current === "--llm-core-model" && next) {
      args.llmCoreModel = next;
      index += 1;
    } else if (current === "--llm-timeout-ms" && next) {
      args.llmTimeoutMs = Number(next);
      index += 1;
    }
  }

  if (!["motor", "jandaia"].includes(args.mode)) {
    throw new Error("--mode deve ser motor|jandaia.");
  }

  if (!["ipc"].includes(args.motorTransport)) {
    throw new Error("--motor-transport suportado: ipc.");
  }

  if (!Number.isFinite(args.llmTimeoutMs) || args.llmTimeoutMs < 1000 || args.llmTimeoutMs > 60_000) {
    throw new Error("--llm-timeout-ms deve estar entre 1000 e 60000.");
  }

  return args;
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function summarizeLatencies(latenciesMs) {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mean = sorted.length ? sum / sorted.length : 0;
  const p = (q) => {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
    return sorted[idx];
  };
  const median = p(0.5);
  const p90 = p(0.9);
  const p95 = p(0.95);
  const max = sorted.length ? sorted[sorted.length - 1] : 0;
  const min = sorted.length ? sorted[0] : 0;
  return { count: sorted.length, min, mean, median, p90, p95, max };
}

function applyMatches(original, payload) {
  const matches = Array.isArray(payload?.matches) ? [...payload.matches] : [];
  if (!matches.length) {
    return original;
  }

  let text = original;
  matches.sort((left, right) => right.offset - left.offset);

  for (const match of matches) {
    const replacement = match?.replacements?.[0]?.value;
    if (!replacement && replacement !== "") {
      continue;
    }
    text = text.slice(0, match.offset) + replacement + text.slice(match.offset + match.length);
  }

  return text;
}

async function loadCases(caseFile) {
  const raw = await fs.readFile(caseFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("case file deve ser um array JSON.");
  }

  const normalized = parsed.map((entry) => ({
    id: String(entry?.id || "").trim(),
    challenge: String(entry?.challenge || "").trim(),
    errado: String(entry?.errado || "").trim(),
    esperado: String(entry?.esperado || "").trim()
  })).filter((entry) => entry.id && entry.challenge && entry.errado && entry.esperado);

  if (!normalized.length) {
    throw new Error("case file não tem casos válidos.");
  }

  return normalized;
}

function createMotorWorker() {
  const child = spawn(process.execPath, ["build/node-app/backend/server.cjs"], {
    env: { ...process.env, CORRIJA_ME_CHILD_MODE: "check-worker" },
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });

  let sequence = 0;
  const pending = new Map();

  child.on("message", (message) => {
    const id = message?.id ?? -1;
    const job = pending.get(id);
    if (!job) {
      return;
    }

    pending.delete(id);

    if (message?.ok) {
      job.resolve(message.result);
      return;
    }

    job.reject(new Error(message?.error || "worker_failed"));
  });

  child.on("error", (error) => {
    for (const job of pending.values()) {
      job.reject(error);
    }
    pending.clear();
  });

  function check(text) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.send({ id, text });
    });
  }

  return {
    check,
    close: () => child.kill("SIGTERM")
  };
}

const JANDAIA_DIRECTIVE = [
  "Você é jandaia 1, especialista em correção de português do Brasil.",
  "Sua tarefa é corrigir a frase com a MENOR quantidade de mudanças possível.",
  "Preserve o sentido original e as palavras já corretas.",
  "Não reescreva por estilo e não troque palavras por sinônimos.",
  "Não invente detalhes e não acrescente informação.",
  "Responda em uma única linha no formato <final>FRASE_CORRIGIDA</final>.",
  "Não escreva nada antes ou depois do <final>...</final>."
].join("\n");

function buildJandaiaPrompt(text) {
  return [
    JANDAIA_DIRECTIVE,
    "",
    "Exemplos:",
    "Errada: A gente vamos no cinema amanhã.",
    "<final>A gente vai ao cinema amanhã.</final>",
    "",
    "Errada: A seção de cinema começa às 20h.",
    "<final>A sessão de cinema começa às 20h.</final>",
    "",
    "Errada: Ele não sabe porque você faltou.",
    "<final>Ele não sabe por que você faltou.</final>",
    "",
    "Agora corrija apenas a frase abaixo.",
    `Errada: ${text}`
  ].join("\n");
}

function looksLikeCleanSentence(text) {
  if (!text) return false;
  if (/[<>{}\[\]]/u.test(text)) return false;
  if (/\b(?:resposta|instruction|instrução|prompt)\b/iu.test(text)) return false;
  if (text.length < 3 || text.length > 280) return false;
  const letterCount = (text.match(/\p{L}/gu) || []).length;
  if (letterCount < 2) return false;
  return true;
}

function normalizeGeneratedText(text) {
  const finalTagMatches = [...text.matchAll(/<final>([\s\S]*?)<\/final>/giu)];
  if (finalTagMatches.length) {
    const last = finalTagMatches[finalTagMatches.length - 1];
    const candidate = String(last?.[1] || "").trim();
    if (looksLikeCleanSentence(candidate)) return candidate;
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/u);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const structuredFinal = String(parsed?.final || "").trim();
      if (looksLikeCleanSentence(structuredFinal)) return structuredFinal;
    } catch {
      // ignore
    }
  }

  const cleaned = text
    .trim()
    .replace(/<[^>]+>/gu, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^corrigida:\s*/iu, "")
    .replace(/^frase corrigida:\s*/iu, "")
    .trim();

  const firstLine = (cleaned.split(/\r?\n/u)[0] || "").trim();
  if (!looksLikeCleanSentence(firstLine)) return "";
  return firstLine;
}

async function assertOllamaReady(baseUrl, model) {
  let versionRes;
  try {
    versionRes = await fetch(`${baseUrl}/api/version`, { method: "GET" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Ollama indisponível em ${baseUrl} (${message}).`);
  }

  if (!versionRes.ok) {
    throw new Error(`Ollama indisponível em ${baseUrl} (HTTP ${versionRes.status}).`);
  }

  const tagsRes = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
  if (!tagsRes.ok) {
    throw new Error(`Falha ao listar modelos no Ollama (HTTP ${tagsRes.status}).`);
  }

  const payload = await tagsRes.json();
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const modelFound = models.some((entry) => String(entry?.name || "").startsWith(`${model}:`));
  if (!modelFound) {
    throw new Error(`Modelo não encontrado no Ollama: ${model}.`);
  }
}

async function requestJandaiaSuggestion(text, { baseUrl, model, timeoutMs }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          temperature: 0,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.35,
          num_predict: 96,
          stop: ["</final>", "</instruction>"]
        },
        prompt: buildJandaiaPrompt(text)
      })
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return { correctedText: text, latencyMs, ok: false, error: `http_${response.status}` };
    }

    const payload = await response.json();
    const corrected = normalizeGeneratedText(String(payload?.response || ""));
    return { correctedText: corrected || text, latencyMs, ok: true };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return { correctedText: text, latencyMs, ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function runMotorBenchmark(cases) {
  const worker = createMotorWorker();
  const latenciesMs = [];
  const results = [];

  try {
    for (const entry of cases) {
      const startedAt = Date.now();
      const payload = await worker.check(entry.errado);
      const latencyMs = Date.now() - startedAt;
      const corrected = applyMatches(entry.errado, payload);
      const ok = corrected === entry.esperado;

      latenciesMs.push(latencyMs);
      results.push({
        ...entry,
        corrected,
        ok,
        latencyMs
      });
    }
  } finally {
    worker.close();
  }

  return { results, latencies: summarizeLatencies(latenciesMs) };
}

async function runJandaiaBenchmark(cases, { baseUrl, model, timeoutMs }) {
  await assertOllamaReady(baseUrl, model);
  const latenciesMs = [];
  const results = [];

  for (const entry of cases) {
    const response = await requestJandaiaSuggestion(entry.errado, { baseUrl, model, timeoutMs });
    const corrected = response.correctedText;
    const ok = corrected === entry.esperado;

    latenciesMs.push(response.latencyMs);
    results.push({
      ...entry,
      corrected,
      ok,
      latencyMs: response.latencyMs,
      llmOk: response.ok,
      llmError: response.error
    });
  }

  return { results, latencies: summarizeLatencies(latenciesMs) };
}

function formatMs(value) {
  return `${Math.round(value)}ms`;
}

function printSummary({ mode, totalCount, correctCount, latencies, elapsedMs }) {
  const successRate = totalCount ? correctCount / totalCount : 0;
  console.log("=== BRAVO SUMMARY ===");
  console.log(`mode=${mode}`);
  console.log(`total=${totalCount}`);
  console.log(`correct=${correctCount}`);
  console.log(`success_rate=${pct(successRate)}`);
  console.log(`elapsed_total_ms=${elapsedMs}`);
  console.log(`latency_min_ms=${Math.round(latencies.min)}`);
  console.log(`latency_mean_ms=${Math.round(latencies.mean)}`);
  console.log(`latency_median_ms=${Math.round(latencies.median)}`);
  console.log(`latency_p90_ms=${Math.round(latencies.p90)}`);
  console.log(`latency_p95_ms=${Math.round(latencies.p95)}`);
  console.log(`latency_max_ms=${Math.round(latencies.max)}`);
}

function toMarkdownTable(summaryByMode) {
  const header = [
    "| Modo | Total | Certas | Taxa | Tempo total | Média | Mediana | p95 | Máx |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];
  const rows = summaryByMode.map((s) => (
    `| ${s.mode} | ${s.total} | ${s.correct} | ${pct(s.correct / s.total)} | ${formatMs(s.elapsedMs)} | ${formatMs(s.lat.mean)} | ${formatMs(s.lat.median)} | ${formatMs(s.lat.p95)} | ${formatMs(s.lat.max)} |`
  ));
  return [...header, ...rows].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = await loadCases(args.caseFile);

  const startedAt = Date.now();
  let payload;

  if (args.mode === "motor") {
    payload = await runMotorBenchmark(cases);
  } else {
    payload = await runJandaiaBenchmark(cases, {
      baseUrl: String(args.llmCoreUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/u, ""),
      model: args.llmCoreModel,
      timeoutMs: args.llmTimeoutMs
    });
  }

  const elapsedMs = Date.now() - startedAt;
  const totalCount = payload.results.length;
  const correctCount = payload.results.filter((entry) => entry.ok).length;

  printSummary({
    mode: args.mode,
    totalCount,
    correctCount,
    latencies: payload.latencies,
    elapsedMs
  });

  await fs.mkdir(args.outDir, { recursive: true });
  const outFile = path.join(args.outDir, `bravo-results-${args.mode}-${Date.now()}.json`);
  await fs.writeFile(outFile, `${JSON.stringify({
    mode: args.mode,
    total: totalCount,
    correct: correctCount,
    elapsedMs,
    latencies: payload.latencies,
    results: payload.results
  }, null, 2)}\n`, "utf8");

  console.log(`results_file=${outFile}`);

  // Se alguém rodar os dois modos manualmente, essa tabela ajuda a colar em ata.
  console.log("=== BRAVO TABLE (copy/paste) ===");
  console.log(toMarkdownTable([{
    mode: args.mode,
    total: totalCount,
    correct: correctCount,
    elapsedMs,
    lat: payload.latencies
  }]));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
