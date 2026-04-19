import { spawn } from "node:child_process";
import fs from "node:fs";

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

const input = fs.readFileSync(0, "utf8");
const lines = input.split(/\r?\n/u).filter((line) => line.length > 0);

if (!lines.length) {
  process.exit(0);
}

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

try {
  for (const line of lines) {
    const payload = await check(line);
    process.stdout.write(applyMatches(line, payload));
    process.stdout.write("\n");
  }
} finally {
  child.kill("SIGTERM");
}

