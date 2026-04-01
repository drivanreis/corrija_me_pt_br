import { buildContext, dedupeStrings, normalizeDictionaryWord, preserveReplacementCase, createWordTokenPattern } from "./text.js";
import type { PhraseRuleDefinition, RuleMatch } from "./types.js";

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

      const matched = rule.pattern.every((expected, patternIndex) => (
        tokens[index + patternIndex]?.normalized === normalizeDictionaryWord(expected)
      ));

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
