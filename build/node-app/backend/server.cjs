/* corrija_me_pt_br backend */
"use strict";

// src/backend/server.ts
var import_node_http = require("node:http");
var import_node_path2 = require("node:path");

// src/core/text.ts
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isWordLike(value) {
  return /[\p{L}\p{N}]/u.test(value);
}
function createWholeWordPattern(term) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
}
function createWordTokenPattern() {
  return /(?<![\p{L}\p{N}\p{M}])[\p{L}][\p{L}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;
}
function preserveReplacementCase(original, replacement) {
  if (!replacement) {
    return replacement;
  }
  if (original === original.toUpperCase() && /[\p{L}]/u.test(original)) {
    return replacement.toUpperCase();
  }
  if (original[0] && original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
function buildContext(text, offset, length) {
  const start = Math.max(0, offset - 25);
  const end = Math.min(text.length, offset + length + 25);
  return {
    text: text.slice(start, end),
    offset: offset - start,
    length
  };
}
function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
function normalizeDictionaryWord(value) {
  return value.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}
function stripDiacritics(value) {
  return value.normalize("NFD").replace(new RegExp("\\p{Diacritic}+", "gu"), "");
}

// src/core/context-rules.ts
function tokenizeText(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    tokens.push({
      value: match[0],
      normalized: normalizeDictionaryWord(match[0]),
      offset: match.index,
      length: match[0].length
    });
  }
  return tokens;
}
function createContextMatch(text, token, rule) {
  const replacements = dedupeStrings(rule.replacements.map((value) => preserveReplacementCase(token.value, value)));
  return {
    message: rule.message,
    shortMessage: rule.message,
    offset: token.offset,
    length: token.length,
    replacements: replacements.map((value) => ({ value })),
    rule: {
      id: rule.id,
      description: rule.description,
      issueType: "grammar"
    },
    context: buildContext(text, token.offset, token.length)
  };
}
function createContextRuleMatches(text, rules) {
  if (!rules.length) {
    return [];
  }
  const tokens = tokenizeText(text);
  const matches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    for (const rule of rules) {
      if (index + rule.pattern.length > tokens.length) {
        continue;
      }
      const matched = rule.pattern.every((expected, patternIndex) => tokens[index + patternIndex]?.normalized === normalizeDictionaryWord(expected));
      if (!matched) {
        continue;
      }
      const targetToken = tokens[index + rule.targetIndex];
      if (!targetToken) {
        continue;
      }
      matches.push(createContextMatch(text, targetToken, rule));
    }
  }
  return matches;
}

// src/core/phrase-rules.ts
function tokenizeText2(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    tokens.push({
      value: match[0],
      normalized: normalizeDictionaryWord(match[0]),
      offset: match.index,
      length: match[0].length
    });
  }
  return tokens;
}
function createPhraseMatch(text, startToken, endToken, rule) {
  const offset = startToken.offset;
  const length = endToken.offset + endToken.length - startToken.offset;
  const original = text.slice(offset, offset + length);
  const replacements = dedupeStrings(rule.replacements.map((value) => preserveReplacementCase(original, value)));
  return {
    message: rule.message,
    shortMessage: rule.message,
    offset,
    length,
    replacements: replacements.map((value) => ({ value })),
    rule: {
      id: rule.id,
      description: rule.description,
      issueType: "style"
    },
    context: buildContext(text, offset, length)
  };
}
function createPhraseRuleMatches(text, rules) {
  if (!rules.length) {
    return [];
  }
  const tokens = tokenizeText2(text);
  const matches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    for (const rule of rules) {
      if (index + rule.pattern.length > tokens.length) {
        continue;
      }
      const matched = rule.pattern.every((expected, patternIndex) => tokens[index + patternIndex]?.normalized === normalizeDictionaryWord(expected));
      if (!matched) {
        continue;
      }
      const startToken = tokens[index];
      const endToken = tokens[index + rule.pattern.length - 1];
      if (!startToken || !endToken) {
        continue;
      }
      matches.push(createPhraseMatch(text, startToken, endToken, rule));
    }
  }
  return matches;
}

// src/core/engine.ts
function createMatch(text, offset, length, replacements, ruleId, message, description) {
  return {
    message,
    shortMessage: message,
    offset,
    length,
    replacements: replacements.map((value) => ({ value })),
    rule: {
      id: ruleId,
      description,
      issueType: "misspelling"
    },
    context: buildContext(text, offset, length)
  };
}
function addIfNoOverlap(matches, candidate) {
  const candidateStart = candidate.offset;
  const candidateEnd = candidate.offset + candidate.length;
  const overlaps = matches.some((existing) => {
    const existingStart = existing.offset;
    const existingEnd = existing.offset + existing.length;
    return candidateStart < existingEnd && existingStart < candidateEnd;
  });
  if (!overlaps) {
    matches.push(candidate);
  }
}
function getTechnicalSpans(text) {
  const pattern = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}_-]+\.)+(?:json|md|txt|js|ts|tsx|jsx|html|css|yaml|yml|xml|csv)(?![\p{L}\p{N}])/giu;
  const spans = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    spans.push({
      offset: match.index,
      length: match[0].length
    });
  }
  return spans;
}
function overlapsTechnicalSpan(offset, length, spans) {
  return spans.some((span) => offset < span.offset + span.length && span.offset < offset + length);
}
function createReplacementMatches(text, entries) {
  const matches = [];
  for (const entry of entries) {
    const pattern = isWordLike(entry.from) ? createWholeWordPattern(entry.from) : new RegExp(entry.from, "giu");
    const textMatches = text.matchAll(pattern);
    for (const match of textMatches) {
      if (match.index === void 0) {
        continue;
      }
      const original = match[0];
      const replacements = dedupeStrings(entry.replacements.map((value) => preserveReplacementCase(original, value)));
      if (!replacements.length) {
        continue;
      }
      addIfNoOverlap(matches, createMatch(
        text,
        match.index,
        original.length,
        replacements,
        "PT_BR_SIMPLE_REPLACE",
        "Possivel substituicao sugerida para pt-BR.",
        `Substituicao sugerida a partir de ${entry.source}`
      ));
    }
  }
  return matches;
}
function createDictionaryMistakeMatches(text, dictionary) {
  if (!dictionary.commonMistakes.length) {
    return [];
  }
  return createReplacementMatches(text, dictionary.commonMistakes);
}
function isIgnorableToken(word) {
  return word.length < 3 || /\d/u.test(word) || /^[A-Z0-9_-]+$/u.test(word) || /[_@/\\.-]/u.test(word);
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
function createUnknownWordSuggestions(word, dictionaryWords) {
  const normalizedWord = normalizeDictionaryWord(word);
  const plainWord = stripDiacritics(normalizedWord);
  const candidates = [];
  for (const candidate of dictionaryWords) {
    if (Math.abs(candidate.length - normalizedWord.length) > 2) {
      continue;
    }
    const plainCandidate = stripDiacritics(candidate);
    if (plainCandidate[0] !== plainWord[0]) {
      continue;
    }
    const distance = levenshteinDistance(plainWord, plainCandidate);
    if (distance > 2) {
      continue;
    }
    candidates.push({ word: candidate, score: distance });
  }
  return candidates.sort((left, right) => left.score - right.score || left.word.localeCompare(right.word, "pt-BR")).slice(0, 5).map((entry) => preserveReplacementCase(word, entry.word));
}
function createUnknownWordMatches(text, dictionary) {
  if (!dictionary.dictionaryReady || !dictionary.words.size) {
    return [];
  }
  const matches = [];
  const seenOffsets = /* @__PURE__ */ new Set();
  const pattern = createWordTokenPattern();
  const technicalSpans = getTechnicalSpans(text);
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    const original = match[0];
    const normalized = normalizeDictionaryWord(original);
    if (!normalized || isIgnorableToken(original) || dictionary.words.has(normalized) || overlapsTechnicalSpan(match.index, original.length, technicalSpans)) {
      continue;
    }
    const key = `${match.index}:${original.length}`;
    if (seenOffsets.has(key)) {
      continue;
    }
    const replacements = createUnknownWordSuggestions(original, dictionary.words);
    if (!replacements.length) {
      continue;
    }
    seenOffsets.add(key);
    addIfNoOverlap(matches, createMatch(
      text,
      match.index,
      original.length,
      replacements,
      "PT_BR_UNKNOWN_WORD",
      "Palavra possivelmente incorreta para pt-BR.",
      "Sugestao baseada no dicionario local."
    ));
  }
  return matches;
}
function createRepeatedWordMatches(text) {
  const pattern = /(?<![\p{L}\p{N}\p{M}])([\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*)\s+(\1)(?![\p{L}\p{N}\p{M}])/giu;
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    const repeatedWord = match[1];
    const secondWordOffset = match.index + match[0].lastIndexOf(match[2]);
    addIfNoOverlap(matches, createMatch(
      text,
      secondWordOffset,
      match[2].length,
      [repeatedWord],
      "PT_BR_REPEATED_WORD",
      "Palavra repetida em sequencia.",
      "Remove repeticao acidental de palavra."
    ));
  }
  return matches;
}
function createDoubleSpaceMatches(text) {
  const matches = [];
  const pattern = / {2,}/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    addIfNoOverlap(matches, createMatch(
      text,
      match.index,
      match[0].length,
      [" "],
      "PT_BR_DOUBLE_SPACE",
      "Espacos repetidos encontrados.",
      "Substitui espacos duplicados por um unico espaco."
    ));
  }
  return matches;
}
function createSpaceBeforePunctuationMatches(text) {
  const matches = [];
  const pattern = / ([,.;:!?])/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    addIfNoOverlap(matches, createMatch(
      text,
      match.index,
      match[0].length,
      [match[1]],
      "PT_BR_SPACE_BEFORE_PUNCTUATION",
      "Espaco antes de pontuacao.",
      "Remove espaco desnecessario antes de pontuacao."
    ));
  }
  return matches;
}
function createSentenceCaseMatches(text) {
  const matches = [];
  const pattern = /(^|[.!?]\s+)([a-zà-ÿ])/gmu;
  const technicalSpans = getTechnicalSpans(text);
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    const prefix = match[1];
    const lowerChar = match[2];
    const offset = match.index + prefix.length;
    if (overlapsTechnicalSpan(offset, lowerChar.length, technicalSpans)) {
      continue;
    }
    addIfNoOverlap(matches, createMatch(
      text,
      offset,
      lowerChar.length,
      [lowerChar.toUpperCase()],
      "PT_BR_SENTENCE_CASE",
      "Inicio de frase em minuscula.",
      "Sugere inicial maiuscula apos inicio ou pontuacao final."
    ));
  }
  return matches;
}
function checkText(text, replacements, dictionary) {
  const replacementMatches = createReplacementMatches(text, replacements);
  const dictionaryMistakeMatches = createDictionaryMistakeMatches(text, dictionary);
  const phraseRuleMatches = createPhraseRuleMatches(text, dictionary.phraseRules);
  const contextRuleMatches = createContextRuleMatches(text, dictionary.contextRules);
  const protectedMatches = [...replacementMatches, ...dictionaryMistakeMatches, ...phraseRuleMatches, ...contextRuleMatches];
  const unknownWordMatches = createUnknownWordMatches(text, dictionary).filter((candidate) => !protectedMatches.some((existing) => candidate.offset < existing.offset + existing.length && existing.offset < candidate.offset + candidate.length));
  const allMatches = [
    ...replacementMatches,
    ...dictionaryMistakeMatches,
    ...phraseRuleMatches,
    ...contextRuleMatches,
    ...unknownWordMatches,
    ...createRepeatedWordMatches(text),
    ...createDoubleSpaceMatches(text),
    ...createSpaceBeforePunctuationMatches(text),
    ...createSentenceCaseMatches(text)
  ].sort((left, right) => left.offset - right.offset || left.length - right.length);
  return {
    language: {
      name: "Portuguese (Brazil)",
      code: "pt-BR",
      detectedLanguage: {
        name: "Portuguese (Brazil)",
        code: "pt-BR",
        confidence: 0.99
      }
    },
    matches: allMatches
  };
}

// src/backend/dictionary.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function loadReplacementEntries(pathname) {
  return JSON.parse((0, import_node_fs.readFileSync)(pathname, "utf8"));
}
function loadCommonMistakeEntries(pathname) {
  const entries = JSON.parse((0, import_node_fs.readFileSync)(pathname, "utf8"));
  return entries.map((entry) => ({
    from: entry.from,
    replacements: entry.replacements,
    source: entry.description?.trim() || "common_mistakes"
  }));
}
function loadWordList(pathname) {
  return (0, import_node_fs.readFileSync)(pathname, "utf8").split(/\r?\n/u).map(normalizeDictionaryWord).filter((word) => word && !word.startsWith("#"));
}
function loadContextRules(pathname) {
  return JSON.parse((0, import_node_fs.readFileSync)(pathname, "utf8"));
}
function loadPhraseRules(pathname) {
  return JSON.parse((0, import_node_fs.readFileSync)(pathname, "utf8"));
}
function loadDictionaryManifest(dictionaryDir) {
  const manifestPath = (0, import_node_path.join)(dictionaryDir, "manifest.json");
  if (!(0, import_node_fs.existsSync)(manifestPath)) {
    return null;
  }
  return JSON.parse((0, import_node_fs.readFileSync)(manifestPath, "utf8"));
}
function loadDictionaryResources(dataDir2) {
  const replacements = loadReplacementEntries((0, import_node_path.join)(dataDir2, "replacements.json"));
  const dictionaryDir = (0, import_node_path.join)(dataDir2, "dictionary");
  const rulesDir = (0, import_node_path.join)(dataDir2, "rules");
  const manifest = loadDictionaryManifest(dictionaryDir);
  const dictionaryFiles = manifest?.wordFiles?.length ? [...manifest.wordFiles] : (0, import_node_fs.readdirSync)(dictionaryDir).filter((name) => /^words_\d+\.txt$/u.test(name)).sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
  const words = /* @__PURE__ */ new Set();
  for (const fileName of dictionaryFiles) {
    for (const word of loadWordList((0, import_node_path.join)(dictionaryDir, fileName))) {
      words.add(word);
    }
  }
  const customWordsFile = manifest?.customWordsFile || "custom_words.txt";
  for (const word of loadWordList((0, import_node_path.join)(dictionaryDir, customWordsFile))) {
    words.add(word);
  }
  const commonMistakesFile = manifest?.commonMistakesFile || "common_mistakes.json";
  const commonMistakes = loadCommonMistakeEntries((0, import_node_path.join)(dictionaryDir, commonMistakesFile));
  const dictionaryReady = words.size >= 5e3;
  const contextRules = loadContextRules((0, import_node_path.join)(rulesDir, "context_rules.json"));
  const phraseRules = loadPhraseRules((0, import_node_path.join)(rulesDir, "phrase_rules.json"));
  return {
    replacements,
    words,
    commonMistakes,
    dictionaryReady,
    contextRules,
    phraseRules
  };
}

// src/backend/server.ts
var DEFAULT_PORT = Number(process.env.CORRIJA_ME_PORT ?? "18081");
var currentDir = __dirname;
var dataDir = (0, import_node_path2.join)(currentDir, "../data");
var dictionaryResources = loadDictionaryResources(dataDir);
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}
function parseBody(body, contentType) {
  if (contentType?.includes("application/json")) {
    const parsed = JSON.parse(body || "{}");
    return {
      text: parsed.text ?? "",
      language: parsed.language ?? "pt-BR"
    };
  }
  const params = new URLSearchParams(body);
  return {
    text: params.get("text") ?? "",
    language: params.get("language") ?? "pt-BR"
  };
}
var server = (0, import_node_http.createServer)(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "OPTIONS") {
    sendJson(response, 200, {});
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "corrija_me_pt_br_node",
      dictionary: {
        words: dictionaryResources.words.size,
        commonMistakes: dictionaryResources.commonMistakes.length,
        ready: dictionaryResources.dictionaryReady,
        contextRules: dictionaryResources.contextRules.length
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v2/languages") {
    sendJson(response, 200, [
      {
        name: "Portuguese (Brazil)",
        code: "pt",
        longCode: "pt-BR"
      }
    ]);
    return;
  }
  if (request.method === "POST" && url.pathname === "/v2/check") {
    const bodyChunks = [];
    for await (const chunk of request) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const { text, language } = parseBody(Buffer.concat(bodyChunks).toString("utf8"), request.headers["content-type"]);
    if ((language || "pt-BR") !== "pt-BR") {
      sendJson(response, 400, { error: "Somente pt-BR esta disponivel nesta versao." });
      return;
    }
    sendJson(response, 200, checkText(text, dictionaryResources.replacements, {
      words: dictionaryResources.words,
      commonMistakes: dictionaryResources.commonMistakes,
      dictionaryReady: dictionaryResources.dictionaryReady,
      contextRules: dictionaryResources.contextRules,
      phraseRules: dictionaryResources.phraseRules
    }));
    return;
  }
  sendJson(response, 404, { error: "Rota nao encontrada." });
});
server.listen(DEFAULT_PORT, "127.0.0.1", () => {
  console.log(`corrija_me_pt_br backend local ativo em http://127.0.0.1:${DEFAULT_PORT}`);
});
