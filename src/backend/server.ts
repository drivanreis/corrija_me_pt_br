import { createServer } from "node:http";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { checkText } from "../core/engine.js";
import type { ReplacementEntry } from "../core/types.js";

const DEFAULT_PORT = Number(process.env.CORRIJA_ME_PORT ?? "18081");
const currentDir = __dirname;
const dataPath = join(currentDir, "../data/replacements.json");
const replacements = JSON.parse(readFileSync(dataPath, "utf8")) as ReplacementEntry[];

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    sendJson(response, 200, {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", service: "corrija_me_pt_br_node" });
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

    sendJson(response, 200, checkText(text, replacements));
    return;
  }

  sendJson(response, 404, { error: "Rota nao encontrada." });
});

server.listen(DEFAULT_PORT, "127.0.0.1", () => {
  console.log(`corrija_me_pt_br backend local ativo em http://127.0.0.1:${DEFAULT_PORT}`);
});
