import { createContextRuleMatches } from "./context-rules.js";
import { createSimpleNominalAgreementMatches } from "./nominal-agreement.js";
import { createPhraseRuleMatches } from "./phrase-rules.js";
import { createSimpleSyntaxPatternMatches } from "./syntax-patterns.js";
import { createSimpleVerbalAgreementMatches } from "./verbal-agreement.js";
import { buildContext, createWholeWordPattern, createWordTokenPattern, dedupeStrings, isWordLike, normalizeDictionaryWord, preserveReplacementCase, stripDiacritics } from "./text.js";
import type { CheckResult, DictionaryData, ReplacementEntry, RuleMatch } from "./types.js";

interface TextSpan {
  offset: number;
  length: number;
}

function createMatch(text: string, offset: number, length: number, replacements: string[], ruleId: string, message: string, description: string): RuleMatch {
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

function createReplacementMatches(text: string, entries: ReplacementEntry[]): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const entry of entries) {
    const pattern = isWordLike(entry.from) ? createWholeWordPattern(entry.from) : new RegExp(entry.from, "giu");
    const textMatches = text.matchAll(pattern);

    for (const match of textMatches) {
      if (match.index === undefined) {
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

function createUnknownWordSuggestions(word: string, dictionary: DictionaryData): string[] {
  const normalizedWord = normalizeDictionaryWord(word);
  const plainWord = stripDiacritics(normalizedWord);
  const originalDiacritics = countDiacriticMarks(normalizedWord);
  const candidates: Array<{ word: string; score: number }> = [];

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

    candidates.push({
      word: candidate,
      score: samePlainWord ? normalizedDistance : distance + normalizedDistance
    });
  }

  return candidates
    .sort((left, right) => left.score - right.score || left.word.localeCompare(right.word, "pt-BR"))
    .slice(0, 5)
    .map((entry) => preserveReplacementCase(word, entry.word));
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

export function checkText(text: string, replacements: ReplacementEntry[], dictionary: DictionaryData): CheckResult {
  const replacementMatches = createReplacementMatches(text, replacements);
  const dictionaryMistakeMatches = createDictionaryMistakeMatches(text, dictionary);
  const phraseRuleMatches = createPhraseRuleMatches(text, dictionary.phraseRules);
  const contextRuleMatches = createContextRuleMatches(text, dictionary.contextRules);
  const verbalAgreementMatches = createSimpleVerbalAgreementMatches(text, dictionary);
  const nominalAgreementMatches = createSimpleNominalAgreementMatches(text, dictionary);
  const syntaxPatternMatches = createSimpleSyntaxPatternMatches(text, dictionary);
  const protectedMatches = [...replacementMatches, ...dictionaryMistakeMatches, ...phraseRuleMatches, ...contextRuleMatches, ...verbalAgreementMatches, ...nominalAgreementMatches, ...syntaxPatternMatches];
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
    ...verbalAgreementMatches,
    ...nominalAgreementMatches,
    ...syntaxPatternMatches,
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
