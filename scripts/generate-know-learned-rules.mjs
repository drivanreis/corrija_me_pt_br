import fs from "node:fs/promises";
import path from "node:path";

const KNOW_PATH = "data/test-cases/curated-know.json";
const CONTEXT_RULES_OUTPUT = "data/rules/context_rules_learned.json";
const PHRASE_RULES_OUTPUT = "data/rules/phrase_rules_learned.json";
const REPLACEMENTS_OUTPUT = "data/replacements_learned.json";
const FUNCTION_WORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "pra",
  "que",
  "se",
  "sem",
  "um",
  "uma"
]);
const SAFE_LEXICAL_CATEGORIES = new Set([
  "acentuacao",
  "acentuação",
  "hifen",
  "hífen",
  "ortografia"
]);
const AMBIGUOUS_LEXICAL_TOKENS = new Set([
  "a",
  "ao",
  "aonde",
  "as",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "eu",
  "ha",
  "há",
  "mais",
  "mas",
  "me",
  "mim",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "onde",
  "os",
  "para",
  "pode",
  "pôde",
  "por",
  "porquê",
  "porque",
  "pra",
  "que",
  "se",
  "te",
  "tem",
  "têm",
  "um",
  "uma"
]);

function normalizeWhitespace(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

function normalizeToken(value) {
  return normalizeWhitespace(value).toLocaleLowerCase("pt-BR");
}

function tokenizeWords(text) {
  const tokens = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  for (const match of normalizeWhitespace(text).matchAll(pattern)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function buildWordDiffGroups(sourceTokens, targetTokens) {
  const rows = sourceTokens.length + 1;
  const cols = targetTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let row = 0; row < rows; row += 1) dp[row][0] = row;
  for (let col = 0; col < cols; col += 1) dp[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (sourceTokens[row - 1] === targetTokens[col - 1]) {
        dp[row][col] = dp[row - 1][col - 1];
      } else {
        dp[row][col] = Math.min(
          dp[row - 1][col] + 1,
          dp[row][col - 1] + 1,
          dp[row - 1][col - 1] + 1
        );
      }
    }
  }

  const operations = [];
  let row = sourceTokens.length;
  let col = targetTokens.length;

  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && sourceTokens[row - 1] === targetTokens[col - 1]) {
      operations.push({ type: "equal", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
      continue;
    }

    const replaceCost = row > 0 && col > 0 ? dp[row - 1][col - 1] : Number.POSITIVE_INFINITY;
    const deleteCost = row > 0 ? dp[row - 1][col] : Number.POSITIVE_INFINITY;
    const currentCost = dp[row][col];

    if (row > 0 && col > 0 && currentCost === replaceCost + 1) {
      operations.push({ type: "replace", srcIndex: row - 1, tgtIndex: col - 1 });
      row -= 1;
      col -= 1;
    } else if (row > 0 && currentCost === deleteCost + 1) {
      operations.push({ type: "delete", srcIndex: row - 1 });
      row -= 1;
    } else {
      operations.push({ type: "insert", tgtIndex: col - 1 });
      col -= 1;
    }
  }

  operations.reverse();

  const groups = [];
  let current = null;
  let sourceCursor = 0;
  let targetCursor = 0;

  function closeGroup() {
    if (!current) {
      return;
    }

    groups.push({
      srcStart: current.srcStart,
      srcEnd: sourceCursor,
      tgtStart: current.tgtStart,
      tgtEnd: targetCursor,
      srcTokens: [...current.srcTokens],
      tgtTokens: [...current.tgtTokens]
    });
    current = null;
  }

  for (const operation of operations) {
    if (operation.type === "equal") {
      closeGroup();
      sourceCursor += 1;
      targetCursor += 1;
      continue;
    }

    if (!current) {
      current = {
        srcStart: sourceCursor,
        tgtStart: targetCursor,
        srcTokens: [],
        tgtTokens: []
      };
    }

    if (operation.type === "replace") {
      current.srcTokens.push(sourceTokens[operation.srcIndex]);
      current.tgtTokens.push(targetTokens[operation.tgtIndex]);
      sourceCursor += 1;
      targetCursor += 1;
    } else if (operation.type === "delete") {
      current.srcTokens.push(sourceTokens[operation.srcIndex]);
      sourceCursor += 1;
    } else {
      current.tgtTokens.push(targetTokens[operation.tgtIndex]);
      targetCursor += 1;
    }
  }

  closeGroup();
  return groups;
}

function mergeNearbyGroups(groups, sourceTokens, targetTokens) {
  if (groups.length < 2) {
    return groups;
  }

  const merged = [];
  let current = { ...groups[0], srcTokens: [...groups[0].srcTokens], tgtTokens: [...groups[0].tgtTokens] };

  for (let index = 1; index < groups.length; index += 1) {
    const next = groups[index];
    const sourceGap = next.srcStart - current.srcEnd;
    const targetGap = next.tgtStart - current.tgtEnd;

    if (sourceGap <= 1 && targetGap <= 1) {
      for (let cursor = current.srcEnd; cursor < next.srcStart; cursor += 1) {
        current.srcTokens.push(sourceTokens[cursor]);
      }
      for (let cursor = current.tgtEnd; cursor < next.tgtStart; cursor += 1) {
        current.tgtTokens.push(targetTokens[cursor]);
      }

      current.srcEnd = next.srcEnd;
      current.tgtEnd = next.tgtEnd;
      current.srcTokens.push(...next.srcTokens);
      current.tgtTokens.push(...next.tgtTokens);
      continue;
    }

    merged.push(current);
    current = { ...next, srcTokens: [...next.srcTokens], tgtTokens: [...next.tgtTokens] };
  }

  merged.push(current);
  return merged;
}

function isWordToken(value) {
  return /^[\p{L}\p{N}]+$/u.test(value);
}

function buildContextRuleCandidate(item, sourceTokens, group) {
  if (group.srcTokens.length !== 1 || group.tgtTokens.length !== 1) {
    return null;
  }

  const srcToken = normalizeToken(group.srcTokens[0]);
  const tgtToken = normalizeToken(group.tgtTokens[0]);
  if (!isWordToken(srcToken) || !isWordToken(tgtToken) || srcToken === tgtToken) {
    return null;
  }

  const previous = sourceTokens[group.srcStart - 1];
  const next = sourceTokens[group.srcEnd];
  if (!previous || !next) {
    return null;
  }

  const pattern = [previous, sourceTokens[group.srcStart], next]
    .filter(Boolean)
    .map((token) => normalizeToken(token));
  const targetIndex = previous ? 1 : 0;

  if (pattern.length < 2) {
    return null;
  }

  return {
    id: `PT_BR_CONTEXT_LEARNED_${item.id}_${group.srcStart}`,
    pattern,
    targetIndex,
    replacements: [tgtToken],
    message: "A palavra pode não combinar com este contexto.",
    description: `Regra aprendida a partir da base know (${item.id}).`,
    support: 1
  };
}

function buildPhraseRuleCandidate(item, group, validWords) {
  if (group.srcTokens.length < 1 || group.srcTokens.length > 5 || group.tgtTokens.length < 1 || group.tgtTokens.length > 5) {
    return null;
  }

  const pattern = group.srcTokens.map((token) => normalizeToken(token));
  const replacements = [group.tgtTokens.map((token) => normalizeWhitespace(token)).join(" ")];

  if (!pattern.every(isWordToken) || pattern.join(" ") === normalizeToken(replacements[0])) {
    return null;
  }

  // Abrimos uma exceção segura para compostos colados como "porisso" -> "por isso",
  // desde que a palavra de origem não exista no dicionário.
  if (pattern.length < 2) {
    const singleSource = pattern[0] || "";
    const replacementWords = tokenizeWords(replacements[0]);
    const isSafeCompoundSplit = (
      pattern.length === 1
      && replacementWords.length === 2
      && singleSource.length >= 6
      && !validWords.has(singleSource)
      && !FUNCTION_WORDS.has(singleSource)
      && !AMBIGUOUS_LEXICAL_TOKENS.has(singleSource)
    );

    if (!isSafeCompoundSplit) {
      return null;
    }
  }

  // Duas palavras extremamente funcionais também são perigosas sem semântica real.
  // Deixamos passar pares úteis como "por que", mas evitamos combinações genéricas.
  if (pattern.length === 2 && pattern.every((token) => FUNCTION_WORDS.has(token))) {
    const joined = pattern.join(" ");
    if (!["por que", "de mais", "em baixo", "a cerca"].includes(joined)) {
      return null;
    }
  }

  return {
    id: `PT_BR_PHRASE_LEARNED_${item.id}_${group.srcStart}`,
    pattern,
    replacements,
    message: "Essa combinação costuma ser escrita de outra forma.",
    description: `Regra aprendida a partir da base know (${item.id}).`,
    support: 1
  };
}

function dedupeContextRules(rules) {
  const byKey = new Map();

  for (const rule of rules) {
    const key = `${rule.pattern.join(" ")}::${rule.targetIndex}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, rule);
      continue;
    }

    const mergedReplacements = [...new Set([...existing.replacements, ...rule.replacements])];
    existing.replacements = mergedReplacements;
    existing.support = (existing.support || 1) + (rule.support || 1);
  }

  return [...byKey.values()]
    .filter((rule) => rule.replacements.length === 1)
    .map((rule) => {
      delete rule.support;
      return rule;
    });
}

function dedupePhraseRules(rules) {
  const byKey = new Map();

  for (const rule of rules) {
    const key = rule.pattern.join(" ");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, rule);
      continue;
    }

    existing.replacements = [...new Set([...existing.replacements, ...rule.replacements])];
    existing.support = (existing.support || 1) + (rule.support || 1);
  }

  return [...byKey.values()]
    .filter((rule) => rule.replacements.length === 1)
    .map((rule) => {
      delete rule.support;
      return rule;
    });
}

function buildReplacementCandidate(item, group) {
  const category = normalizeToken(item.category);
  if (!SAFE_LEXICAL_CATEGORIES.has(category)) {
    return null;
  }

  if (group.srcTokens.length !== 1 || group.tgtTokens.length !== 1) {
    return null;
  }

  const from = normalizeWhitespace(group.srcTokens[0]);
  const to = normalizeWhitespace(group.tgtTokens[0]);
  if (!from || !to || normalizeToken(from) === normalizeToken(to)) {
    return null;
  }

  if (!isWordToken(from) || !isWordToken(to)) {
    return null;
  }

  const normalizedFrom = normalizeToken(from);
  const normalizedTo = normalizeToken(to);
  if (
    normalizedFrom.length < 4
    || normalizedTo.length < 4
    || FUNCTION_WORDS.has(normalizedFrom)
    || FUNCTION_WORDS.has(normalizedTo)
    || AMBIGUOUS_LEXICAL_TOKENS.has(normalizedFrom)
    || AMBIGUOUS_LEXICAL_TOKENS.has(normalizedTo)
  ) {
    return null;
  }

  return {
    from,
    replacements: [to],
    source: `learned_know:${item.id}`,
    support: 1
  };
}

function dedupeReplacementEntries(entries) {
  const byKey = new Map();

  for (const entry of entries) {
    const normalizedFrom = normalizeToken(entry.from);
    const key = `${normalizedFrom}=>${entry.replacements.join("|")}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...entry,
        normalizedFrom
      });
      continue;
    }

    existing.support = (existing.support || 1) + (entry.support || 1);
  }

  const bySource = new Map();
  for (const entry of byKey.values()) {
    const bucket = bySource.get(entry.normalizedFrom) || [];
    bucket.push(entry);
    bySource.set(entry.normalizedFrom, bucket);
  }

  return [...bySource.values()]
    .filter((bucket) => bucket.length === 1)
    .map(([entry]) => ({
      from: entry.from,
      replacements: entry.replacements,
      source: entry.source
    }))
    .sort((left, right) => left.from.localeCompare(right.from, "pt-BR"));
}

function countWords(value) {
  return tokenizeWords(value).length;
}

function extractChangedSurfaceSegment(sourceText, targetText) {
  const left = normalizeWhitespace(sourceText);
  const right = normalizeWhitespace(targetText);
  if (!left || !right || left === right) {
    return null;
  }

  let prefix = 0;
  const maxPrefix = Math.min(left.length, right.length);
  while (prefix < maxPrefix && left[prefix] === right[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  const leftRemaining = left.length - prefix;
  const rightRemaining = right.length - prefix;
  const maxSuffix = Math.min(leftRemaining, rightRemaining);
  while (
    suffix < maxSuffix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const sourceMiddle = left.slice(prefix, left.length - suffix).trim();
  const targetMiddle = right.slice(prefix, right.length - suffix).trim();
  if (!sourceMiddle || !targetMiddle || sourceMiddle === targetMiddle) {
    return null;
  }

  return {
    sourceMiddle,
    targetMiddle
  };
}

function buildSurfaceReplacementCandidate(item, validWords) {
  const segment = extractChangedSurfaceSegment(item.errado, item.correto);
  if (!segment) {
    return null;
  }

  const { sourceMiddle, targetMiddle } = segment;
  if (
    sourceMiddle.length > 48
    || targetMiddle.length > 48
    || !/^[\p{L}\s-]+$/u.test(sourceMiddle)
    || !/^[\p{L}\s-]+$/u.test(targetMiddle)
  ) {
    return null;
  }

  const sourceWords = countWords(sourceMiddle);
  const targetWords = countWords(targetMiddle);
  if (sourceWords < 1 || sourceWords > 5 || targetWords < 1 || targetWords > 5) {
    return null;
  }

  const normalizedSource = normalizeToken(sourceMiddle);
  const normalizedTarget = normalizeToken(targetMiddle);
  const collapsedSource = normalizedSource.replace(/[\s-]+/gu, "");
  const collapsedTarget = normalizedTarget.replace(/[\s-]+/gu, "");

  const isSafeCompoundSplit = (
    sourceWords === 1
    && targetWords === 2
    && sourceMiddle.length >= 6
    && !validWords.has(normalizedSource)
    && !FUNCTION_WORDS.has(normalizedSource)
    && !AMBIGUOUS_LEXICAL_TOKENS.has(normalizedSource)
  );

  const isSafeHyphenation = (
    sourceWords === 2
    && targetWords === 2
    && sourceMiddle.includes(" ")
    && targetMiddle.includes("-")
    && collapsedSource === collapsedTarget
  );

  if (!isSafeCompoundSplit && !isSafeHyphenation) {
    return null;
  }

  return {
    from: sourceMiddle,
    replacements: [targetMiddle],
    source: `learned_surface:${item.id}`,
    support: 1
  };
}

async function loadValidWords() {
  const dictionaryDir = path.resolve(process.cwd(), "data/dictionary");
  const fileNames = await fs.readdir(dictionaryDir);
  const wordFiles = fileNames.filter((fileName) => /^words_\d+\.txt$/u.test(fileName));
  const validWords = new Set();

  for (const fileName of [...wordFiles, "custom_words.txt"]) {
    const filePath = path.join(dictionaryDir, fileName);
    try {
      const content = await fs.readFile(filePath, "utf8");
      for (const line of content.split(/\r?\n/u)) {
        const word = normalizeToken(line);
        if (word && !word.startsWith("#")) {
          validWords.add(word);
        }
      }
    } catch {
      // Ignora arquivos opcionais ausentes.
    }
  }

  return validWords;
}

async function main() {
  const know = JSON.parse(await fs.readFile(path.resolve(process.cwd(), KNOW_PATH), "utf8"));
  const validWords = await loadValidWords();
  const contextRules = [];
  const phraseRules = [];
  const replacementEntries = [];
  const learnableCategories = new Set([
    "acentuacao",
    "acentuação",
    "anuncios",
    "anúncios",
    "contexto",
    "hifen",
    "hífen",
    "homofonos",
    "homófonos",
    "ortografia",
    "texto tecnico",
    "texto técnico",
    "texto_tecnico"
  ]);

  for (const item of know) {
    const category = normalizeToken(item.category);
    if (!learnableCategories.has(category)) {
      continue;
    }

    const wrongTokens = tokenizeWords(item.errado);
    const rightTokens = tokenizeWords(item.correto);
    const diffGroups = mergeNearbyGroups(buildWordDiffGroups(wrongTokens, rightTokens), wrongTokens, rightTokens);

    for (const group of diffGroups) {
      const contextRule = buildContextRuleCandidate(item, wrongTokens, group);
      if (contextRule) {
        contextRules.push(contextRule);
      }

      if (group.srcTokens.length >= 2 || group.tgtTokens.length >= 2) {
        const phraseRule = buildPhraseRuleCandidate(item, group, validWords);
        if (phraseRule) {
          phraseRules.push(phraseRule);
        }
      }

      const replacementEntry = buildReplacementCandidate(item, group);
      if (replacementEntry) {
        replacementEntries.push(replacementEntry);
      }
    }

    const surfaceReplacementEntry = buildSurfaceReplacementCandidate(item, validWords);
    if (surfaceReplacementEntry) {
      replacementEntries.push(surfaceReplacementEntry);
    }
  }

  const finalContextRules = dedupeContextRules(contextRules).sort((left, right) => (
    right.pattern.length - left.pattern.length || left.pattern.join(" ").localeCompare(right.pattern.join(" "), "pt-BR")
  ));
  const finalPhraseRules = dedupePhraseRules(phraseRules).sort((left, right) => (
    right.pattern.length - left.pattern.length || left.pattern.join(" ").localeCompare(right.pattern.join(" "), "pt-BR")
  ));
  const finalReplacementEntries = dedupeReplacementEntries(replacementEntries);

  await Promise.all([
    fs.writeFile(path.resolve(process.cwd(), CONTEXT_RULES_OUTPUT), `${JSON.stringify(finalContextRules, null, 2)}\n`, "utf8"),
    fs.writeFile(path.resolve(process.cwd(), PHRASE_RULES_OUTPUT), `${JSON.stringify(finalPhraseRules, null, 2)}\n`, "utf8"),
    fs.writeFile(path.resolve(process.cwd(), REPLACEMENTS_OUTPUT), `${JSON.stringify(finalReplacementEntries, null, 2)}\n`, "utf8")
  ]);

  console.log(`Context rules learned: ${finalContextRules.length}`);
  console.log(`Phrase rules learned: ${finalPhraseRules.length}`);
  console.log(`Replacements learned: ${finalReplacementEntries.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
