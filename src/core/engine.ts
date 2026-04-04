import { createContextRuleMatches } from "./context-rules.js";
import { createSimpleNominalAgreementMatches } from "./nominal-agreement.js";
import { createPhraseRuleMatches } from "./phrase-rules.js";
import { createPunctuationHeuristicMatches } from "./punctuation-rules.js";
import { createSimpleSyntaxPatternMatches } from "./syntax-patterns.js";
import { createSimpleVerbalAgreementMatches } from "./verbal-agreement.js";
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

function createDictionaryMistakeMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  if (!dictionary.commonMistakes.length) {
    return [];
  }

  return createReplacementMatches(text, dictionary.commonMistakes);
}

function isIgnorableToken(word: string): boolean {
  return (
    word.length < 3
    || /\d/u.test(word)
    || /^[A-Z0-9_-]+$/u.test(word)
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

  if (match.rule.id.startsWith("PT_BR_PHRASE_")) {
    let score = 0.93;
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

export function checkText(text: string, replacements: ReplacementEntry[], dictionary: DictionaryData): CheckResult {
  const replacementMatches = createReplacementMatches(text, replacements);
  const dictionaryMistakeMatches = createDictionaryMistakeMatches(text, dictionary);
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
    ...dictionaryMistakeMatches,
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
    ...dictionaryMistakeMatches,
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

  const visibleMatches = collapseOverlappingMatches(allMatches);

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
