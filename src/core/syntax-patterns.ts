import { buildContext, createWordTokenPattern, normalizeDictionaryWord } from "./text.js";
import type { BasicSyntaxPattern, DictionaryData, LexicalEntry, RuleMatch } from "./types.js";

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

function getRelevantSyntaxClasses(entry: LexicalEntry | undefined): string[] {
  if (!entry) {
    return [];
  }

  const relevant = entry.classes.filter((value) => (
    value === "pronome"
    || value === "verbo"
    || value === "substantivo"
    || value === "artigo"
    || value === "adjetivo"
    || value === "adverbio"
    || value === "preposicao"
  ));

  return Array.from(new Set(relevant));
}

function getPrimarySyntaxClass(entry: LexicalEntry | undefined): string | null {
  const relevant = getRelevantSyntaxClasses(entry);
  return relevant.length === 1 ? relevant[0] : null;
}

function matchesPattern(sequence: string[], pattern: BasicSyntaxPattern): boolean {
  return sequence.length === pattern.pattern.length
    && sequence.every((value, index) => value === pattern.pattern[index]);
}

function hasLongerValidPattern(tokens: TokenMatch[], startIndex: number, patterns: BasicSyntaxPattern[], dictionary: DictionaryData, currentLength: number): boolean {
  for (const pattern of patterns) {
    if (pattern.pattern.length <= currentLength) {
      continue;
    }

    const slice = tokens.slice(startIndex, startIndex + pattern.pattern.length);
    if (slice.length !== pattern.pattern.length) {
      continue;
    }

    const sequence = slice.map((token) => {
      const entry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
      return getPrimarySyntaxClass(entry);
    });

    if (sequence.some((value) => value === null)) {
      continue;
    }

    if (matchesPattern(sequence as string[], pattern)) {
      return true;
    }
  }

  return false;
}

function hasExactPatternOfSameLength(sequence: string[], patterns: BasicSyntaxPattern[]): boolean {
  return patterns.some((pattern) => (
    pattern.pattern.length === sequence.length
    && matchesPattern(sequence, pattern)
  ));
}

function createSyntaxMatch(text: string, startToken: TokenMatch, endToken: TokenMatch, sequence: string[]): RuleMatch {
  const offset = startToken.offset;
  const length = endToken.offset + endToken.length - startToken.offset;

  return {
    message: "Estrutura sintatica simples possivelmente invalida.",
    shortMessage: "Estrutura sintatica simples possivelmente invalida.",
    offset,
    length,
    replacements: [],
    rule: {
      id: "PT_BR_SIMPLE_SYNTAX_PATTERN",
      description: `Sequencia simples nao reconhecida pelos padroes basicos: ${sequence.join(" + ")}.`,
      issueType: "grammar"
    },
    context: buildContext(text, offset, length)
  };
}

function crossesSentenceBoundary(text: string, slice: TokenMatch[]): boolean {
  for (let index = 0; index < slice.length - 1; index += 1) {
    const current = slice[index];
    const next = slice[index + 1];
    if (!current || !next) {
      continue;
    }

    const between = text.slice(current.offset + current.length, next.offset);
    if (/[.!?;:]/u.test(between)) {
      return true;
    }
  }

  return false;
}

function hasUnknownNeighboringSyntaxClass(tokens: TokenMatch[], startIndex: number, endIndex: number, dictionary: DictionaryData): boolean {
  const left = Math.max(0, startIndex - 1);
  const right = Math.min(tokens.length - 1, endIndex + 1);

  for (let index = left; index <= right; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    const entry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
    const primaryClass = getPrimarySyntaxClass(entry);
    if (primaryClass === null) {
      return true;
    }
  }

  return false;
}

export function createSimpleSyntaxPatternMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  const patterns = dictionary.linguisticData.syntaxPatterns || [];
  if (!patterns.length) {
    return [];
  }

  const tokens = tokenizeText(text);
  const matches: RuleMatch[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    for (const pattern of patterns) {
      const slice = tokens.slice(index, index + pattern.pattern.length);
      if (slice.length !== pattern.pattern.length) {
        continue;
      }

      if (crossesSentenceBoundary(text, slice)) {
        continue;
      }

      const sequence = slice.map((token) => {
        const entry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
        return getPrimarySyntaxClass(entry);
      });

      if (sequence.some((value) => value === null)) {
        continue;
      }

      const syntaxSequence = sequence as string[];
      if (hasExactPatternOfSameLength(syntaxSequence, patterns)) {
        continue;
      }

      const startsLikePattern = syntaxSequence[0] === pattern.pattern[0];
      const differsByOne = syntaxSequence.filter((value, seqIndex) => value !== pattern.pattern[seqIndex]).length === 1;
      if (!startsLikePattern || !differsByOne) {
        continue;
      }

      if (hasLongerValidPattern(tokens, index, patterns, dictionary, pattern.pattern.length)) {
        continue;
      }

      if (hasUnknownNeighboringSyntaxClass(tokens, index, index + pattern.pattern.length - 1, dictionary)) {
        continue;
      }

      const startToken = slice[0];
      const endToken = slice[slice.length - 1];
      if (!startToken || !endToken) {
        continue;
      }

      const key = `${startToken.offset}:${endToken.offset + endToken.length}:${syntaxSequence.join("+")}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      matches.push(createSyntaxMatch(text, startToken, endToken, syntaxSequence));
    }
  }

  return matches;
}
