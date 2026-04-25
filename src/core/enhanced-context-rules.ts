import { buildContext, normalizeDictionaryWord, preserveReplacementCase } from "./text.js";
import type { DictionaryData, MatchConfidence, RuleMatch } from "./types.js";

interface ContextPattern {
  readonly id: string;
  readonly description: string;
  readonly test: (text: string, tokens: string[], index: number) => boolean;
  readonly getReplacement: (_original: string, _context: string[]) => string;
  readonly message: string;
  readonly confidence: MatchConfidence;
}

interface TokenSlice {
  readonly value: string;
  readonly normalized: string;
  readonly offset: number;
  readonly length: number;
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
  const pattern = /(?<![\p{L}\p{N}\p{M}])[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;

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

const VERBOS_PLURAL_A_GENTE = ['vamos', 'fomos', 'estamos', 'estavamos', 'tamos', 'íamos'] as const;

// Context patterns para regras generalizadas
const ENHANCED_CONTEXT_PATTERNS: ContextPattern[] = [
  {
    id: "PT_BR_ENHANCED_A_GENTE_CONCORDANCIA",
    description: "Concordância verbal com 'a gente' (3ª pessoa singular)",
    test: (text, tokens, index) => {
      const token = tokens[index];
      if (token !== "a" && token !== "gente") return false;

      // Verificar se temos 'a gente' no contexto
      const contextWindow = tokens.slice(Math.max(0, index - 2), Math.min(tokens.length, index + 3));
      const genteIndex = contextWindow.indexOf("gente");
      const aIndex = contextWindow.indexOf("a");

      if (genteIndex > 0 && aIndex === genteIndex - 1) {
        // Procurar verbo após 'a gente'
        const afterGente = contextWindow.slice(genteIndex + 1);
        if (afterGente.length > 0) {
          const verb = afterGente[0];
          // Verbos que devem estar no singular com 'a gente'
          return VERBOS_PLURAL_A_GENTE.includes(verb as typeof VERBOS_PLURAL_A_GENTE[number]);
        }
      }

      return false;
    },
    getReplacement: (_original: string, _context: string[]) => {
      const replacements: Record<string, string> = {
        "vamos": "vai",
        "fomos": "foi",
        "estamos": "está",
        "estavamos": "estava",
        "tamos": "tá",
        "íamos": "ia"
      };
      return replacements[_original] || _original;
    },
    message: "Com 'a gente', o verbo costuma ficar no singular.",
    confidence: createConfidence("high", 0.88, "concordância com 'a gente'")
  },

  {
    id: "PT_BR_ENHANCED_MUITO_BASTANTE_CONCORDANCIA",
    description: "Concordância adjetiva com 'muito'/'bastante'",
    test: (text, tokens, index) => {
      const token = tokens[index];
      if (token !== "muito" && token !== "bastante") return false;

      // Verificar se seguido de substantivo plural
      if (index < tokens.length - 1) {
        const nextToken = tokens[index + 1];
        return nextToken.endsWith('s'); // Indica plural
      }

      return false;
    },
    getReplacement: (_original: string, _context: string[]) => {
      if (_original === "muito") return "muitos";
      if (_original === "muita") return "muitas";
      if (_original === "bastante") return "bastantes";
      return _original;
    },
    message: "Use forma plural para concordar com substantivo plural.",
    confidence: createConfidence("medium", 0.76, "concordância adjetiva")
  },

  {
    id: "PT_BR_ENHANCED_MAIS_MAS_MAS",
    description: "Uso correto de 'mas' vs 'mais'",
    test: (text, tokens, index) => {
      const token = tokens[index];
      if (token !== "mais") return false;

      // Contexto antes e depois
      const before = index > 0 ? tokens[index - 1] : "";
      const after = index < tokens.length - 1 ? tokens[index + 1] : "";

      // 'mas' geralmente aparece entre orações com sentido de oposição
      // Se temos contexto de oposição, deve ser 'mas'
      const oppositionIndicators = [
        "porém", "contudo", "entretanto", "todavia", "no entanto"
      ];

      // Verificar se está em contexto de oposição
      const hasOpposition = oppositionIndicators.some(indicator =>
        tokens.includes(indicator) ||
        before === "," ||
        after === ","
      );

      return hasOpposition;
    },
    getReplacement: (_original: string, _context: string[]) => {
      return "mas";
    },
    message: "Use 'mas' para indicar oposição, não 'mais'.",
    confidence: createConfidence("medium", 0.73, "contexto de oposição")
  },

  {
    id: "PT_BR_ENHANCED_Aonde_ONDE",
    description: "Uso correto de 'aonde' vs 'onde'",
    test: (text, tokens, index) => {
      const token = tokens[index];
      if (token !== "onde") return false;

      // Verificar se contexto sugere movimento
      const movementVerbs = ["ir", "vir", "chegar", "entrar", "sair", "voltar", "mudar"];
      const contextWindow = tokens.slice(Math.max(0, index - 3), Math.min(tokens.length, index + 1));

      return movementVerbs.some(verb => contextWindow.includes(verb));
    },
    getReplacement: (_original: string, _context: string[]) => {
      return "aonde";
    },
    message: "Use 'aonde' com verbos de movimento.",
    confidence: createConfidence("medium", 0.71, "contexto de movimento")
  },

  {
    id: "PT_BR_ENHANCED_AFIM_A_FIM",
    description: "Uso correto de 'a fim de' vs 'afim'",
    test: (text, tokens, index) => {
      const token = tokens[index];
      if (token !== "afim") return false;

      // Verificar se seguido de 'de' + verbo no infinitivo
      if (index < tokens.length - 2) {
        const nextToken = tokens[index + 1];
        const afterNext = tokens[index + 2];
        return nextToken === "de" && afterNext.endsWith('r'); // Verbo no infinitivo
      }

      return false;
    },
    getReplacement: (_original: string, _context: string[]) => {
      return "a fim";
    },
    message: "Use 'a fim de' para indicar finalidade.",
    confidence: createConfidence("high", 0.85, "locução prepositiva")
  },

  {
    id: "PT_BR_ENHANCED_SE_NAO_SENAO",
    description: "Uso correto de 'senão' vs 'se não'",
    test: (text, tokens, index) => {
      const token = tokens[index];
      if (token !== "senao") return false;

      // Verificar se está em contexto condicional
      if (index > 0 && tokens[index - 1] === "se") {
        return false; // 'se não' está correto em condicionais
      }

      // 'senão' é usado para exceção/alternativa
      const exceptionIndicators = ["ou", "caso", "do"];
      return exceptionIndicators.some(indicator =>
        tokens.includes(indicator)
      );
    },
    getReplacement: (_original: string, _context: string[]) => {
      return "senão";
    },
    message: "Use 'senão' para indicar exceção ou alternativa.",
    confidence: createConfidence("medium", 0.74, "contexto de exceção")
  }
];

export function createEnhancedContextRuleMatches(text: string, _dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const tokens = tokenizeSlices(text).map(t => t.normalized);

  for (let i = 0; i < tokens.length; i++) {
    for (const pattern of ENHANCED_CONTEXT_PATTERNS) {
      if (pattern.test(text, tokens, i)) {
        const originalToken = tokenizeSlices(text)[i];
        const replacement = pattern.getReplacement(originalToken.value, tokens);

        if (replacement !== originalToken.value) {
          addIfNoOverlap(matches, createMatch(
            text,
            originalToken.offset,
            originalToken.length,
            [preserveReplacementCase(originalToken.value, replacement)],
            pattern.id,
            pattern.message,
            pattern.description,
            pattern.confidence
          ));
        }
      }
    }
  }

  return matches;
}
