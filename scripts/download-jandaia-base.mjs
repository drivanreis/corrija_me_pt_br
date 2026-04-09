import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, ".models", "jandaia");
const TARGET_PATH = path.join(TARGET_DIR, "Tucano-2b4-Instruct-Q5_K_M.gguf");
const SOURCE_URL = "https://huggingface.co/tensorblock/Tucano-2b4-Instruct-GGUF/resolve/main/Tucano-2b4-Instruct-Q5_K_M.gguf";

function runCommand(command, args, label = `${command} ${args.join(" ")}`, timeoutMs = 7_200_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
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

async function main() {
  await fs.mkdir(TARGET_DIR, { recursive: true });
  await runCommand("curl", ["-L", "-C", "-", "-o", TARGET_PATH, SOURCE_URL], "download jandaia q5");
  const stats = await fs.stat(TARGET_PATH);
  console.log(JSON.stringify({
    target: TARGET_PATH,
    size_bytes: stats.size
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
