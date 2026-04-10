import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const DEFAULT_MODEL = process.env.CORRIJA_ME_LLM_CORE_MODEL || "jandaia-1";
const DEFAULT_OLLAMA_BIN = process.env.OLLAMA_BIN || path.join(process.env.HOME || "", ".local", "bin", "ollama");
const MODELS_BASE_URL = (process.env.CORRIJA_ME_LLM_CORE_URL || "http://127.0.0.1:11434").replace(/\/+$/u, "");
const PROFILE_PATH = path.join(ROOT, "data", "ai", "jandaia-base-profiles.json");

function runCommand(command, args, label = `${command} ${args.join(" ")}`, timeoutMs = 300_000) {
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

async function postGenerate(model, prompt) {
  const response = await fetch(`${MODELS_BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar modelo: http_${response.status}`);
  }

  return response.json();
}

async function createDerivedModel(baseModel, modelfilePath) {
  const raw = await fs.readFile(modelfilePath, "utf8");
  const customized = raw.replace(/^FROM .+$/mu, `FROM ${baseModel}`);
  const tempPath = path.join(ROOT, "data", "ai", ".jandaia-active.Modelfile");
  await fs.writeFile(tempPath, customized, "utf8");
  await runCommand(DEFAULT_OLLAMA_BIN, ["create", DEFAULT_MODEL, "-f", tempPath], `create ${DEFAULT_MODEL}`);
}

function normalize(text) {
  const cleaned = String(text || "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/^correta:\s*/iu, "")
    .split(/\r?\n/u)[0]
    .trim();

  if (/\b(?:resposta|instruction|instrução|prompt|correta:|errada:)\b/iu.test(cleaned)) {
    return "";
  }

  if (/[<>{}\[\]]/u.test(cleaned)) {
    return "";
  }

  return cleaned;
}

async function readProfileConfig() {
  const raw = JSON.parse(await fs.readFile(PROFILE_PATH, "utf8"));
  const selectedProfileId = process.env.CORRIJA_ME_JANDAIA_BASE_PROFILE || raw.preferredProfile;
  const selectedProfile = raw.profiles?.[selectedProfileId];

  if (!selectedProfile) {
    throw new Error(`Perfil de base invalido: ${selectedProfileId}`);
  }

  const localModelCandidates = Array.isArray(selectedProfile.localModelCandidates)
    ? selectedProfile.localModelCandidates.map((candidate) => path.join(ROOT, candidate))
    : [];

  return {
    id: selectedProfileId,
    ...selectedProfile,
    localModelCandidates,
    baseModelCandidates: Array.isArray(selectedProfile.baseModelCandidates)
      ? selectedProfile.baseModelCandidates.map((candidate) => (
        candidate.startsWith(".") ? path.join(ROOT, candidate) : candidate
      ))
      : []
  };
}

async function main() {
  const profile = await readProfileConfig();
  const modelfilePath = path.join(ROOT, "data", "ai", "jandaia-1.Modelfile");
  const evalPath = path.join(ROOT, "data", "ai", "jandaia-1-eval.json");
  const modelfile = await fs.readFile(modelfilePath, "utf8");
  const evalCases = JSON.parse(await fs.readFile(evalPath, "utf8"));

  if (!modelfile.includes("jandaia 1")) {
    throw new Error("Modelfile do jandaia 1 parece inconsistente.");
  }

  let selectedBaseModel = "";
  let lastBaseError = null;

  for (const candidate of profile.baseModelCandidates) {
    try {
      if (profile.localModelCandidates.includes(candidate)) {
        await fs.access(candidate);
      } else if (!candidate.startsWith("hf.co/") && !candidate.includes(path.sep)) {
        await runCommand(DEFAULT_OLLAMA_BIN, ["pull", candidate], `pull ${candidate}`, 900_000);
      } else if (candidate.startsWith("hf.co/")) {
        await runCommand(DEFAULT_OLLAMA_BIN, ["pull", candidate], `pull ${candidate}`, 900_000);
      }
      await createDerivedModel(candidate, modelfilePath);
      selectedBaseModel = candidate;
      break;
    } catch (error) {
      lastBaseError = error;
    }
  }

  if (!selectedBaseModel) {
    throw lastBaseError instanceof Error ? lastBaseError : new Error("Falha ao montar o jandaia 1.");
  }

  const report = [];
  let passed = 0;

  for (const testCase of evalCases) {
    const payload = await postGenerate(DEFAULT_MODEL, [
      "Você é jandaia 1, especialista em correção de português do Brasil.",
      "Responda somente com a frase corrigida final.",
      "",
      "Exemplos:",
      "Errada: A gente vamos no cinema amanhã.",
      "Correta: A gente vai ao cinema amanhã.",
      "",
      "Errada: A seção de cinema começa às 20h.",
      "Correta: A sessão de cinema começa às 20h.",
      "",
      `Errada: ${testCase.input}`,
      "Correta:"
    ].join("\n"));
    const output = normalize(payload.response);
    const ok = output === testCase.expected;
    if (ok) {
      passed += 1;
    }
    report.push({
      id: testCase.id,
      input: testCase.input,
      expected: testCase.expected,
      output,
      ok
    });
  }

  const summary = {
    model: DEFAULT_MODEL,
    base_profile: profile.id,
    base_model: selectedBaseModel,
    passed,
    total: evalCases.length,
    accuracy: evalCases.length ? Number(((passed / evalCases.length) * 100).toFixed(2)) : 0,
    report
  };

  const outputPath = path.join(ROOT, "data", "ai", "jandaia-1-last-eval.json");
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
