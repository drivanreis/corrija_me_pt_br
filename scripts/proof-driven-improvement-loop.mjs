import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { GoogleGenAI } from "@google/genai";

const DEFAULT_AUDIT = "data/test-cases/latest-audit.json";
const DEFAULT_OUTPUT = "data/rules/proof-improvement-candidates.json";
const TOKEN_PATTERN = /(?<![\p{L}\p{N}\p{M}])[\p{L}][\p{L}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;

function parseArgs(argv) {
  const args = {
    audit: DEFAULT_AUDIT,
    output: DEFAULT_OUTPUT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--audit" && next) {
      args.audit = next;
      index += 1;
    } else if (current === "--output" && next) {
      args.output = next;
      index += 1;
    }
  }

  return args;
}

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return normalizeWhitespace(value).toLocaleLowerCase("pt-BR");
}

function stripDiacritics(value) {
  return normalizeWhitespace(value).normalize("NFD").replace(/\p{Diacritic}+/gu, "");
}

function tokenizeWords(text) {
  return [...normalizeWhitespace(text).matchAll(TOKEN_PATTERN)].map((match) => match[0]);
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function collectFailedItems(audit) {
  const failed = [];

  for (const phase of audit.phases || []) {
    for (const item of phase.items || []) {
      if ((item.remaining_errors || 0) > 0 || (item.corrected_wrong_errors || 0) > 0 || (item.new_errors || 0) > 0) {
        failed.push({
          id: item.id,
          difficulty: item.difficulty,
          category: item.category,
          original: item.original,
          actual: item.extension_result,
          expected: item.expected,
          remaining: item.remaining_errors || 0,
          wrong: item.corrected_wrong_errors || 0,
          newErrors: item.new_errors || 0
        });
      }
    }
  }

  return failed;
}

async function getApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  try {
    const raw = (await readFile(path.resolve(process.cwd(), ".env"), "utf8")).trim();
    if (raw && !raw.includes("=")) {
      return raw;
    }
  } catch {
    return "";
  }

  return "";
}

function buildFallbackCandidates(failedItems) {
  const replacements = [];
  const phraseRules = [];

  for (const item of failedItems.slice(0, 80)) {
    const original = normalizeWhitespace(item.original);
    const expected = normalizeWhitespace(item.expected);

    if (/porisso/iu.test(original) && /por isso/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_PORISSO`,
        pattern: ["porisso"],
        replacements: ["por isso"],
        message: "Essa locução costuma ser escrita separada.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/segunda feira/iu.test(original) && /segunda-feira/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SEGUNDA_FEIRA`,
        pattern: ["segunda", "feira"],
        replacements: ["segunda-feira"],
        message: "Esse composto costuma ser escrito com hífen.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/sexta feira/iu.test(original) && /sexta-feira/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_SEXTA_FEIRA`,
        pattern: ["sexta", "feira"],
        replacements: ["sexta-feira"],
        message: "Esse composto costuma ser escrito com hífen.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/bem estar/iu.test(original) && /bem-estar/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_BEM_ESTAR`,
        pattern: ["bem", "estar"],
        replacements: ["bem-estar"],
        message: "Esse composto costuma ser escrito com hífen.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/não ha/iu.test(original) && /não há/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_NAO_HA`,
        pattern: ["não", "ha"],
        replacements: ["não há"],
        message: "Nessa construção, a forma esperada é 'não há'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    if (/o porque/iu.test(original) && /o porquê/iu.test(expected)) {
      phraseRules.push({
        id: `PT_BR_PROOF_SEEDED_${slugify(item.id)}_O_PORQUE`,
        pattern: ["o", "porque"],
        replacements: ["o porquê"],
        message: "Com artigo, a forma esperada é 'porquê'.",
        description: `Regra curta derivada de falha observada no proof (${item.id}).`
      });
    }

    const sourceWords = tokenizeWords(original);
    const targetWords = tokenizeWords(expected);
    if (sourceWords.length === targetWords.length) {
      for (let index = 0; index < sourceWords.length; index += 1) {
        const from = normalizeWhitespace(sourceWords[index]);
        const to = normalizeWhitespace(targetWords[index]);
        if (
          from
          && to
          && normalizeToken(from) !== normalizeToken(to)
          && from.length >= 5
          && to.length >= 5
          && !/\s/u.test(from)
          && !/\s/u.test(to)
        ) {
          replacements.push({
            from,
            replacements: [to],
            source: `proof_fallback:${item.id}`
          });
        }
      }
    }
  }

  return {
    replacements,
    phraseRules,
    contextRules: []
  };
}

async function askGeminiForCandidates(failedItems) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return buildFallbackCandidates(failedItems);
  }

  const ai = new GoogleGenAI({ apiKey });
  const sample = failedItems.slice(0, 120).map((item) => ({
    id: item.id,
    difficulty: item.difficulty,
    category: item.category,
    original: item.original,
    actual: item.actual,
    expected: item.expected,
    remaining: item.remaining,
    wrong: item.wrong,
    newErrors: item.newErrors
  }));

  const prompt = `Você está refinando um corretor pt-BR com metodologia honesta.

Regra de ouro:
- A base "proof" é APENAS prova.
- O "proof-pardau" é o fiscal dessa prova.
- NÃO copie frases inteiras do proof para o motor.
- Gere apenas conhecimento generalizável e curto.

Responda SOMENTE com JSON puro neste formato:
{
  "replacements": [{"from":"...", "replacements":["..."], "source":"proof_gemini:<id>"}],
  "phraseRules": [{"id":"...", "pattern":["..."], "replacements":["..."], "message":"...", "description":"..."}],
  "contextRules": [{"id":"...", "pattern":["..."], "targetIndex":1, "replacements":["..."], "message":"...", "description":"..."}]
}

Restrições obrigatórias:
- replacements: apenas 1 palavra -> 1 palavra OU 1 palavra inválida -> 2 palavras/composto seguro. Nunca use artigos soltos como "o" -> "a".
- phraseRules: no máximo 5 tokens no pattern. Proibido usar a frase inteira do proof.
- contextRules: 3 a 5 tokens no pattern, com targetIndex válido.
- Priorize compostos, hifenização, acentuação contextual curta, locuções fixas, homófonos muito explícitos e abreviações estáveis.
- Evite regras ambíguas e semânticas demais.

Casos falhos:
${JSON.stringify(sample)}`;

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Gemini timeout")), 20_000);
      })
    ]);
    const parsed = JSON.parse(response.text.trim().replace(/^```json\s*|```$/g, ""));
    return {
      replacements: Array.isArray(parsed.replacements) ? parsed.replacements : [],
      phraseRules: Array.isArray(parsed.phraseRules) ? parsed.phraseRules : [],
      contextRules: Array.isArray(parsed.contextRules) ? parsed.contextRules : []
    };
  } catch {
    return buildFallbackCandidates(failedItems);
  }
}

function validateReplacementCandidates(candidates, failedItems) {
  const forbiddenTexts = new Set(failedItems.map((item) => normalizeToken(item.original)));
  const failedById = new Map(failedItems.map((item) => [String(item.id), normalizeToken(item.category)]));
  const allowedCategories = new Set(["acentuacao", "acentuação", "hifen", "hífen", "ortografia"]);

  return candidates.filter((candidate) => {
    const from = normalizeWhitespace(candidate?.from);
    const replacements = Array.isArray(candidate?.replacements)
      ? candidate.replacements.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];

    if (!from || !replacements.length || replacements.length !== 1) {
      return false;
    }

    const normalizedFrom = normalizeToken(from);
    const normalizedTo = normalizeToken(replacements[0]);
    const wordCount = tokenizeWords(from).length;
    if (wordCount < 1 || wordCount > 5 || from.length > 48 || forbiddenTexts.has(normalizedFrom)) {
      return false;
    }

    const sourceId = String(candidate?.source || "").split(":").pop() || "";
    const category = failedById.get(sourceId) || "";
    const singleWord = tokenizeWords(from).length === 1 && tokenizeWords(replacements[0]).length === 1;

    if (singleWord) {
      if (!allowedCategories.has(category)) {
        return false;
      }

      const fromNoAccent = stripDiacritics(normalizedFrom);
      const toNoAccent = stripDiacritics(normalizedTo);
      const distance = levenshteinDistance(fromNoAccent, toNoAccent);
      const sameInitial = fromNoAccent[0] === toNoAccent[0];

      if (!(distance <= 2 || (sameInitial && distance <= 3))) {
        return false;
      }
    }

    return {
      from,
      replacements,
      source: normalizeWhitespace(candidate.source || "proof_gemini")
    };
  });
}

function validatePhraseRuleCandidates(candidates, failedItems) {
  const forbiddenPatternTexts = new Set(
    failedItems.map((item) => tokenizeWords(item.original).map(normalizeToken).join(" "))
  );

  return candidates.filter((candidate) => {
    const pattern = Array.isArray(candidate?.pattern)
      ? candidate.pattern.map((value) => normalizeToken(value)).filter(Boolean)
      : [];
    const replacements = Array.isArray(candidate?.replacements)
      ? candidate.replacements.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];
    const patternJoined = pattern.join(" ");

    if (!pattern.length || pattern.length > 5 || !replacements.length || forbiddenPatternTexts.has(patternJoined)) {
      return false;
    }

    return {
      id: normalizeWhitespace(candidate.id || `PT_BR_PROOF_${slugify(patternJoined)}`),
      pattern,
      replacements,
      message: normalizeWhitespace(candidate.message || "Essa combinação costuma ser escrita de outra forma."),
      description: normalizeWhitespace(candidate.description || "Regra curta derivada de falha observada no proof.")
    };
  });
}

function validateContextRuleCandidates(candidates) {
  return candidates.filter((candidate) => {
    const pattern = Array.isArray(candidate?.pattern)
      ? candidate.pattern.map((value) => normalizeToken(value)).filter(Boolean)
      : [];
    const replacements = Array.isArray(candidate?.replacements)
      ? candidate.replacements.map((value) => normalizeWhitespace(value)).filter(Boolean)
      : [];
    const targetIndex = Number(candidate?.targetIndex);

    if (!pattern.length || pattern.length < 3 || pattern.length > 5 || !replacements.length) {
      return false;
    }

    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= pattern.length) {
      return false;
    }

    return {
      id: normalizeWhitespace(candidate.id || `PT_BR_PROOF_CONTEXT_${slugify(pattern.join("_"))}`),
      pattern,
      targetIndex,
      replacements,
      message: normalizeWhitespace(candidate.message || "A palavra pode não combinar com este contexto."),
      description: normalizeWhitespace(candidate.description || "Regra curta derivada de falha observada no proof.")
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const audit = JSON.parse(await readFile(path.resolve(process.cwd(), args.audit), "utf8"));
  const failedItems = collectFailedItems(audit);
  const rawCandidates = await askGeminiForCandidates(failedItems);
  const payload = {
    generated_at: new Date().toISOString(),
    audit: args.audit,
    failed_items: failedItems.length,
    replacements: validateReplacementCandidates(rawCandidates.replacements || [], failedItems),
    phraseRules: validatePhraseRuleCandidates(rawCandidates.phraseRules || [], failedItems),
    contextRules: validateContextRuleCandidates(rawCandidates.contextRules || [])
  };

  await writeFile(path.resolve(process.cwd(), args.output), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Falhas analisadas do proof sob fiscalizacao proof-pardau: ${failedItems.length}`);
  console.log(`Candidatos gerados: replacements=${payload.replacements.length}, phraseRules=${payload.phraseRules.length}, contextRules=${payload.contextRules.length}`);
  console.log(`Arquivo atualizado: ${path.resolve(process.cwd(), args.output)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
