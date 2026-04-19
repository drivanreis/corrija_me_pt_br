import { buildContext, createWordTokenPattern, dedupeStrings, normalizeDictionaryWord, preserveReplacementCase } from "./text.js";
import type { ContextRuleDefinition, RuleMatch, RulePatternToken } from "./types.js";

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

function createContextMatch(text: string, token: TokenMatch, rule: ContextRuleDefinition): RuleMatch {
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

function isSentenceStart(text: string, offset: number): boolean {
  // Look for the previous non-whitespace character before the first token of the match.
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

  // Digits (e.g. 10) and common hour words (e.g. dez).
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

export function createContextRuleMatches(text: string, rules: ContextRuleDefinition[]): RuleMatch[] {
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

      const targetToken = tokens[index + rule.targetIndex];
      if (!targetToken) {
        continue;
      }

      matches.push(createContextMatch(text, targetToken, rule));
    }
  }

  return matches;
}
