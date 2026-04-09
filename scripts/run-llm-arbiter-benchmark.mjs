import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { GoogleGenAI } from "@google/genai";

const DEFAULT_CASES = "data/test-cases/curated-proof.json";
const DEFAULT_OUTPUT = "data/benchmarks/llm-arbiter-report.json";
const DEFAULT_MODEL = process.env.CORRIJA_ME_LLM_CORE_MODEL || "jandaia-1";
const DEFAULT_OLLAMA_URL = (process.env.CORRIJA_ME_LLM_CORE_URL || "http://127.0.0.1:11434").replace(/\/+$/u, "");
const GEMINI_MODEL_CANDIDATES = ["gemini-2.5-flash", "gemini-2.0-flash"];
const GENERATION_TIMEOUT_MS = 90_000;
const JUDGE_TIMEOUT_MS = 45_000;
const MIN_VISIBLE_CONFIDENCE_SCORE = 0.68;

function parseArgs(argv) {
  const args = {
    cases: DEFAULT_CASES,
    output: DEFAULT_OUTPUT,
    limit: 0,
    quillbot: "",
    skipBuild: false,
    endpoint: "/v2/check-smart"
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
    } else if (current === "--quillbot" && next) {
      args.quillbot = next;
      index += 1;
    } else if (current === "--skip-build") {
      args.skipBuild = true;
    } else if (current === "--endpoint" && next) {
      args.endpoint = next;
      index += 1;
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 0 || args.limit > 5000) {
    throw new Error("Use --limit com um inteiro entre 0 e 5000.");
  }

  if (!["/v2/check", "/v2/check-smart", "/v2/check-core"].includes(args.endpoint)) {
    throw new Error("Use --endpoint com /v2/check, /v2/check-smart ou /v2/check-core.");
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

function getMatchConfidenceScore(match) {
  if (typeof match?.confidence?.score === "number") {
    return match.confidence.score;
  }

  switch (match?.confidence?.level) {
    case "high":
      return 0.95;
    case "medium":
      return 0.75;
    case "low":
      return 0.5;
    default:
      return 0.9;
  }
}

function shouldHideWeakMatch(match) {
  return match?.confidence?.level === "low" || getMatchConfidenceScore(match) < MIN_VISIBLE_CONFIDENCE_SCORE;
}

function selectVisibleMatchesForUi(matches) {
  return [...matches]
    .filter((match) => !shouldHideWeakMatch(match))
    .sort((left, right) => getMatchConfidenceScore(right) - getMatchConfidenceScore(left) || left.offset - right.offset || left.length - right.length);
}

function applyTopSuggestions(text, matches) {
  const ordered = [...matches]
    .filter((match) => typeof match.offset === "number" && typeof match.length === "number" && Array.isArray(match.replacements) && match.replacements[0]?.value)
    .sort((left, right) => right.offset - left.offset);

  let nextText = text;
  for (const match of ordered) {
    const replacement = String(match.replacements[0].value || "");
    nextText = `${nextText.slice(0, match.offset)}${replacement}${nextText.slice(match.offset + match.length)}`;
  }
  return nextText;
}

function buildJandaiaPrompt(text) {
  return [
    "Você é jandaia 1, especialista em correção de português do Brasil.",
    "Corrija a frase preservando o sentido original.",
    "Prefira a menor correção suficiente.",
    "Responda somente com a frase corrigida final.",
    "Não explique, não use rótulos e não use marcação.",
    "",
    "Exemplos:",
    "Errada: A gente vamos no cinema amanhã.",
    "Correta: A gente vai ao cinema amanhã.",
    "",
    "Errada: A seção de cinema começa às 20h.",
    "Correta: A sessão de cinema começa às 20h.",
    "",
    "Errada: Ele não sabe porque você faltou.",
    "Correta: Ele não sabe por que você faltou.",
    "",
    "Agora corrija apenas a frase abaixo.",
    `Errada: ${text}`,
    "Correta:"
  ].join("\n");
}

function normalizeLlmText(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/<[^>]+>/gu, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^corrigida:\s*/iu, "")
    .replace(/^frase corrigida:\s*/iu, "")
    .replace(/^correta:\s*/iu, "")
    .split(/\r?\n/u)[0]
    .trim();

  if (!cleaned) {
    return "";
  }

  if (/[<>{}\[\]]/u.test(cleaned)) {
    return "";
  }

  if (/\b(?:resposta|instruction|instrução|prompt|correta:|errada:)\b/iu.test(cleaned)) {
    return "";
  }

  return cleaned;
}

async function readApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  const envPath = path.resolve(process.cwd(), ".env");
  try {
    const rawEnv = (await fs.readFile(envPath, "utf8")).trim();
    if (rawEnv && !rawEnv.includes("=")) {
      return rawEnv;
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  return "";
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
    difficulty: Number(item.difficulty || 0),
    tags: Array.isArray(item.tags) ? item.tags : []
  })).filter((item) => item.errado && item.correto);

  return limit > 0 ? items.slice(0, limit) : items;
}

async function readQuillbotOutputs(filePath) {
  if (!filePath) {
    return new Map();
  }

  const content = JSON.parse(await fs.readFile(path.resolve(process.cwd(), filePath), "utf8"));
  if (!Array.isArray(content)) {
    throw new Error("Arquivo de respostas do QuillBot precisa ser um array JSON.");
  }

  return new Map(content.map((item) => [
    String(item.id || ""),
    {
      output: String(item.output || "").trim(),
      notes: String(item.notes || "").trim()
    }
  ]).filter(([key]) => key));
}

async function checkMotor(port, endpoint, text) {
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
    throw new Error(`Falha ao consultar o backend: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rawMatches = Array.isArray(payload?.result?.matches)
    ? payload.result.matches
    : Array.isArray(payload?.matches)
      ? payload.matches
      : [];
  const visibleMatches = selectVisibleMatchesForUi(rawMatches);

  return {
    output: applyTopSuggestions(text, visibleMatches),
    latency_ms: Date.now() - startedAt,
    meta: payload?.core || null,
    visible_match_count: visibleMatches.length
  };
}

async function checkJandaia(text) {
  const startedAt = Date.now();
  const response = await fetch(`${DEFAULT_OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      stream: false,
      options: {
        temperature: 0.05,
        top_k: 40,
        top_p: 0.9,
        repeat_penalty: 1.25,
        num_predict: 96
      },
      prompt: buildJandaiaPrompt(text)
    })
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar o jandaia: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return {
    output: normalizeLlmText(payload.response || ""),
    latency_ms: Date.now() - startedAt
  };
}

function buildJudgePrompt(testCase, candidates) {
  return `Você é um juiz técnico e imparcial de correção textual em português do Brasil.

Analise o texto original, a correção esperada e as saídas candidatas.
Não favoreça nenhum sistema. Julgue apenas qual saída mais se aproxima da correção esperada preservando o sentido original.

Texto original:
${testCase.errado}

Correção esperada:
${testCase.correto}

Saídas candidatas:
${candidates.map((candidate, index) => `${index + 1}. sistema=${candidate.system}\nsaída=${candidate.output || "[vazio]"}`).join("\n\n")}

Responda em JSON puro com este formato:
{
  "winner": "motor|jandaia|quillbot|empate|nenhum",
  "reason": "motivo curto",
  "scores": {
    "motor": 0,
    "jandaia": 0,
    "quillbot": 0
  },
  "validity": {
    "motor": "certa|parcial|errada|ausente",
    "jandaia": "certa|parcial|errada|ausente",
    "quillbot": "certa|parcial|errada|ausente"
  }
}`;
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");

  if (start === -1) {
    throw new Error("O Gemini não retornou objeto JSON.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, index + 1));
      }
    }
  }

  throw new Error("Não foi possível isolar o JSON do Gemini.");
}

async function judgeCase(ai, testCase, candidates) {
  let response = null;
  let lastError = null;
  const prompt = buildJudgePrompt(testCase, candidates);

  for (const model of GEMINI_MODEL_CANDIDATES) {
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: prompt
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout no juiz Gemini com ${model}.`)), JUDGE_TIMEOUT_MS);
        })
      ]);
      return {
        model,
        verdict: extractJsonObject(response.text)
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function writeJson(outputPath, value) {
  const resolved = path.resolve(process.cwd(), outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = await readApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não encontrada. O juiz Gemini é obrigatório para esta bancada.");
  }

  if (!args.skipBuild) {
    await runCommand("npm", ["run", "build"], "npm run build");
  }

  const cases = await readCases(args.cases, args.limit);
  const quillbotOutputs = await readQuillbotOutputs(args.quillbot);
  const ai = new GoogleGenAI({ apiKey });
  const port = await findFreePort();
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

  const startedAt = Date.now();

  try {
    await delay(1000);
    const items = [];

    for (const testCase of cases) {
      const motor = await checkMotor(port, args.endpoint, testCase.errado);
      const jandaia = await checkJandaia(testCase.errado);
      const quillbot = quillbotOutputs.get(testCase.id) || { output: "", notes: "" };

      const judge = await judgeCase(ai, testCase, [
        { system: "motor", output: motor.output },
        { system: "jandaia", output: jandaia.output },
        { system: "quillbot", output: quillbot.output }
      ]);

      items.push({
        id: testCase.id,
        category: testCase.category,
        difficulty: testCase.difficulty,
        tags: testCase.tags,
        original: testCase.errado,
        expected: testCase.correto,
        motor: {
          output: motor.output,
          latency_ms: motor.latency_ms,
          visible_match_count: motor.visible_match_count,
          meta: motor.meta
        },
        jandaia: jandaia,
        quillbot,
        judge_model: judge.model,
        verdict: judge.verdict
      });
    }

    const summary = items.reduce((accumulator, item) => {
      accumulator.total += 1;
      const winner = String(item.verdict?.winner || "nenhum");
      accumulator.wins[winner] = (accumulator.wins[winner] || 0) + 1;
      accumulator.avg_latency.motor += item.motor.latency_ms || 0;
      accumulator.avg_latency.jandaia += item.jandaia.latency_ms || 0;
      return accumulator;
    }, {
      total: 0,
      wins: {
        motor: 0,
        jandaia: 0,
        quillbot: 0,
        empate: 0,
        nenhum: 0
      },
      avg_latency: {
        motor: 0,
        jandaia: 0
      }
    });

    if (summary.total > 0) {
      summary.avg_latency.motor = Number((summary.avg_latency.motor / summary.total).toFixed(2));
      summary.avg_latency.jandaia = Number((summary.avg_latency.jandaia / summary.total).toFixed(2));
    }

    const report = {
      generated_at: new Date().toISOString(),
      elapsed_s: Math.round((Date.now() - startedAt) / 1000),
      cases_file: args.cases,
      endpoint: args.endpoint,
      quillbot_file: args.quillbot || null,
      systems: {
        motor: "backend_local",
        jandaia: DEFAULT_MODEL,
        quillbot: args.quillbot ? "importado_manual" : "nao_informado",
        judge: "gemini"
      },
      summary,
      items
    };

    const outputPath = await writeJson(args.output, report);
    console.log(`Benchmark salvo em: ${outputPath}`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
