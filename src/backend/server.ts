import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { checkText } from "../core/engine.js";
import type { CheckResult } from "../core/types.js";
import { buildWholeTextLlmMatch, checkLlmCoreHealth, decideLlmRouting, readLlmCoreConfig, requestLlmCoreSuggestion } from "./llm-core.js";
import { loadDictionaryResources } from "./dictionary.js";

const DEFAULT_PORT = Number(process.env.CORRIJA_ME_PORT ?? "18081");
const isPackagedBinary = typeof (process as NodeJS.Process & { pkg?: unknown }).pkg !== "undefined";
const isCheckWorkerProcess = process.env.CORRIJA_ME_CHILD_MODE === "check-worker";
const currentDir = __dirname;
const dataDir = join(currentDir, "../data");
const dictionaryResources = isCheckWorkerProcess ? null : loadDictionaryResources(dataDir);
const llmCoreConfig = readLlmCoreConfig();
const RUNTIME_ARCHITECTURE = {
  production: {
    entrypoint: "backend_json_text",
    first_barrier: "motor",
    fallback: "jandaia",
    primary_endpoint: "/v2/check-smart"
  },
  orientation: {
    instructors: ["tucano_2", "quillbot"],
    director: "gemini",
    data_enrichment: "gemini"
  }
};

function sendJson(response: import("node:http").ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}

function parseBody(body: string, contentType: string | undefined): { text: string; language: string } {
  if (contentType?.includes("application/json")) {
    const parsed = JSON.parse(body || "{}") as { text?: string; language?: string };
    return {
      text: parsed.text ?? "",
      language: parsed.language ?? "pt-BR"
    };
  }

  const params = new URLSearchParams(body);
  return {
    text: params.get("text") ?? "",
    language: params.get("language") ?? "pt-BR"
  };
}

let workerSequence = 0;
let checkWorkerProcess: ReturnType<typeof spawn> | null = null;
const pendingWorkerJobs = new Map<number, {
  resolve: (value: CheckResult) => void;
  reject: (reason?: unknown) => void;
}>();

function rejectPendingWorkerJobs(reason: Error): void {
  for (const pending of pendingWorkerJobs.values()) {
    pending.reject(reason);
  }
  pendingWorkerJobs.clear();
}

function ensureCheckWorker() {
  if (checkWorkerProcess && !checkWorkerProcess.killed) {
    return checkWorkerProcess;
  }

  const childArgs = typeof (process as NodeJS.Process & { pkg?: unknown }).pkg !== "undefined" ? [] : [__filename];
  const child = spawn(process.execPath, childArgs, {
    env: {
      ...process.env,
      CORRIJA_ME_CHILD_MODE: "check-worker"
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });

  child.on("message", (message: { id?: number; ok?: boolean; result?: CheckResult; error?: string }) => {
    const jobId = message.id ?? -1;
    const pending = pendingWorkerJobs.get(jobId);
    if (!pending) {
      return;
    }
    pendingWorkerJobs.delete(jobId);
    if (message.ok) {
      if (!message.result) {
        pending.reject(new Error("Worker retornou resultado vazio."));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(message.error || "Falha ao processar analise."));
  });

  child.once("error", (error) => {
    checkWorkerProcess = null;
    rejectPendingWorkerJobs(error);
  });

  child.once("exit", (code) => {
    checkWorkerProcess = null;
    if (code !== 0 && pendingWorkerJobs.size) {
      rejectPendingWorkerJobs(new Error(`Worker finalizado com codigo ${code}.`));
    }
  });

  checkWorkerProcess = child;
  return child;
}

function runCheckInWorker(text: string): Promise<CheckResult> {
  return new Promise((resolve, reject) => {
    const jobId = ++workerSequence;
    pendingWorkerJobs.set(jobId, { resolve, reject });
    const child = ensureCheckWorker();
    child.send({ id: jobId, text });
  });
}

function runCheckInProcess(text: string): CheckResult {
  if (!dictionaryResources) {
    throw new Error("Recursos do dicionario indisponiveis.");
  }

  return checkText(text, dictionaryResources.replacements, {
    words: dictionaryResources.words,
    dictionaryReady: dictionaryResources.dictionaryReady,
    contextRules: dictionaryResources.contextRules,
    phraseRules: dictionaryResources.phraseRules,
    linguisticData: dictionaryResources.linguisticData
  });
}

function createCorePayload(text: string, baseResult: CheckResult, correctedText: string | null, routeReason: string, llmMeta: { used: boolean; latencyMs?: number; model?: string; error?: string }) {
  if (!correctedText || correctedText === text) {
    return {
      result: baseResult,
      baseResult,
      core: {
        enabled: llmCoreConfig.enabled,
        changed: false,
        routeReason,
        ...llmMeta
      }
    };
  }

  return {
    result: {
      ...baseResult,
      matches: [buildWholeTextLlmMatch(text, correctedText, routeReason)]
    },
    baseResult,
    core: {
      enabled: llmCoreConfig.enabled,
      changed: true,
      routeReason,
      correctedText,
      ...llmMeta
    }
  };
}

async function runMotorFirstCoreFlow(text: string): Promise<ReturnType<typeof createCorePayload>> {
  const baseResult: CheckResult = isPackagedBinary ? runCheckInProcess(text) : await runCheckInWorker(text);
  const routing = decideLlmRouting(text, baseResult);

  if (!llmCoreConfig.enabled || !routing.shouldRoute) {
    return createCorePayload(text, baseResult, null, routing.reason, {
      used: false,
      model: llmCoreConfig.model
    });
  }

  try {
    const suggestion = await requestLlmCoreSuggestion(text, llmCoreConfig);
    return createCorePayload(text, baseResult, suggestion?.correctedText || null, routing.reason, {
      used: true,
      latencyMs: suggestion?.latencyMs,
      model: suggestion?.model || llmCoreConfig.model
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "llm_core_failed";
    return createCorePayload(text, baseResult, null, routing.reason, {
      used: true,
      model: llmCoreConfig.model,
      error: message
    });
  }
}

async function runMotorOnlyFlow(text: string): Promise<CheckResult> {
  return isPackagedBinary ? runCheckInProcess(text) : runCheckInWorker(text);
}

if (isCheckWorkerProcess) {
  const workerResources = loadDictionaryResources(dataDir);

  process.on("message", (message: { id?: number; text?: string }) => {
    const jobId = message.id;
    if (!jobId || typeof message.text !== "string") {
      process.send?.({ id: jobId, ok: false, error: "Payload invalido para analise." });
      return;
    }

    try {
      const result = checkText(message.text, workerResources.replacements, {
        words: workerResources.words,
        dictionaryReady: workerResources.dictionaryReady,
        contextRules: workerResources.contextRules,
        phraseRules: workerResources.phraseRules,
        linguisticData: workerResources.linguisticData
      });
      process.send?.({ id: jobId, ok: true, result });
    } catch (error) {
      const workerError = error instanceof Error ? error.message : "Erro desconhecido";
      process.send?.({ id: jobId, ok: false, error: workerError });
    }
  });
} else {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

    if (request.method === "OPTIONS") {
      sendJson(response, 200, {});
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const llmHealth = llmCoreConfig.enabled ? await checkLlmCoreHealth(llmCoreConfig) : {
        reachable: false,
        model: llmCoreConfig.model,
        error: "disabled"
      };

      sendJson(response, 200, {
        status: "ok",
        service: "corrija_me_pt_br_node",
        dictionary: {
          words: dictionaryResources?.words.size ?? 0,
          ready: dictionaryResources?.dictionaryReady ?? false,
          contextRules: dictionaryResources?.contextRules.length ?? 0,
          phraseRules: dictionaryResources?.phraseRules.length ?? 0,
          lexicalEntries: dictionaryResources?.linguisticData.lexicalEntries.size ?? 0,
          syntaxPatterns: dictionaryResources?.linguisticData.syntaxPatterns.length ?? 0
        },
        llmCore: {
          enabled: llmCoreConfig.enabled,
          ...llmHealth
        },
        architecture: RUNTIME_ARCHITECTURE
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v2/architecture") {
      sendJson(response, 200, {
        status: "ok",
        runtime: RUNTIME_ARCHITECTURE,
        llmCore: {
          enabled: llmCoreConfig.enabled,
          model: llmCoreConfig.model
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v2/languages") {
      sendJson(response, 200, [
        {
          name: "Portuguese (Brazil)",
          code: "pt",
          longCode: "pt-BR"
        }
      ]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v2/check") {
      const bodyChunks: Buffer[] = [];
      for await (const chunk of request) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const { text, language } = parseBody(Buffer.concat(bodyChunks).toString("utf8"), request.headers["content-type"]);

      if ((language || "pt-BR") !== "pt-BR") {
        sendJson(response, 400, { error: "Somente pt-BR esta disponivel nesta versao." });
        return;
      }

      try {
        const result: CheckResult = await runMotorOnlyFlow(text);
        sendJson(response, 200, result);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao processar analise.";
        sendJson(response, 500, { error: message });
        return;
      }
    }

    if (request.method === "POST" && (url.pathname === "/v2/check-core" || url.pathname === "/v2/check-smart")) {
      const bodyChunks: Buffer[] = [];
      for await (const chunk of request) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const { text, language } = parseBody(Buffer.concat(bodyChunks).toString("utf8"), request.headers["content-type"]);

      if ((language || "pt-BR") !== "pt-BR") {
        sendJson(response, 400, { error: "Somente pt-BR esta disponivel nesta versao." });
        return;
      }

      try {
        const payload = await runMotorFirstCoreFlow(text);
        sendJson(response, 200, {
          ...payload,
          runtime: {
            mode: "motor_first_with_jandaia_fallback",
            first_barrier: "motor",
            fallback: "jandaia",
            instructors: ["tucano_2", "quillbot"],
            director: "gemini"
          }
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao processar analise.";
        sendJson(response, 500, { error: message });
        return;
      }
    }

    sendJson(response, 404, { error: "Rota nao encontrada." });
  });

  server.listen(DEFAULT_PORT, "127.0.0.1", () => {
    console.log(`corrija_me_pt_br backend local ativo em http://127.0.0.1:${DEFAULT_PORT}`);
  });
}
