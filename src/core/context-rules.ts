import { buildContext, createWordTokenPattern, dedupeStrings, normalizeDictionaryWord, preserveReplacementCase } from "./text.js";
import type { ContextRuleDefinition, RuleMatch } from "./types.js";

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

      const matched = rule.pattern.every((expected, patternIndex) => (
        tokens[index + patternIndex]?.normalized === normalizeDictionaryWord(expected)
      ));

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
