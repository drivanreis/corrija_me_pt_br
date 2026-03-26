import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = "18081";

const server = spawn("node", ["build/node-app/backend/server.cjs"], {
  env: {
    ...process.env,
    CORRIJA_ME_PORT: port
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});
server.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

async function main() {
  await delay(1000);

  const response = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "voce  nao viu o o servico ?"
    })
  });

  const payload = await response.json();
  console.log(JSON.stringify(payload, null, 2));

  if (!Array.isArray(payload.matches) || payload.matches.length === 0) {
    throw new Error("Smoke test falhou: nenhuma sugestao retornada.");
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
