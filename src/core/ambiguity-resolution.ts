import { buildContext, createWordTokenPattern, normalizeDictionaryWord, preserveReplacementCase } from "./text.js";
import type { DictionaryData, MatchConfidence, RuleMatch } from "./types.js";


interface TokenSlice {
  value: string;
  normalized: string;
  offset: number;
  length: number;
}

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
  confidence: MatchConfidence
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
      issueType: "grammar"
    },
    context: buildContext(text, offset, length)
  };
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

function getSurroundingContext(tokens: TokenSlice[], targetIndex: number, windowSize: number = 3): {
  before: TokenSlice[];
  after: TokenSlice[];
  fullContext: string;
} {
  const start = Math.max(0, targetIndex - windowSize);
  const end = Math.min(tokens.length, targetIndex + windowSize + 1);

  const before = tokens.slice(start, targetIndex);
  const after = tokens.slice(targetIndex + 1, end);
  const fullContext = tokens.slice(start, end).map(t => t.value).join(' ');

  return { before, after, fullContext };
}

function isAdverbialContext(before: TokenSlice[], after: TokenSlice[]): boolean {
  // Contextos onde 'meio' funciona como advérbio (invariável)
  const adverbialIndicators = [
    // Seguido de adjetivo
    ...after.map(t => t.normalized).filter(word =>
      ['triste', 'feliz', 'confuso', 'cansado', 'contente', 'nervoso', 'preocupado'].includes(word)
    ),
    // Precedido por verbos de estado
    ...before.map(t => t.normalized).filter(word =>
      ['estar', 'ficar', 'parecer', 'permanecer', 'andar'].includes(word)
    )
  ];

  return adverbialIndicators.length > 0;
}

function isNumeralContext(before: TokenSlice[], after: TokenSlice[]): boolean {
  // Contextos onde 'meia' funciona como numeral (variável)
  const numeralIndicators = [
    // Seguido de substantivos contáveis
    ...after.map(t => t.normalized).filter(word =>
      ['pizza', 'hora', 'duzia', 'dúzia', 'dezena', 'centena', 'milhar'].includes(word)
    ),
    // Contextos de tempo/quantidade
    ...before.map(t => t.normalized).filter(word =>
      ['comeu', 'comeu', 'bebeu', 'tomou', 'passou', 'esperou'].includes(word)
    ),
    // Numerais e medidas
    ...before.map(t => t.normalized).filter(word =>
      ['uma', 'duas', 'três', 'quatro', 'cinco'].includes(word)
    )
  ];

  return numeralIndicators.length > 0;
}

function createAmbiguityResolutionMatchesInternal(text: string, _dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const tokens = tokenizeSlices(text);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.normalized === 'meio' || token.normalized === 'meia') {
      const { before, after } = getSurroundingContext(tokens, i);

      // Análise de contexto para 'meio/meia'
      if (token.normalized === 'meia') {
        // 'meia' incorreta como advérbio
        if (isAdverbialContext(before, after)) {
          addIfNoOverlap(matches, createMatch(
            text,
            token.offset,
            token.length,
            [preserveReplacementCase(token.value, 'meio')],
            'PT_BR_AMBIGUITY_MEIO_ADVERB',
            'Use "meio" (invariável) como advérbio de intensidade.',
            'Corrige ambiguidade: advérbio "meio" vs numeral "meia".',
            createConfidence('medium', 0.75, 'contexto adverbial detectado')
          ));
        }
      }

      if (token.normalized === 'meio') {
        // 'meio' incorreto como numeral
        if (isNumeralContext(before, after)) {
          addIfNoOverlap(matches, createMatch(
            text,
            token.offset,
            token.length,
            [preserveReplacementCase(token.value, 'meia')],
            'PT_BR_AMBIGUITY_MEIA_NUMERAL',
            'Use "meia" como numeral (metade).',
            'Corrige ambiguidade: numeral "meia" vs advérbio "meio".',
            createConfidence('medium', 0.78, 'contexto numeral detectado')
          ));
        }
      }
    }
  }

  return matches;
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

// Casos adicionais de ambiguidade podem ser adicionados aqui
function createBastanteAmbiguityMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const tokens = tokenizeSlices(text);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.normalized === 'bastante') {
      const { before, after } = getSurroundingContext(tokens, i);

      // 'bastante' como adjetivo (variável) vs advérbio (invariável)
      const nextToken = after[0];
      if (nextToken) {
        const nextNormalized = nextToken.normalized;

        // Se seguido de substantivo, pode ser adjetivo (variável)
        if (dictionary.linguisticData.lexicalEntries.has(nextNormalized)) {
          const entry = dictionary.linguisticData.lexicalEntries.get(nextNormalized)!;
          if (entry.classes?.includes('substantivo')) {
            // Verificar se está no plural
            if (nextNormalized.endsWith('s') && !token.normalized.endsWith('s')) {
              addIfNoOverlap(matches, createMatch(
                text,
                token.offset,
                token.length,
                [preserveReplacementCase(token.value, 'bastantes')],
                'PT_BR_AMBIGUITY_BASTANTE_ADJ_PLURAL',
                'Use "bastantes" para concordar com substantivo plural.',
                'Corrige concordância: adjetivo "bastante" varia em número.',
                createConfidence('medium', 0.72, 'concordância adjetiva plural')
              ));
            }
          }
        }
      }
    }
  }

  return matches;
}

function createMuitoAmbiguityMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const tokens = tokenizeSlices(text);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.normalized === 'muito') {
      const { before, after } = getSurroundingContext(tokens, i);

      // 'muito' como adjetivo (variável) vs advérbio (invariável)
      const nextToken = after[0];
      if (nextToken) {
        const nextNormalized = nextToken.normalized;

        // Se seguido de substantivo, é adjetivo (variável)
        if (dictionary.linguisticData.lexicalEntries.has(nextNormalized)) {
          const entry = dictionary.linguisticData.lexicalEntries.get(nextNormalized)!;
          if (entry.classes?.includes('substantivo')) {
            // Verificar se está no plural
            if (nextNormalized.endsWith('s') && !token.normalized.endsWith('s')) {
              addIfNoOverlap(matches, createMatch(
                text,
                token.offset,
                token.length,
                [preserveReplacementCase(token.value, 'muitos')],
                'PT_BR_AMBIGUITY_MUITO_ADJ_PLURAL',
                'Use "muitos" para concordar com substantivo masculino plural.',
                'Corrige concordância: adjetivo "muito" varia em gênero e número.',
                createConfidence('medium', 0.74, 'concordância adjetiva plural')
              ));
            }
          }
        }
      }
    }
  }

  return matches;
}

export function createAmbiguityResolutionMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

  // Combinar diferentes analisadores de ambiguidade
  matches.push(...createAmbiguityResolutionMatchesInternal(text, dictionary));
  matches.push(...createBastanteAmbiguityMatches(text, dictionary));
  matches.push(...createMuitoAmbiguityMatches(text, dictionary));

  return matches;
}
