import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, ".models", "jandaia");
const PROFILE_PATH = path.join(ROOT, "data", "ai", "jandaia-base-profiles.json");
const DEFAULT_OLLAMA_BIN = process.env.OLLAMA_BIN || path.join(process.env.HOME || "", ".local", "bin", "ollama");

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

async function readProfileConfig() {
  const raw = JSON.parse(await fs.readFile(PROFILE_PATH, "utf8"));
  const selectedProfileId = process.env.CORRIJA_ME_JANDAIA_BASE_PROFILE || raw.preferredProfile;
  const selectedProfile = raw.profiles?.[selectedProfileId];

  if (!selectedProfile) {
    throw new Error(`Perfil de base invalido: ${selectedProfileId}`);
  }

  return {
    id: selectedProfileId,
    ...selectedProfile
  };
}

async function main() {
  const profile = await readProfileConfig();
  await fs.mkdir(TARGET_DIR, { recursive: true });

  if (profile.download?.kind === "ollama_pull") {
    await runCommand(DEFAULT_OLLAMA_BIN, ["pull", profile.download.model], `ollama pull ${profile.download.model}`);
    console.log(JSON.stringify({
      profile: profile.id,
      strategy: "ollama_pull",
      targetModel: profile.download.model
    }, null, 2));
    return;
  }

  if (profile.download?.kind === "curl") {
    const targetPath = path.join(ROOT, profile.download.targetPath);
    await runCommand("curl", ["-L", "-C", "-", "-o", targetPath, profile.download.sourceUrl], `download ${profile.id}`);
    const stats = await fs.stat(targetPath);
    console.log(JSON.stringify({
      profile: profile.id,
      strategy: "curl",
      target: targetPath,
      size_bytes: stats.size
    }, null, 2));
    return;
  }

  throw new Error(`Estrategia de download nao suportada para o perfil ${profile.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
