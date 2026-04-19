import fs from "node:fs";

const baseUrl = String(process.env.LLM_CORE_URL || "http://127.0.0.1:11434").replace(/\/+$/u, "");
const model = String(process.env.LLM_CORE_MODEL || "jandaia-1");
const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || "15000");

const JANDAIA_DIRECTIVE = [
  "Você é jandaia 1, especialista em correção de português do Brasil.",
  "Sua tarefa é corrigir a frase com a MENOR quantidade de mudanças possível.",
  "Preserve o sentido original e as palavras já corretas.",
  "Não reescreva por estilo e não troque palavras por sinônimos.",
  "Não invente detalhes e não acrescente informação.",
  "Responda em uma única linha no formato <final>FRASE_CORRIGIDA</final>.",
  "Não escreva nada antes ou depois do <final>...</final>."
].join("\n");

function buildPrompt(text) {
  return [
    JANDAIA_DIRECTIVE,
    "",
    "Exemplos:",
    "Errada: A gente vamos no cinema amanhã.",
    "<final>A gente vai ao cinema amanhã.</final>",
    "",
    "Errada: A seção de cinema começa às 20h.",
    "<final>A sessão de cinema começa às 20h.</final>",
    "",
    "Errada: Ele não sabe porque você faltou.",
    "<final>Ele não sabe por que você faltou.</final>",
    "",
    "Agora corrija apenas a frase abaixo.",
    `Errada: ${text}`
  ].join("\n");
}

function looksLikeCleanSentence(text) {
  if (!text) {
    return false;
  }
  if (/[<>{}\[\]]/u.test(text)) {
    return false;
  }
  if (/\b(?:resposta|instruction|instrução|prompt)\b/iu.test(text)) {
    return false;
  }
  if (text.length < 3 || text.length > 280) {
    return false;
  }
  const letterCount = (text.match(/\p{L}/gu) || []).length;
  if (letterCount < 2) {
    return false;
  }
  const weirdPunctuationCount = (text.match(/["`]/gu) || []).length;
  if (weirdPunctuationCount > 2) {
    return false;
  }
  return true;
}

function normalizeGeneratedText(text) {
  const finalTagMatches = [...text.matchAll(/<final>([\s\S]*?)<\/final>/giu)];
  if (finalTagMatches.length) {
    const last = finalTagMatches[finalTagMatches.length - 1];
    const candidate = String(last?.[1] || "").trim();
    if (looksLikeCleanSentence(candidate)) {
      return candidate;
    }
  }

  const cleaned = text
    .trim()
    .replace(/<[^>]+>/gu, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\s*correta:\s*/iu, "")
    .replace(/^corrigida:\s*/iu, "")
    .replace(/^frase corrigida:\s*/iu, "")
    .trim();

  const firstLine = (cleaned.split(/\r?\n/u)[0] || "").trim();
  if (!looksLikeCleanSentence(firstLine)) {
    return "";
  }
  return firstLine;
}

async function requestSuggestion(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          temperature: 0,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.35,
          num_predict: 80,
          stop: ["</final>", "</instruction>"]
        },
        prompt: buildPrompt(text)
      })
    });

    if (!response.ok) {
      return text;
    }

    const payload = await response.json();
    const corrected = normalizeGeneratedText(String(payload?.response || ""));
    return corrected || text;
  } catch {
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

const input = fs.readFileSync(0, "utf8");
const lines = input.split(/\r?\n/u).filter((line) => line.length > 0);

async function assertOllamaReady() {
  try {
    const versionRes = await fetch(`${baseUrl}/api/version`, { method: "GET" });
    if (!versionRes.ok) {
      throw new Error(`ollama_http_${versionRes.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`LLM core indisponível em ${baseUrl} (${message}).\n`);
    process.stderr.write("Dica: inicie o Ollama local e confirme que o endpoint /api/version responde.\n");
    process.exit(2);
  }

  try {
    const tagsRes = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
    if (!tagsRes.ok) {
      throw new Error(`ollama_tags_http_${tagsRes.status}`);
    }
    const payload = await tagsRes.json();
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const modelFound = models.some((entry) => String(entry?.name || "").startsWith(`${model}:`));
    if (!modelFound) {
      process.stderr.write(`Modelo não encontrado no Ollama: ${model}\n`);
      process.stderr.write("Dica: rode `ollama list` e ajuste `LLM_CORE_MODEL`, ou instale/importe o modelo.\n");
      process.exit(2);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Falha ao validar modelos no Ollama (${message}).\n`);
    process.exit(2);
  }
}

await assertOllamaReady();

for (const line of lines) {
  const corrected = await requestSuggestion(line);
  process.stdout.write(corrected);
  process.stdout.write("\n");
}
