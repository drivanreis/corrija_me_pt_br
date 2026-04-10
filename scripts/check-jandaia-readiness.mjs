import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const configuredModel = process.env.CORRIJA_ME_LLM_CORE_MODEL || "jandaia-1";
const profilePath = path.join(process.cwd(), "data", "ai", "jandaia-base-profiles.json");
const llmCoreEnabled = ["1", "true", "yes", "on", "sim"].includes(String(process.env.CORRIJA_ME_LLM_CORE_ENABLED || "").trim().toLowerCase());
const baseUrl = (process.env.CORRIJA_ME_LLM_CORE_URL || "http://127.0.0.1:11434").replace(/\/+$/u, "");

async function checkOllamaReachability() {
  try {
    const response = await fetch(`${baseUrl}/api/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function readProfileConfig() {
  const raw = JSON.parse(await fs.readFile(profilePath, "utf8"));
  const selectedProfileId = process.env.CORRIJA_ME_JANDAIA_BASE_PROFILE || raw.preferredProfile;
  const selectedProfile = raw.profiles?.[selectedProfileId];

  if (!selectedProfile) {
    throw new Error(`Perfil de base invalido: ${selectedProfileId}`);
  }

  return {
    id: selectedProfileId,
    ...selectedProfile,
    localModelCandidates: Array.isArray(selectedProfile.localModelCandidates)
      ? selectedProfile.localModelCandidates.map((candidate) => path.join(process.cwd(), candidate))
      : []
  };
}

async function checkConfiguredModelPresence() {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return Array.isArray(payload?.models) && payload.models.some((entry) => String(entry?.name || "").startsWith(`${configuredModel}:`));
  } catch {
    return false;
  }
}

async function main() {
  const profile = await readProfileConfig();
  const localModelPath = profile.localModelCandidates.find((candidate) => existsSync(candidate)) || profile.localModelCandidates[0] || "";
  const localModelFilePresent = existsSync(localModelPath);
  const ollamaReachable = await checkOllamaReachability();
  const configuredModelPresent = ollamaReachable ? await checkConfiguredModelPresence() : false;
  const readiness = {
    baseProfile: profile.id,
    configuredModel,
    localModelFilePresent,
    ollamaReachable,
    llmCoreEnabled,
    configuredModelPresent,
    readyForActivation: llmCoreEnabled && ollamaReachable && configuredModelPresent,
    localModelPath
  };

  console.log(JSON.stringify(readiness, null, 2));

  if (!readiness.readyForActivation) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
