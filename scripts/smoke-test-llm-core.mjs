import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

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

const port = await findFreePort();

const server = spawn("node", ["build/node-app/backend/server.cjs"], {
  env: {
    ...process.env,
    CORRIJA_ME_PORT: port,
    CORRIJA_ME_LLM_CORE_ENABLED: "1",
    CORRIJA_ME_LLM_CORE_MODEL: process.env.CORRIJA_ME_LLM_CORE_MODEL || "jandaia-1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});
server.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

async function postCheck(pathname, text) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text
    })
  });

  return response.json();
}

async function main() {
  await delay(1000);

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  console.log(JSON.stringify(health, null, 2));

  if (!health?.llmCore?.enabled) {
    throw new Error("Smoke test falhou: nucleo local nao foi habilitado.");
  }

  const basePayload = await postCheck("/v2/check", "A gente vamos no cinema amanhã.");
  const corePayload = await postCheck("/v2/check-core", "A gente vamos no cinema amanhã.");
  const smartPayload = await postCheck("/v2/check-smart", "A gente vamos no cinema amanhã.");

  console.log(JSON.stringify({
    base: basePayload,
    core: corePayload,
    smart: smartPayload
  }, null, 2));

  if (!corePayload?.core?.enabled) {
    throw new Error("Smoke test falhou: payload do nucleo local nao foi retornado.");
  }

  if (!Array.isArray(corePayload?.result?.matches)) {
    throw new Error("Smoke test falhou: resultado do nucleo local nao contem matches.");
  }

  if (!Array.isArray(smartPayload?.result?.matches)) {
    throw new Error("Smoke test falhou: fluxo motor-first nao contem matches.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill("SIGTERM");
  });
