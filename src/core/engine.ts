import { buildContext, createWholeWordPattern, dedupeStrings, isWordLike, preserveReplacementCase } from "./text.js";
import type { CheckResult, ReplacementEntry, RuleMatch } from "./types.js";

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

function createRepeatedWordMatches(text: string): RuleMatch[] {
  const pattern = /\b([\p{L}\p{N}]+)\s+(\1)\b/giu;
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

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const prefix = match[1];
    const lowerChar = match[2];
    const offset = match.index + prefix.length;
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

export function checkText(text: string, replacements: ReplacementEntry[]): CheckResult {
  const allMatches = [
    ...createReplacementMatches(text, replacements),
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
