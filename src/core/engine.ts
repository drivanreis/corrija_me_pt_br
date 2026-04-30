import { createContextRuleMatches } from "./context-rules.js";
import { createSimpleNominalAgreementMatches } from "./nominal-agreement.js";
import { createPhraseRuleMatches } from "./phrase-rules.js";
import { createPunctuationHeuristicMatches } from "./punctuation-rules.js";
import { createSimpleSyntaxPatternMatches } from "./syntax-patterns.js";
import { createSimpleVerbalAgreementMatches } from "./verbal-agreement.js";
import { createAmbiguityResolutionMatches } from "./ambiguity-resolution.js";
import { createEnhancedContextRuleMatches } from "./enhanced-context-rules.js";
import { createSemanticAnalysisMatches } from "./semantic-analysis.js";
import { buildContext, createWholeWordPattern, createWordTokenPattern, dedupeStrings, isWordLike, normalizeDictionaryWord, preserveReplacementCase, stripDiacritics } from "./text.js";
import type { CheckResult, DictionaryData, MatchConfidence, ReplacementEntry, RuleMatch } from "./types.js";

interface TextSpan {
  offset: number;
  length: number;
}

interface UnknownWordSuggestion {
  word: string;
  score: number;
  confidence: MatchConfidence;
}

interface TokenSlice {
  value: string;
  normalized: string;
  offset: number;
  length: number;
}

interface PreparedReplacementEntry {
  entry: ReplacementEntry;
  pattern: RegExp;
  normalizedFrom: string;
}

interface PreparedReplacementIndex {
  prioritizedEntries: PreparedReplacementEntry[];
  exactEntriesByText: Map<string, PreparedReplacementEntry[]>;
}

const preparedReplacementIndexCache = new WeakMap<ReplacementEntry[], PreparedReplacementIndex>();
const checkResultCache = new Map<string, CheckResult>();
const MAX_CHECK_RESULT_CACHE_SIZE = 512;
const MAX_CORRECTION_PASSES = 3;

function createConfidence(level: MatchConfidence["level"], score: number, reason?: string): MatchConfidence {
  return {
    level,
    score: Number(score.toFixed(2)),
    reason
  };
}

function createMatch(
  text: string,
  offset: number,
  length: number,
  replacements: string[],
  ruleId: string,
  message: string,
  description: string,
  confidence: MatchConfidence = createConfidence("high", 0.95, "regra explicita")
): RuleMatch {
  return {
    message,
    shortMessage: message,
    offset,
    length,
    replacements: replacements.map((value) => ({ value })),
    confidence,
    rule: {
      id: ruleId,
      description,
      issueType: "misspelling"
    },
    context: buildContext(text, offset, length)
  };
}

function addIfNoOverlap(matches: RuleMatch[], candidate: RuleMatch): void {
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

function getTechnicalSpans(text: string): TextSpan[] {
  const pattern = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}_-]+\.)+(?:json|md|txt|js|ts|tsx|jsx|html|css|yaml|yml|xml|csv)(?![\p{L}\p{N}])/giu;
  const spans: TextSpan[] = [];

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    spans.push({
      offset: match.index,
      length: match[0].length
    });
  }

  return spans;
}

function overlapsTechnicalSpan(offset: number, length: number, spans: TextSpan[]): boolean {
  return spans.some((span) => offset < span.offset + span.length && span.offset < offset + length);
}

function prepareReplacementIndex(entries: ReplacementEntry[]): PreparedReplacementIndex {
  const cached = preparedReplacementIndexCache.get(entries);
  if (cached) {
    return cached;
  }

  const prioritizedEntries = [...entries]
    .sort((left, right) => (
      right.from.length - left.from.length
      || right.replacements.join("|").length - left.replacements.join("|").length
    ))
    .map((entry) => ({
      entry,
      pattern: isWordLike(entry.from) ? createWholeWordPattern(entry.from) : new RegExp(entry.from, "giu"),
      normalizedFrom: normalizeDictionaryWord(entry.from)
    }));

  const exactEntriesByText = new Map<string, PreparedReplacementEntry[]>();
  for (const preparedEntry of prioritizedEntries) {
    const bucket = exactEntriesByText.get(preparedEntry.normalizedFrom);
    if (bucket) {
      bucket.push(preparedEntry);
      continue;
    }
    exactEntriesByText.set(preparedEntry.normalizedFrom, [preparedEntry]);
  }

  const preparedIndex = {
    prioritizedEntries,
    exactEntriesByText
  };
  preparedReplacementIndexCache.set(entries, preparedIndex);
  return preparedIndex;
}

function createReplacementMatches(text: string, entries: ReplacementEntry[]): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const preparedIndex = prepareReplacementIndex(entries);
  const normalizedText = normalizeDictionaryWord(text);
  const exactEntries = preparedIndex.exactEntriesByText.get(normalizedText);

  if (exactEntries?.length) {
    for (const preparedEntry of exactEntries) {
      const replacements = dedupeStrings(preparedEntry.entry.replacements.map((value) => preserveReplacementCase(text, value)));
      if (!replacements.length) {
        continue;
      }

      addIfNoOverlap(matches, createMatch(
        text,
        0,
        text.length,
        replacements,
        "PT_BR_SIMPLE_REPLACE",
        "Possivel substituicao sugerida para pt-BR.",
        `Substituicao sugerida a partir de ${preparedEntry.entry.source}`
      ));
    }

    if (matches.length) {
      return matches;
    }
  }

  for (const preparedEntry of preparedIndex.prioritizedEntries) {
    const textMatches = text.matchAll(preparedEntry.pattern);

    for (const match of textMatches) {
      if (match.index === undefined) {
        continue;
      }

      const original = match[0];
      const replacements = dedupeStrings(preparedEntry.entry.replacements.map((value) => preserveReplacementCase(original, value)));
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
        `Substituicao sugerida a partir de ${preparedEntry.entry.source}`
      ));
    }
  }

  return matches;
}

function isIgnorableToken(word: string): boolean {
  return (
    word.length < 3
    || /\d/u.test(word)
    || /^[A-Z0-9_-]+$/u.test(word)
    || /-/u.test(word)
    || /[_@/\\.-]/u.test(word)
  );
}

function levenshteinDistance(left: string, right: string): number {
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
  const current = new Array<number>(right.length + 1).fill(0);

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

function countDiacriticMarks(value: string): number {
  return (value.normalize("NFD").match(/\p{Diacritic}/gu) || []).length;
}

function hasSafePrefixAndSuffixMatch(word: string, candidate: string): boolean {
  const minPrefix = word.length >= 6 && candidate.length >= 6 ? 2 : 1;
  const prefixMatches = word.slice(0, minPrefix) === candidate.slice(0, minPrefix);
  const suffixMatches = word.at(-1) === candidate.at(-1);
  return prefixMatches && suffixMatches;
}

function createUnknownWordSuggestions(word: string, dictionary: DictionaryData): UnknownWordSuggestion[] {
  const normalizedWord = normalizeDictionaryWord(word);
  const plainWord = stripDiacritics(normalizedWord);
  const originalDiacritics = countDiacriticMarks(normalizedWord);
  const candidates: UnknownWordSuggestion[] = [];

  for (const candidate of dictionary.words) {
    const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(candidate);
    if (lexicalEntry?.autoCorrect === "blocked" || lexicalEntry?.autoCorrect === "review") {
      continue;
    }

    if (dictionary.linguisticData.blockedAutoCorrections.has(candidate)) {
      continue;
    }

    if (Math.abs(candidate.length - normalizedWord.length) > 2) {
      continue;
    }

    const plainCandidate = stripDiacritics(candidate);
    if (plainCandidate[0] !== plainWord[0]) {
      continue;
    }

    const distance = levenshteinDistance(plainWord, plainCandidate);
    const normalizedDistance = levenshteinDistance(normalizedWord, candidate);
    const candidateDiacritics = countDiacriticMarks(candidate);
    const samePlainWord = plainCandidate === plainWord;

    if (samePlainWord) {
      if (originalDiacritics > candidateDiacritics) {
        continue;
      }

      if (normalizedDistance > 2) {
        continue;
      }
    } else {
      if (distance > 1) {
        continue;
      }

      if (!hasSafePrefixAndSuffixMatch(normalizedWord, candidate)) {
        continue;
      }
    }

    if (distance > 2) {
      continue;
    }

    let confidenceScore = samePlainWord ? 0.96 : 0.82;
    confidenceScore -= distance * 0.18;
    confidenceScore -= normalizedDistance * 0.08;

    if (lexicalEntry?.classes.length && lexicalEntry.classes.length > 1) {
      confidenceScore -= 0.18;
    }

    if (lexicalEntry?.irregular) {
      confidenceScore -= 0.06;
    }

    if (lexicalEntry?.tags?.some((tag) => ["tecnico", "produto", "marca", "plataforma", "interno", "ia", "desenvolvimento"].includes(tag))) {
      confidenceScore -= 0.14;
    }

    if (!samePlainWord && normalizedWord.length <= 4) {
      confidenceScore -= 0.08;
    }

    if (distance === 1 && normalizedDistance > 1) {
      confidenceScore -= 0.05;
    }

    if (confidenceScore < 0.45) {
      continue;
    }

    candidates.push({
      word: candidate,
      score: samePlainWord ? normalizedDistance : distance + normalizedDistance,
      confidence: createConfidence(
        confidenceScore >= 0.85 ? "high" : confidenceScore >= 0.68 ? "medium" : "low",
        Math.max(0.01, Math.min(confidenceScore, 0.99)),
        samePlainWord ? "forma conhecida com diferenca principalmente de acentuacao" : "aproximacao ortografica com filtros conservadores"
      )
    });
  }

  return candidates
    .sort((left, right) => right.confidence.score - left.confidence.score || left.score - right.score || left.word.localeCompare(right.word, "pt-BR"))
    .slice(0, 5)
    .map((entry) => ({
      ...entry,
      word: preserveReplacementCase(word, entry.word)
    }));
}

function createUnknownWordMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  if (!dictionary.dictionaryReady || !dictionary.words.size) {
    return [];
  }

  const matches: RuleMatch[] = [];
  const seenOffsets = new Set<string>();
  const pattern = createWordTokenPattern();
  const technicalSpans = getTechnicalSpans(text);

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const original = match[0];
    const normalized = normalizeDictionaryWord(original);
    if (/^(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)-feira$/iu.test(original)) {
      continue;
    }

    if (
      !normalized
      || isIgnorableToken(original)
      || dictionary.words.has(normalized)
      || dictionary.linguisticData.allowedUnknownWords.has(normalized)
      || dictionary.linguisticData.blockedAutoCorrections.has(normalized)
      || overlapsTechnicalSpan(match.index, original.length, technicalSpans)
    ) {
      continue;
    }

    const key = `${match.index}:${original.length}`;
    if (seenOffsets.has(key)) {
      continue;
    }

    const replacements = createUnknownWordSuggestions(original, dictionary);
    if (!replacements.length) {
      continue;
    }

    const [bestSuggestion, secondSuggestion] = replacements;
    const hasStrongBestSuggestion = bestSuggestion.confidence.score >= 0.78;
    const hasClearLead = !secondSuggestion || bestSuggestion.confidence.score - secondSuggestion.confidence.score >= 0.12;

    if (!hasStrongBestSuggestion || !hasClearLead) {
      continue;
    }

    seenOffsets.add(key);
    addIfNoOverlap(matches, createMatch(
      text,
      match.index,
      original.length,
      replacements.map((entry) => entry.word),
      "PT_BR_UNKNOWN_WORD",
      "Palavra possivelmente incorreta para pt-BR.",
      "Sugestao baseada no dicionario local.",
      bestSuggestion.confidence
    ));
  }

  return matches;
}

function createRepeatedWordMatches(text: string): RuleMatch[] {
  const pattern = /(?<![\p{L}\p{N}\p{M}])([\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*)\s+(\1)(?![\p{L}\p{N}\p{M}])/giu;
  const matches: RuleMatch[] = [];

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
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

function createDoubleSpaceMatches(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const pattern = / {2,}/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
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

function tokenizeSlices(text: string): TokenSlice[] {
  const tokens: TokenSlice[] = [];
  const pattern = createWordTokenPattern();

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
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

interface TokenChangeGroup {
  srcStart: number;
  srcEnd: number;
  tgtStart: number;
  tgtEnd: number;
  srcTokens: string[];
  tgtTokens: string[];
  srcText: string;
  tgtText: string;
}

interface InferenceStageDefinition {
  id: string;
  description: string;
  collectMatches: (text: string) => RuleMatch[];
}

function buildTokenChangeGroups(sourceTokens: string[], targetTokens: string[]): TokenChangeGroup[] {
  const rows = sourceTokens.length + 1;
  const cols = targetTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    dp[i][0] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    dp[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (sourceTokens[i - 1] === targetTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }

  const operations: Array<{ type: "equal" | "replace" | "delete" | "insert"; srcIndex?: number; tgtIndex?: number }> = [];
  let i = sourceTokens.length;
  let j = targetTokens.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sourceTokens[i - 1] === targetTokens[j - 1]) {
      operations.push({ type: "equal", srcIndex: i - 1, tgtIndex: j - 1 });
      i -= 1;
      j -= 1;
      continue;
    }

    const replaceCost = i > 0 && j > 0 ? dp[i - 1][j - 1] : Number.POSITIVE_INFINITY;
    const deleteCost = i > 0 ? dp[i - 1][j] : Number.POSITIVE_INFINITY;
    const currentCost = dp[i][j];

    if (i > 0 && j > 0 && currentCost === replaceCost + 1) {
      operations.push({ type: "replace", srcIndex: i - 1, tgtIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && currentCost === deleteCost + 1) {
      operations.push({ type: "delete", srcIndex: i - 1 });
      i -= 1;
    } else {
      operations.push({ type: "insert", tgtIndex: j - 1 });
      j -= 1;
    }
  }

  operations.reverse();

  const groups: TokenChangeGroup[] = [];
  let currentGroup: Omit<TokenChangeGroup, "srcText" | "tgtText"> | null = null;
  let sourceCursor = 0;
  let targetCursor = 0;

  function closeGroup(): void {
    if (!currentGroup) {
      return;
    }

    groups.push({
      ...currentGroup,
      srcText: currentGroup.srcTokens.join(" ").trim(),
      tgtText: currentGroup.tgtTokens.join(" ").trim()
    });
    currentGroup = null;
  }

  for (const operation of operations) {
    if (operation.type === "equal") {
      closeGroup();
      sourceCursor += 1;
      targetCursor += 1;
      continue;
    }

    if (!currentGroup) {
      currentGroup = {
        srcStart: sourceCursor,
        srcEnd: sourceCursor,
        tgtStart: targetCursor,
        tgtEnd: targetCursor,
        srcTokens: [],
        tgtTokens: []
      };
    }

    if (operation.type === "replace") {
      currentGroup.srcTokens.push(sourceTokens[operation.srcIndex ?? 0] || "");
      currentGroup.tgtTokens.push(targetTokens[operation.tgtIndex ?? 0] || "");
      sourceCursor += 1;
      targetCursor += 1;
    } else if (operation.type === "delete") {
      currentGroup.srcTokens.push(sourceTokens[operation.srcIndex ?? 0] || "");
      sourceCursor += 1;
    } else {
      currentGroup.tgtTokens.push(targetTokens[operation.tgtIndex ?? 0] || "");
      targetCursor += 1;
    }

    currentGroup.srcEnd = sourceCursor;
    currentGroup.tgtEnd = targetCursor;
  }

  closeGroup();
  return groups.filter((group) => group.srcText && group.tgtText);
}

function createIterativeDiffMatches(originalText: string, finalText: string): RuleMatch[] {
  if (originalText === finalText) {
    return [];
  }

  const originalTokens = tokenizeSlices(originalText);
  const finalTokens = tokenizeSlices(finalText);
  const sourceTokenValues = originalTokens.map((token) => token.normalized);
  const targetTokenValues = finalTokens.map((token) => token.normalized);
  const groups = buildTokenChangeGroups(sourceTokenValues, targetTokenValues);

  const diffMatches = groups
    .map((group) => {
      const startToken = originalTokens[group.srcStart];
      const endToken = originalTokens[group.srcEnd - 1];
      if (!startToken || !endToken) {
        return null;
      }

      const offset = startToken.offset;
      const length = endToken.offset + endToken.length - startToken.offset;
      const replacement = finalTokens.slice(group.tgtStart, group.tgtEnd).map((token) => token.value).join(" ").trim();
      if (!replacement) {
        return null;
      }

      return createMatch(
        originalText,
        offset,
        length,
        [replacement],
        "PT_BR_MULTI_PASS",
        "Correção composta inferida a partir de múltiplas passagens.",
        "Agrupa correções encadeadas encontradas após reprocessar a frase.",
        createConfidence("high", 0.93, "correcao iterativa consolidada")
      );
    })
    .filter((match): match is RuleMatch => Boolean(match));

  return diffMatches.map((match) => {
    const original = originalText.slice(match.offset, match.offset + match.length);
    const replacement = match.replacements[0]?.value || "";
    const leftContext = originalText.slice(0, match.offset);
    const porMatch = /\bpor\s$/iu.exec(leftContext);

    if (
      stripDiacritics(normalizeDictionaryWord(original)) === "que"
      && stripDiacritics(normalizeDictionaryWord(replacement)) === "que"
      && porMatch
    ) {
      const expandedOffset = match.offset - porMatch[0].length;
      const expandedOriginal = originalText.slice(expandedOffset, match.offset + match.length);
      return createMatch(
        originalText,
        expandedOffset,
        expandedOriginal.length,
        [preserveReplacementCase(expandedOriginal, "por quê")],
        "PT_BR_MULTI_PASS",
        "Correção composta inferida a partir de múltiplas passagens.",
        "Agrupa correções encadeadas encontradas após reprocessar a frase.",
        createConfidence("high", 0.93, "correcao iterativa consolidada")
      );
    }

    return match;
  });
}

function createWholeTextInferenceMatch(originalText: string, finalText: string): RuleMatch {
  return createMatch(
    originalText,
    0,
    originalText.length,
    [finalText],
    "PT_BR_MULTI_PASS",
    "Correção composta inferida a partir de múltiplas passagens.",
    "Consolida a frase final quando a diferença token a token nao preserva toda a correção.",
    createConfidence("high", 0.9, "consolidacao integral da frase")
  );
}

function sanitizeInvalidWeekdayHyphenForms(text: string): string {
  return text
    .replace(/\bsegundas-feira\b/giu, "segunda-feira")
    .replace(/\bterças-feira\b/giu, "terça-feira")
    .replace(/\btercas-feira\b/giu, "terça-feira")
    .replace(/\bquartas-feira\b/giu, "quarta-feira")
    .replace(/\bquintas-feira\b/giu, "quinta-feira")
    .replace(/\bsextas-feira\b/giu, "sexta-feira")
    .replace(/\bsábados-feira\b/giu, "sábado-feira")
    .replace(/\bsabados-feira\b/giu, "sábado-feira")
    .replace(/\bdomingos-feira\b/giu, "domingo-feira");
}

function createConsolidatedInferenceMatches(originalText: string, finalText: string): RuleMatch[] {
  const sanitizedFinalText = sanitizeInvalidWeekdayHyphenForms(finalText);

  if (originalText === sanitizedFinalText) {
    return [];
  }

  if (originalText === finalText) {
    return [];
  }

  const diffMatches = createIterativeDiffMatches(originalText, sanitizedFinalText);
  if (!diffMatches.length) {
    return [createWholeTextInferenceMatch(originalText, sanitizedFinalText)];
  }

  const reconstructedText = applyVisibleMatches(originalText, diffMatches);
  if (reconstructedText !== sanitizedFinalText) {
    return [createWholeTextInferenceMatch(originalText, sanitizedFinalText)];
  }

  return diffMatches;
}

function applyVisibleMatches(text: string, matches: RuleMatch[]): string {
  const ordered = collapseOverlappingMatches(matches)
    .filter((match) => Array.isArray(match.replacements) && Boolean(match.replacements[0]?.value))
    .sort((left, right) => right.offset - left.offset || right.length - left.length);

  let updatedText = text;
  for (const match of ordered) {
    const replacement = match.replacements[0]?.value;
    if (!replacement) {
      continue;
    }

    updatedText = updatedText.slice(0, match.offset) + replacement + updatedText.slice(match.offset + match.length);
  }

  return updatedText;
}

function createStructuredMatch(
  text: string,
  offset: number,
  length: number,
  replacement: string,
  ruleId: string,
  message: string,
  description: string,
  issueType: "misspelling" | "grammar" | "style",
  confidence: MatchConfidence
): RuleMatch {
  return {
    message,
    shortMessage: message,
    offset,
    length,
    replacements: [{ value: replacement }],
    confidence,
    rule: {
      id: ruleId,
      description,
      issueType
    },
    context: buildContext(text, offset, length)
  };
}

function createCraseHeuristicMatches(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const match of text.matchAll(/\b([Oo]nde\s+você\s+estava|[Ee]le\s+passou\s+mal\s+ontem|[Oo]ntem|[Hh]oje)\s+a\s+noite\b/gu)) {
    if (match.index === undefined) {
      continue;
    }

    const whole = match[0];
    const replacement = whole.replace(/\sa\s+noite$/u, " à noite");
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      match.index,
      whole.length,
      replacement,
      "PT_BR_CRASE_TEMPORAL_LOCUTION",
      "Use crase na locução temporal 'à noite'.",
      "Corrige ausência de crase em locução temporal recorrente.",
      "grammar",
      createConfidence("high", 0.9, "locucao temporal recorrente")
    ));
  }

  for (const match of text.matchAll(/(^|[^\p{L}\p{N}])(á)(?=\s+\d+\s+(?:minuto|minutos|hora|horas)\b)/gu)) {
    if (match.index === undefined) {
      continue;
    }

    const accentOffset = match.index + match[1].length;
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      accentOffset,
      match[2].length,
      preserveReplacementCase(match[2], "a"),
      "PT_BR_CRASE_DISTANCE",
      "Não use acento nessa indicação de distância ou tempo.",
      "Corrige uso indevido de acento em 'a 5 minutos', 'a 2 horas' e construções semelhantes.",
      "grammar",
      createConfidence("high", 0.92, "indicacao de distancia ou tempo")
    ));
  }

  return matches;
}

function createPorQueHeuristicMatches(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const indirectQuestionPrefixes = [
    "não sei",
    "nao sei",
    "ninguém sabe",
    "ninguem sabe",
    "ninguém entende",
    "ninguem entende",
    "quero saber",
    "queria saber",
    "gostaria de saber",
    "não sabemos",
    "nao sabemos",
    "explique"
  ];

  for (const prefix of indirectQuestionPrefixes) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
    const becausePattern = new RegExp(`\\b(${escapedPrefix})\\s+(porque|porquê)(?=\\s+\\p{L})`, "giu");

    for (const match of text.matchAll(becausePattern)) {
      if (match.index === undefined) {
        continue;
      }

      const token = match[2];
      const offset = match.index + match[0].lastIndexOf(token);
      addIfNoOverlap(matches, createStructuredMatch(
        text,
        offset,
        token.length,
        preserveReplacementCase(token, "por que"),
        "PT_BR_POR_QUE_INDIRECT_QUESTION",
        "Em pergunta indireta, a forma esperada aqui e 'por que'.",
        "Corrige o uso de 'porque' ou 'porquê' em construcoes de pergunta indireta.",
        "grammar",
        createConfidence("high", 0.91, "pergunta indireta recorrente")
      ));
    }
  }

  for (const match of text.matchAll(/\bpor\s+que(?=\s*[?!]\s*$)/giu)) {
    if (match.index === undefined) {
      continue;
    }

    addIfNoOverlap(matches, createStructuredMatch(
      text,
      match.index,
      match[0].length,
      preserveReplacementCase(match[0], "por quê"),
      "PT_BR_POR_QUE_FINAL",
      "No fim de pergunta, a forma esperada aqui e 'por quê'.",
      "Corrige 'por que' em final de pergunta direta.",
      "grammar",
      createConfidence("high", 0.93, "por que em final de pergunta")
    ));
  }

  for (const match of text.matchAll(/\bexplicou\s+porquê(?=\s+\p{L})/giu)) {
    if (match.index === undefined) {
      continue;
    }

    const token = "porquê";
    const offset = match.index + match[0].toLowerCase().lastIndexOf(token);
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      offset,
      token.length,
      "porque",
      "PT_BR_PORQUE_EXPLICATIVO",
      "Em oração explicativa, a forma esperada aqui e 'porque'.",
      "Corrige uso de 'porquê' onde a construcao pede conjuncao explicativa.",
      "grammar",
      createConfidence("high", 0.89, "oracao explicativa recorrente")
    ));
  }

  return matches;
}

function createLocalizationDateMatches(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const pattern = /\b(0?[1-9]|1[0-2])\/(1[3-9]|2[0-9]|3[0-1])\/(\d{4})\b/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const [, month, day, year] = match;
    const replacement = `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      match.index,
      match[0].length,
      replacement,
      "PT_BR_LOCALIZATION_DATE",
      "Formato de data possivelmente fora do padrão pt-BR.",
      "Converte data claramente no padrão mes/dia/ano para dia/mes/ano.",
      "style",
      createConfidence("high", 0.91, "data em formato US claramente identificavel")
    ));
  }

  return matches;
}

function isPluralAnnouncementLead(tokens: TokenSlice[], index: number): boolean {
  const next = tokens[index + 1];
  const nextNext = tokens[index + 2];
  const pluralIndicators = new Set([
    "dois",
    "duas",
    "tres",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
    "alguns",
    "algumas",
    "muitos",
    "muitas",
    "vários",
    "varios",
    "várias",
    "varias"
  ]);

  if (!next) {
    return false;
  }

  if (pluralIndicators.has(next.normalized)) {
    return true;
  }

  if (/s$/u.test(next.normalized) && next.normalized.length > 3) {
    return true;
  }

  if (nextNext && /s$/u.test(nextNext.normalized) && nextNext.normalized.length > 3) {
    return true;
  }

  return false;
}

function createAnnouncementAgreementMatches(text: string): RuleMatch[] {
  const tokens = tokenizeSlices(text);
  const matches: RuleMatch[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (token.normalized === "vende-se" && isPluralAnnouncementLead(tokens, index)) {
      addIfNoOverlap(matches, createStructuredMatch(
        text,
        token.offset,
        token.length,
        preserveReplacementCase(token.value, "vendem-se"),
        "PT_BR_ANNOUNCEMENT_VENDEM_SE",
        "Com sujeito plural, o verbo deve concordar.",
        "Corrige concordância verbal frequente em anúncios com 'vende-se'.",
        "grammar",
        createConfidence("high", 0.87, "padrao recorrente de anuncio com sujeito plural")
      ));
    }

    if (token.normalized === "aluga-se" && isPluralAnnouncementLead(tokens, index)) {
      addIfNoOverlap(matches, createStructuredMatch(
        text,
        token.offset,
        token.length,
        preserveReplacementCase(token.value, "alugam-se"),
        "PT_BR_ANNOUNCEMENT_ALUGAM_SE",
        "Com sujeito plural, o verbo deve concordar.",
        "Corrige concordância verbal frequente em anúncios com 'aluga-se'.",
        "grammar",
        createConfidence("high", 0.87, "padrao recorrente de anuncio com sujeito plural")
      ));
    }
  }

  return matches;
}

function createSpaceBeforePunctuationMatches(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const pattern = / ([,.;:!?])/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
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

function createSentenceCaseMatches(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const pattern = /(^|[.!?]\s+)([a-zà-ÿ])/gmu;
  const technicalSpans = getTechnicalSpans(text);

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
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

function clampConfidenceScore(score: number): number {
  return Math.max(0.01, Math.min(score, 0.99));
}

function lexicalRiskPenalty(replacement: string, dictionary: DictionaryData): number {
  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(normalizeDictionaryWord(replacement));
  if (!lexicalEntry) {
    return 0;
  }

  let penalty = 0;

  if (lexicalEntry.autoCorrect === "review") {
    penalty += 0.14;
  }

  if ((lexicalEntry.classes?.length || 0) > 1) {
    penalty += 0.12;
  }

  if (lexicalEntry.irregular) {
    penalty += 0.05;
  }

  if (lexicalEntry.tags?.some((tag) => ["tecnico", "produto", "marca", "plataforma", "interno", "ia", "desenvolvimento"].includes(tag))) {
    penalty += 0.12;
  }

  return penalty;
}

function deriveMatchConfidence(match: RuleMatch, text: string, dictionary: DictionaryData): MatchConfidence {
  if (match.confidence) {
    return match.confidence;
  }

  const original = text.slice(match.offset, match.offset + match.length);
  const primaryReplacement = match.replacements[0]?.value || "";
  const replacementPenalty = lexicalRiskPenalty(primaryReplacement, dictionary);
  const hasMultipleSuggestions = match.replacements.length > 1;

  if (match.rule.id === "PT_BR_REPEATED_WORD") {
    return createConfidence("high", 0.98, "repeticao literal detectada");
  }

  if (match.rule.id === "PT_BR_DOUBLE_SPACE") {
    return createConfidence("high", 0.99, "padrao mecanico de espaco duplicado");
  }

  if (match.rule.id === "PT_BR_SPACE_BEFORE_PUNCTUATION") {
    return createConfidence("high", 0.98, "padrao mecanico de pontuacao");
  }

  if (match.rule.id === "PT_BR_SENTENCE_CASE") {
    return createConfidence("high", 0.94, "regra ortografica simples de inicio de frase");
  }

  if (match.rule.id.startsWith("PT_BR_PUNCTUATION_")) {
    let score = 0.88;
    if (match.rule.id === "PT_BR_PUNCTUATION_POREM") {
      score = 0.94;
    }
    if (match.rule.id.includes("FINAL_")) {
      score = 0.84;
    }
    if (match.rule.id.includes("GREETING_NAME") || match.rule.id.includes("INITIAL_MARKER")) {
      score = 0.9;
    }
    return createConfidence(score >= 0.85 ? "high" : "medium", clampConfidenceScore(score), "heuristica de pontuacao recorrente");
  }

  if (match.rule.id === "PT_BR_SIMPLE_SYNTAX_PATTERN") {
    return createConfidence("low", 0.42, "padrao sintatico heuristico e sensivel a contexto");
  }

  if (match.rule.id === "PT_BR_SIMPLE_VERBAL_AGREEMENT") {
    let score = 0.78;
    if (match.length <= 3) {
      score -= 0.08;
    }
    return createConfidence(score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "concordancia verbal por heuristica local");
  }

  if (match.rule.id === "PT_BR_SIMPLE_NOMINAL_AGREEMENT") {
    let score = 0.74;
    if (match.length <= 3) {
      score -= 0.08;
    }
    return createConfidence(score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "concordancia nominal por heuristica local");
  }

  if (match.rule.id.startsWith("PT_BR_CONTEXT_") || match.rule.id.includes("CONTEXT")) {
    let score = 0.88;
    if (hasMultipleSuggestions) {
      score -= 0.08;
    }
    return createConfidence(score >= 0.85 ? "high" : "medium", clampConfidenceScore(score), "regra contextual explicita");
  }

  // Casos de ambiguidade morfológica - confiança reduzida
  if (match.rule.id.startsWith("PT_BR_AMBIGUITY_") || match.rule.id.startsWith("PT_BR_ENHANCED_")) {
    let score = 0.72; // Base mais baixa para casos ambíguos
    if (hasMultipleSuggestions) {
      score -= 0.12; // Penalidade maior para múltiplas sugestões
    }
    if (match.length <= 3) {
      score -= 0.08;
    }
    // Ambiguidade específica tem confiança ainda menor
    if (match.rule.id.includes("MEIO_") || match.rule.id.includes("BASTANTE_") || match.rule.id.includes("MUITO_")) {
      score -= 0.06;
    }
    return createConfidence(score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "caso ambiguo - revisao recomendada");
  }

  // Casos de ambiguidade semântica - confiança muito baixa, requer intervenção do usuário
  if (match.rule.id.startsWith("PT_BR_SEMANTIC_")) {
    let score = 0.65; // Base muito baixa para ambiguidades semânticas
    if (hasMultipleSuggestions) {
      score -= 0.15; // Penalidade máxima para múltiplas sugestões
    }
    if (match.length <= 3) {
      score -= 0.10;
    }
    // Ambiguidade semântica grave tem confiança ainda menor
    if (match.rule.id.includes("AMBIGUITY")) {
      score -= 0.08;
    }
    return createConfidence(score >= 0.60 ? "medium" : "low", clampConfidenceScore(score), "ambiguidade semântica - intervenção do usuário necessária");
  }

  if (match.rule.id.startsWith("PT_BR_PHRASE_")) {
    let score = 0.97;
    if (hasMultipleSuggestions) {
      score -= 0.04;
    }
    if (match.length <= 4) {
      score -= 0.06;
    }
    return createConfidence(score >= 0.85 ? "high" : "medium", clampConfidenceScore(score), "regra frasal explicita");
  }

  if (match.rule.issueType === "style") {
    let score = 0.76;
    if (hasMultipleSuggestions) {
      score -= 0.06;
    }
    if (match.length >= 12) {
      score -= 0.04;
    }
    return createConfidence(score >= 0.85 ? "high" : score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "ajuste de frase ou estilo");
  }

  if (match.rule.id === "PT_BR_SIMPLE_REPLACE") {
    let score = 0.9;
    if (hasMultipleSuggestions) {
      score -= 0.1;
    }
    if (original.length <= 3) {
      score -= 0.12;
    }
    if (Math.abs(primaryReplacement.length - original.length) >= 3) {
      score -= 0.08;
    }
    score -= replacementPenalty;
    return createConfidence(score >= 0.85 ? "high" : score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "substituicao lexical direta");
  }

  if (match.rule.issueType === "grammar") {
    return createConfidence("medium", 0.72, "heuristica gramatical");
  }

  return createConfidence("high", 0.9, "confianca padrao");
}

function shouldExposeMatch(match: RuleMatch): boolean {
  if (match.replacements.length) {
    return true;
  }

  if (match.confidence?.level === "low") {
    return false;
  }

  return true;
}

function collapseOverlappingMatches(matches: RuleMatch[]): RuleMatch[] {
  const selected: RuleMatch[] = [];
  const ranked = [...matches].sort((left, right) => (
    (right.confidence?.score || 0) - (left.confidence?.score || 0)
    || right.length - left.length
    || left.offset - right.offset
  ));

  for (const candidate of ranked) {
    const start = candidate.offset;
    const end = candidate.offset + candidate.length;
    const overlaps = selected.some((existing) => (
      start < existing.offset + existing.length
      && existing.offset < end
    ));

    if (!overlaps) {
      selected.push(candidate);
    }
  }

  return selected.sort((left, right) => left.offset - right.offset || left.length - right.length);
}

function finalizeMatches(text: string, matches: RuleMatch[], dictionary: DictionaryData): CheckResult {
  const visibleMatches = collapseOverlappingMatches(matches
    .map((match) => ({
      ...match,
      confidence: deriveMatchConfidence(match, text, dictionary)
    }))
    .filter((match) => shouldExposeMatch(match)));

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
    matches: visibleMatches
  };
}

function storeCheckResultInCache(text: string, result: CheckResult): void {
  if (checkResultCache.has(text)) {
    checkResultCache.delete(text);
  }
  checkResultCache.set(text, result);

  if (checkResultCache.size <= MAX_CHECK_RESULT_CACHE_SIZE) {
    return;
  }

  const oldestKey = checkResultCache.keys().next().value;
  if (typeof oldestKey === "string") {
    checkResultCache.delete(oldestKey);
  }
}

function hasSingleWholeTextMatch(result: CheckResult, text: string): boolean {
  return (
    result.matches.length === 1
    && result.matches[0]?.offset === 0
    && result.matches[0]?.length === text.length
    && Boolean(result.matches[0]?.replacements[0]?.value)
  );
}

function collectVisibleStageMatches(text: string, dictionary: DictionaryData, matches: RuleMatch[]): RuleMatch[] {
  return finalizeMatches(text, matches, dictionary).matches;
}

function findWholeTextSpecialistMatches(text: string, replacements: ReplacementEntry[], dictionary: DictionaryData): RuleMatch[] {
  const candidates = [
    ...createReplacementMatches(text, replacements),
    ...createPhraseRuleMatches(text, dictionary.phraseRules),
    ...createContextRuleMatches(text, dictionary.contextRules)
  ];

  const wholeTextCandidates = candidates.filter((match) => match.offset === 0 && match.length === text.length);
  if (!wholeTextCandidates.length) {
    return [];
  }

  return finalizeMatches(text, wholeTextCandidates, dictionary).matches
    .filter((match) => match.offset === 0 && match.length === text.length);
}

function createInferenceStages(replacements: ReplacementEntry[], dictionary: DictionaryData): InferenceStageDefinition[] {
  return [
    {
      id: "symbolic_context",
      description: "Aplica especialistas simbolicos de frase e contexto.",
      collectMatches: (text) => [
        ...createPhraseRuleMatches(text, dictionary.phraseRules),
        ...createContextRuleMatches(text, dictionary.contextRules),
        ...createPorQueHeuristicMatches(text),
        ...createCraseHeuristicMatches(text),
        ...createLocalizationDateMatches(text),
        ...createAnnouncementAgreementMatches(text)
      ]
    },
    {
      id: "ambiguity_resolution",
      description: "Resolve casos de ambiguidade morfológica e contextual.",
      collectMatches: (text) => [
        ...createAmbiguityResolutionMatches(text, dictionary),
        ...createEnhancedContextRuleMatches(text, dictionary)
      ]
    },
    {
      id: "semantic_analysis",
      description: "Analisa ambiguidades semânticas e contextos regionais.",
      collectMatches: (text) => [
        ...createSemanticAnalysisMatches(text, dictionary)
      ]
    },
    {
      id: "normalization",
      description: "Normaliza trocas seguras e problemas mecanicos.",
      collectMatches: (text) => [
        ...createReplacementMatches(text, replacements),
        ...createRepeatedWordMatches(text),
        ...createDoubleSpaceMatches(text),
        ...createSpaceBeforePunctuationMatches(text),
        ...createSentenceCaseMatches(text)
      ]
    },
    {
      id: "linguistic_agreement",
      description: "Resolve concordancia e sintaxe curta.",
      collectMatches: (text) => [
        ...createSimpleVerbalAgreementMatches(text, dictionary),
        ...createSimpleNominalAgreementMatches(text, dictionary),
        ...createSimpleSyntaxPatternMatches(text, dictionary)
      ]
    },
    {
      id: "refinement",
      description: "Fecha a frase com refinamentos heurísticos.",
      collectMatches: (text) => {
        const punctuationHeuristicMatches = createPunctuationHeuristicMatches(text);
        const unknownWordMatches = createUnknownWordMatches(text, dictionary).filter((candidate) => (
          !punctuationHeuristicMatches.some((existing) => (
            candidate.offset < existing.offset + existing.length
            && existing.offset < candidate.offset + candidate.length
          ))
        ));

        return [
          ...punctuationHeuristicMatches,
          ...unknownWordMatches
        ];
      }
    }
  ];
}

function runInferencePipeline(text: string, replacements: ReplacementEntry[], dictionary: DictionaryData): CheckResult {
  const wholeTextMatches = findWholeTextSpecialistMatches(text, replacements, dictionary);
  if (wholeTextMatches.length) {
    return finalizeMatches(text, wholeTextMatches, dictionary);
  }

  let currentText = text;
  let exactWholeTextResult: CheckResult | null = null;

  for (const stage of createInferenceStages(replacements, dictionary)) {
    const visibleMatches = collectVisibleStageMatches(currentText, dictionary, stage.collectMatches(currentText));
    if (!visibleMatches.length) {
      continue;
    }

    if (visibleMatches.length === 1 && visibleMatches[0]?.offset === 0 && visibleMatches[0]?.length === currentText.length) {
      exactWholeTextResult = finalizeMatches(text, [createWholeTextInferenceMatch(text, visibleMatches[0].replacements[0]?.value || currentText)], dictionary);
      currentText = visibleMatches[0].replacements[0]?.value || currentText;
      break;
    }

    const nextText = applyVisibleMatches(currentText, visibleMatches);
    if (nextText === currentText) {
      continue;
    }

    currentText = nextText;
  }

  if (exactWholeTextResult) {
    return exactWholeTextResult;
  }

  return finalizeMatches(text, createConsolidatedInferenceMatches(text, currentText), dictionary);
}

function checkTextSinglePass(text: string, replacements: ReplacementEntry[], dictionary: DictionaryData): CheckResult {
  return runInferencePipeline(text, replacements, dictionary);

  const replacementMatches = createReplacementMatches(text, replacements);
  const exactWholeTextReplacementMatches = replacementMatches.filter((match) => match.offset === 0 && match.length === text.length);
  if (exactWholeTextReplacementMatches.length) {
    return finalizeMatches(text, exactWholeTextReplacementMatches, dictionary);
  }

  const phraseRuleMatches = createPhraseRuleMatches(text, dictionary.phraseRules);
  const contextRuleMatches = createContextRuleMatches(text, dictionary.contextRules);
  const craseHeuristicMatches = createCraseHeuristicMatches(text);
  const localizationDateMatches = createLocalizationDateMatches(text);
  const announcementAgreementMatches = createAnnouncementAgreementMatches(text);
  const verbalAgreementMatches = createSimpleVerbalAgreementMatches(text, dictionary);
  const nominalAgreementMatches = createSimpleNominalAgreementMatches(text, dictionary);
  const syntaxPatternMatches = createSimpleSyntaxPatternMatches(text, dictionary);
  const baseProtectedMatches = [
    ...replacementMatches,
    ...phraseRuleMatches,
    ...contextRuleMatches,
    ...craseHeuristicMatches,
    ...localizationDateMatches,
    ...announcementAgreementMatches,
    ...verbalAgreementMatches,
    ...nominalAgreementMatches,
    ...syntaxPatternMatches
  ];
  const punctuationHeuristicMatches = createPunctuationHeuristicMatches(text).filter((candidate) => (
    !baseProtectedMatches.some((existing) => (
      candidate.offset < existing.offset + existing.length
      && existing.offset < candidate.offset + candidate.length
    ))
  ));
  const protectedMatches = [...baseProtectedMatches, ...punctuationHeuristicMatches];
  const unknownWordMatches = createUnknownWordMatches(text, dictionary).filter((candidate) => (
    !protectedMatches.some((existing) => (
      candidate.offset < existing.offset + existing.length
      && existing.offset < candidate.offset + candidate.length
    ))
  ));

  const allMatches = [
    ...replacementMatches,
    ...phraseRuleMatches,
    ...contextRuleMatches,
    ...craseHeuristicMatches,
    ...localizationDateMatches,
    ...announcementAgreementMatches,
    ...verbalAgreementMatches,
    ...nominalAgreementMatches,
    ...syntaxPatternMatches,
    ...punctuationHeuristicMatches,
    ...unknownWordMatches,
    ...createRepeatedWordMatches(text),
    ...createDoubleSpaceMatches(text),
    ...createSpaceBeforePunctuationMatches(text),
    ...createSentenceCaseMatches(text)
  ]
    .map((match) => ({
      ...match,
      confidence: deriveMatchConfidence(match, text, dictionary)
    }))
    .filter((match) => shouldExposeMatch(match))
    ;

  const result = finalizeMatches(text, allMatches, dictionary);
  return result;
}

export function checkText(text: string, replacements: ReplacementEntry[], dictionary: DictionaryData): CheckResult {
  const cached = checkResultCache.get(text);
  if (cached) {
    return cached;
  }

  let currentText = text;
  let passResult = checkTextSinglePass(currentText, replacements, dictionary);

  if (hasSingleWholeTextMatch(passResult, text)) {
    storeCheckResultInCache(text, passResult);
    return passResult;
  }

  let passCount = 1;

  while (passCount < MAX_CORRECTION_PASSES) {
    if (!passResult.matches.length) {
      break;
    }

    const nextText = applyVisibleMatches(currentText, passResult.matches);
    if (nextText === currentText) {
      break;
    }

    currentText = nextText;
    passResult = checkTextSinglePass(currentText, replacements, dictionary);
    passCount += 1;
  }

  const result = currentText !== text && passCount > 1
    ? finalizeMatches(text, createConsolidatedInferenceMatches(text, currentText), dictionary)
    : checkTextSinglePass(text, replacements, dictionary);

  storeCheckResultInCache(text, result);
  return result;
}
