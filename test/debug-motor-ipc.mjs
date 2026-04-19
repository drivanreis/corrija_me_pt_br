import { spawn } from "node:child_process";

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error("Uso: node test/debug-motor-ipc.mjs <texto>");
  process.exit(2);
}

const child = spawn(process.execPath, ["build/node-app/backend/server.cjs"], {
  env: { ...process.env, CORRIJA_ME_CHILD_MODE: "check-worker" },
  stdio: ["ignore", "ignore", "inherit", "ipc"]
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

function check(input) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.send({ id, text: input });
  });
}

try {
  const payload = await check(text);
  process.stdout.write(JSON.stringify(payload, null, 2));
  process.stdout.write("\n");
} finally {
  child.kill("SIGTERM");
}

