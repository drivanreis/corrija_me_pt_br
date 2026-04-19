import { buildContext, dedupeStrings, normalizeDictionaryWord, preserveReplacementCase, createWordTokenPattern } from "./text.js";
import type { PhraseRuleDefinition, RuleMatch, RulePatternToken } from "./types.js";

interface TokenMatch {
  value: string;
  normalized: string;
  offset: number;
  length: number;
}

function tokenizeText(text: string): TokenMatch[] {
  const tokens: TokenMatch[] = [];
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

function createPhraseMatch(text: string, startToken: TokenMatch, endToken: TokenMatch, rule: PhraseRuleDefinition): RuleMatch {
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

function isSentenceStart(text: string, offset: number): boolean {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (!char || /\s/u.test(char)) {
      continue;
    }

    return /[.!?\n\r]/u.test(char);
  }

  return true;
}

function isHourToken(token: TokenMatch): boolean {
  const value = token.normalized;
  if (!value) {
    return false;
  }

  if (/^\d{1,2}$/u.test(value)) {
    return true;
  }

  const hourWords = new Set([
    "zero",
    "uma",
    "duas",
    "três",
    "tres",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
    "onze",
    "doze"
  ]);

  return hourWords.has(value);
}

function tokenMatches(expected: RulePatternToken, token: TokenMatch): boolean {
  if (typeof expected === "string") {
    return token.normalized === normalizeDictionaryWord(expected);
  }

  if ("any" in expected && expected.any) {
    return true;
  }

  if ("oneOf" in expected) {
    return expected.oneOf.some((value) => token.normalized === normalizeDictionaryWord(value));
  }

  if ("category" in expected) {
    if (expected.category === "hour") {
      return isHourToken(token);
    }
  }

  return false;
}

export function createPhraseRuleMatches(text: string, rules: PhraseRuleDefinition[]): RuleMatch[] {
  if (!rules.length) {
    return [];
  }

  const tokens = tokenizeText(text);
  const matches: RuleMatch[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    for (const rule of rules) {
      if (index + rule.pattern.length > tokens.length) {
        continue;
      }

      const startToken = tokens[index];
      if (!startToken) {
        continue;
      }

      if (rule.scope?.sentenceStart && !isSentenceStart(text, startToken.offset)) {
        continue;
      }

      const matched = rule.pattern.every((expected, patternIndex) => {
        const token = tokens[index + patternIndex];
        if (!token) {
          return false;
        }
        return tokenMatches(expected, token);
      });

      if (!matched) {
        continue;
      }

      const endToken = tokens[index + rule.pattern.length - 1];
      if (!startToken || !endToken) {
        continue;
      }

      matches.push(createPhraseMatch(text, startToken, endToken, rule));
    }
  }

  return matches;
}
