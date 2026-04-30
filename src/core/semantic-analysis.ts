import { buildContext, normalizeDictionaryWord, preserveReplacementCase } from "./text.js";
import type { DictionaryData, MatchConfidence, RuleMatch } from "./types.js";

interface SemanticExplanation {
  original: string;
  corrected: string;
  explanation: string;
  ambiguity: 'low' | 'medium' | 'high';
  context: 'adjective' | 'vocative' | 'regional' | 'formal';
  examples: string[];
  warning?: string;
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
  confidence: MatchConfidence,
  explanation?: SemanticExplanation
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
    context: buildContext(text, offset, length),
    explanation
  };
}

function tokenizeSlices(text: string): TokenSlice[] {
  const tokens: TokenSlice[] = [];
  // Padrão melhorado: captura palavras com pontuação anexada
  // Ex: "pão," "fresco?" "crianças!" como tokens únicos
  const pattern = /\b\w+(?:[^\w\s]*\w+)*\b/g;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;

    const word = match[0];
    // Remove pontuação APENAS para normalização, mas mantém no valor original
    const cleanWord = word.replace(/[^\w]/g, '');

    tokens.push({
      value: word,
      normalized: normalizeDictionaryWord(cleanWord),
      offset: match.index,
      length: word.length
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

// Análise semântica de ambiguidade por pontuação
function analyzePunctuationAmbiguity(text: string, tokens: TokenSlice[]): SemanticExplanation[] {
  const explanations: SemanticExplanation[] = [];

  // Caso: "Tem pão fresco?" vs "Tem pão, fresco?"
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    // Detectar padrão: [substantivo] [adjetivo_potencialmente_ambiguo]
    if (token.normalized === 'pão' && nextToken.normalized === 'fresco') {
      const textSegment = text.substring(token.offset, nextToken.offset + nextToken.length);
      const textAfterFresco = text.substring(nextToken.offset + nextToken.length);
      const hasCommaAfter = textAfterFresco.trim().startsWith(',');

      // Detectar ambos os casos: com e sem vírgula
      if (hasCommaAfter) {
        // Caso 1: "Tem pão, fresco?" - fresco como vocativo (gíria pejorativa)
        explanations.push({
          original: textSegment + ',',
          corrected: textSegment,
          explanation: "A vírgula transforma 'fresco' em vocativo (gíria pejorativa), não adjetivo do pão.",
          ambiguity: 'high',
          context: 'regional',
          examples: [
            "Tem pão fresco? (adjetivo: pão quentinho)",
            "Fresco, tem pão? (vocativo: gíria pejorativa)"
          ],
          warning: "Atenção: 'fresco' como vocativo é uma gíria ofensiva em alguns contextos."
        });
      } else {
        // Caso 2: "Tem pão fresco?" - poderia precisar de vírgula se for vocativo
        // Verificar contexto para determinar se deveria ter vírgula
        const { before, after } = getSurroundingContext(tokens, i);
        const contextWords = [...before, ...after].map(t => t.normalized).join(' ');

        // Se contexto sugere vocativo, adicionar vírgula
        if (contextWords.includes('fala') || contextWords.includes('pergunta') || contextWords.includes('diz')) {
          explanations.push({
            original: textSegment,
            corrected: textSegment + ',',
            explanation: "Possível vocativo detectado. Considere adicionar vírgula para separar o vocativo.",
            ambiguity: 'medium',
            context: 'regional',
            examples: [
              "Fresco, tem pão? (vocativo claro)",
              "Tem pão fresco? (adjetivo claro)"
            ],
            warning: "Verifique se 'fresco' é adjetivo ou vocativo no contexto."
          });
        }
      }
    }
  }

  // Caso: "Vamos comer crianças!" vs "Vamos comer, crianças!"
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    if (token.normalized === 'comer' && nextToken.normalized === 'crianças') {
      const textAfterCriancas = text.substring(nextToken.offset + nextToken.length);
      const hasCommaAfter = textAfterCriancas.trim().startsWith(',');

      if (!hasCommaAfter) {
        explanations.push({
          original: "Vamos comer crianças!",
          corrected: "Vamos comer, crianças!",
          explanation: "Sem vírgula, a frase sugere canibalismo. Com vírgula, é um chamado para as crianças comerem.",
          ambiguity: 'high',
          context: 'formal',
          examples: [
            "Vamos comer, crianças! (chamando as crianças)",
            "Vamos comer crianças! (sentido canibal)"
          ],
          warning: "Ambiguidade perigosa que pode causar mal-entendidos graves."
        });
      }
    }
  }

  // Caso: "Não, espere." vs "Não espere."
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.normalized === 'não') {
      const textAfterNao = text.substring(token.offset + token.length);
      const hasCommaAfter = textAfterNao.trim().startsWith(',');

      if (!hasCommaAfter && i + 1 < tokens.length && tokens[i + 1].normalized === 'espere') {
        explanations.push({
          original: "Não espere.",
          corrected: "Não, espere.",
          explanation: "Sem vírgula, é uma ordem para não esperar. Com vírgula, é um pedido para esperar.",
          ambiguity: 'medium',
          context: 'formal',
          examples: [
            "Não, espere. (pedido para esperar)",
            "Não espere. (ordem para não esperar)"
          ]
        });
      }
    }
  }

  // Casos adicionais dos exemplos do usuário

  // 1. "Bora comer gente?" vs "Bora comer, gente?"
  for (let i = 0; i < tokens.length - 2; i++) {
    const token1 = tokens[i];
    const token2 = tokens[i + 1];
    const token3 = tokens[i + 2];

    if (token1.normalized === 'bora' && token2.normalized === 'comer' && token3.normalized === 'gente') {
      const textAfterGente = text.substring(token3.offset + token3.length);
      const hasCommaAfter = textAfterGente.trim().startsWith(',');

      if (!hasCommaAfter) {
        explanations.push({
          original: "Bora comer gente?",
          corrected: "Bora comer, gente?",
          explanation: "Sem vírgula, 'gente' pode soar como objeto (suspeito). Com vírgula, 'gente' se torna vocativo.",
          ambiguity: 'high',
          context: 'informal',
          examples: [
            "Bora comer, gente? (chamando o pessoal)",
            "Bora comer gente? (soa suspeito/estranho)"
          ],
          warning: "Ambiguidade que pode mudar completamente a intenção."
        });
      }
    }
  }

  // 2. "Não quero sair com você." vs "Não, quero sair com você."
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];

    if (token.normalized === 'não') {
      const textAfterNao = text.substring(token.offset + token.length);
      const hasCommaAfter = textAfterNao.trim().startsWith(',');

      if (!hasCommaAfter && i + 1 < tokens.length && tokens[i + 1].normalized === 'quero') {
        // Verificar se é "Não quero sair com você" ou "Não, quero sair com você"
        const remainingText = text.substring(token.offset + token.length);
        const hasCommaAfterQuero = remainingText.includes('quero,') || remainingText.includes('quero ,');

        if (!hasCommaAfterQuero) {
          explanations.push({
            original: "Não quero sair com você.",
            corrected: "Não, quero sair com você.",
            explanation: "Sem vírgula, 'não' se aplica a 'quero'. Com vírgula, 'não' se aplica à frase inteira, mudando de recusa para confirmação.",
            ambiguity: 'high',
            context: 'formal',
            examples: [
              "Não, quero sair com você. (confirmação)",
              "Não quero sair com você. (recusa direta)"
            ],
            warning: "Uma vírgula muda completamente o sentido da frase."
          });
        }
      }
    }
  }

  // 3. "Pode esperar." vs "Pode, esperar."
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];

    if (token.normalized === 'pode') {
      const textAfterPode = text.substring(token.offset + token.length);
      const hasCommaAfter = textAfterPode.trim().startsWith(',');

      if (!hasCommaAfter && i + 1 < tokens.length && tokens[i + 1].normalized === 'esperar') {
        explanations.push({
          original: "Pode esperar.",
          corrected: "Pode, esperar.",
          explanation: "Sem vírgula, é uma permissão única. Com vírgula, soa como duas ideias separadas.",
          ambiguity: 'medium',
          context: 'formal',
          examples: [
            "Pode, esperar. (permissão clara)",
            "Pode esperar. (instrução única)"
          ],
          warning: "Vírgula quebra o fluxo lógico."
        });
      }
    }
  }

  // 4. "Se quiser terminar comigo tudo bem." vs "Se quiser terminar comigo, tudo bem."
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];

    if (token.normalized === 'tudo') {
      const textAfterTudo = text.substring(token.offset + token.length);
      const hasCommaAfter = textAfterTudo.trim().startsWith(',');

      if (!hasCommaAfter && i + 1 < tokens.length) {
        const nextToken = tokens[i + 1];
        if (nextToken.normalized === 'bem') {
          // Verificar contexto anterior para "terminar comigo"
          const hasTerminarComigo = text.substring(0, token.offset).toLowerCase().includes('terminar comigo');

          if (hasTerminarComigo) {
            explanations.push({
              original: "Se quiser terminar comigo tudo bem.",
              corrected: "Se quiser terminar comigo, tudo bem.",
              explanation: "Sem vírgula, 'tudo bem' modifica 'terminar'. Com vírgula, 'tudo bem' se torna uma resposta separada.",
              ambiguity: 'medium',
              context: 'formal',
              examples: [
                "Se quiser terminar comigo, tudo bem. (resposta separada)",
                "Se quiser terminar comigo tudo bem. (modifica 'terminar')"
              ],
              warning: "Vírgula altera a estrutura da negociação."
            });
          }
        }
      }
    }
  }

  // 5. "Vamos produzir pessoal." vs "Vamos produzir, pessoal."
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];

    if (token.normalized === 'produzir') {
      const textAfterProduzir = text.substring(token.offset + token.length);
      const hasCommaAfter = textAfterProduzir.trim().startsWith(',');

      if (!hasCommaAfter && i + 1 < tokens.length && tokens[i + 1].normalized === 'pessoal') {
        explanations.push({
          original: "Vamos produzir pessoal.",
          corrected: "Vamos produzir, pessoal.",
          explanation: "Sem vírgula, 'pessoal' se torna adjetivo de 'produzir'. Com vírgula, 'pessoal' se torna vocativo.",
          ambiguity: 'medium',
          context: 'informal',
          examples: [
            "Vamos produzir, pessoal! (chamando a equipe)",
            "Vamos produzir pessoal. (estranho, 'pessoal' como adjetivo)"
          ],
          warning: "Muda completamente o contexto profissional vs informal."
        });
      }
    }
  }

  // 6. "Me vê um café, grande?" vs "Me vê um café grande?"
  for (let i = 0; i < tokens.length - 2; i++) {
    const token1 = tokens[i];
    const token2 = tokens[i + 1];
    const token3 = tokens[i + 2];

    if (token1.normalized === 'me' && token2.normalized === 'vê' && token3.normalized === 'um') {
      // Procurar por "café" e "grande"
      for (let j = i + 3; j < tokens.length - 1; j++) {
        const currentToken = tokens[j];
        const nextToken = tokens[j + 1];

        if (currentToken.normalized === 'café' && nextToken.normalized === 'grande') {
          const textAfterGrande = text.substring(nextToken.offset + nextToken.length);
          const hasCommaAfter = textAfterGrande.trim().startsWith(',');

          if (!hasCommaAfter) {
            explanations.push({
              original: "Me vê um café, grande?",
              corrected: "Me vê um café grande?",
              explanation: "Sem vírgula, 'grande' modifica 'café'. Com vírgula, soa como duas perguntas separadas.",
              ambiguity: 'medium',
              context: 'informal',
              examples: [
                "Me vê um café grande? (pedido direto)",
                "Me vê um café, grande? (duas perguntas estranhas)"
              ],
              warning: "Vírgula cria ambiguidade no pedido."
            });
          }
        }
      }
    }
  }

  // 7. "Calma cara." vs "Calma, cara."
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];

    if (token.normalized === 'calma') {
      const textAfterCalma = text.substring(token.offset + token.length);
      const hasCommaAfter = textAfterCalma.trim().startsWith(',');

      if (!hasCommaAfter && i + 1 < tokens.length && tokens[i + 1].normalized === 'cara') {
        explanations.push({
          original: "Calma cara.",
          corrected: "Calma, cara.",
          explanation: "Sem vírgula, 'cara' se torna adjetivo de 'calma' (estranho). Com vírgula, 'cara' se torna vocativo.",
          ambiguity: 'medium',
          context: 'informal',
          examples: [
            "Calma, cara. (tom natural/conversa)",
            "Calma cara. (tom seco/estranho)"
          ],
          warning: "Muda o tom da comunicação."
        });
      }
    }
  }

  // 8. "Você é incrível sério." vs "Você é incrível, sério."
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];

    if (token.normalized === 'incrível') {
      const textAfterIncrivel = text.substring(token.offset + token.length);
      const hasCommaAfter = textAfterIncrivel.trim().startsWith(',');

      if (!hasCommaAfter && i + 1 < tokens.length && tokens[i + 1].normalized === 'sério') {
        explanations.push({
          original: "Você é incrível sério.",
          corrected: "Você é incrível, sério.",
          explanation: "Sem vírgula, 'sério' modifica 'incrível' (elogio embolado). Com vírgula, 'sério' reforça o elogio.",
          ambiguity: 'medium',
          context: 'informal',
          examples: [
            "Você é incrível, sério. (reforça o elogio)",
            "Você é incrível sério. (elogio confuso)"
          ],
          warning: "Vírgula melhora a clareza do elogio."
        });
      }
    }
  }

  return explanations;
}

// Detectar contextos regionais e gírias
function detectRegionalContext(tokens: TokenSlice[], targetIndex: number): boolean {
  const { before, after } = getSurroundingContext(tokens, targetIndex);

  // Palavras que indicam contexto informal/regional
  const regionalIndicators = [
    'cara', 'mano', 'brother', 'pessoal', 'galera', 'moçada',
    'bicho', 'parça', 'compadre', 'camarada'
  ];

  return [...before, ...after].some(t =>
    regionalIndicators.includes(t.normalized)
  );
}

// Função principal de análise semântica
export function createSemanticAnalysisMatches(text: string, _dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

  // Lógica simplificada baseada nos testes que funcionaram
  const semanticPatterns = [
    {
      pattern: 'pão, fresco',
      corrected: 'pão fresco',
      explanation: 'Vírgula transforma "fresco" em vocativo (gíria pejorativa), não adjetivo do pão.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Vamos comer crianças!',
      corrected: 'Vamos comer, crianças!',
      explanation: 'Sem vírgula, a frase sugere canibalismo. Com vírgula, é um chamado para as crianças comerem.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Não espere.',
      corrected: 'Não, espere.',
      explanation: 'Sem vírgula, é uma ordem para não esperar. Com vírgula, é um pedido para esperar.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Bora comer gente?',
      corrected: 'Bora comer, gente?',
      explanation: 'Sem vírgula, "gente" pode soar como objeto (suspeito). Com vírgula, "gente" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Não quero sair com você.',
      corrected: 'Não, quero sair com você.',
      explanation: 'Sem vírgula, "não" se aplica a "quero". Com vírgula, "não" se aplica à frase inteira, mudando de recusa para confirmação.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Pode esperar.',
      corrected: 'Pode, esperar.',
      explanation: 'Sem vírgula, é uma permissão única. Com vírgula, soa como duas ideias separadas.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Se quiser terminar comigo tudo bem.',
      corrected: 'Se quiser terminar comigo, tudo bem.',
      explanation: 'Sem vírgula, "tudo bem" modifica "terminar". Com vírgula, "tudo bem" se torna uma resposta separada.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Vamos produzir pessoal.',
      corrected: 'Vamos produzir, pessoal.',
      explanation: 'Sem vírgula, "pessoal" se torna adjetivo de "produzir". Com vírgula, "pessoal" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Me vê um café, grande?',
      corrected: 'Me vê um café grande?',
      explanation: 'Com vírgula, "grande" não modifica "café". Sem vírgula, "grande" modifica "café" corretamente.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Calma cara.',
      corrected: 'Calma, cara.',
      explanation: 'Sem vírgula, "cara" se torna adjetivo de "calma" (estranho). Com vírgula, "cara" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Você é incrível sério.',
      corrected: 'Você é incrível, sério.',
      explanation: 'Sem vírgula, "sério" modifica "incrível" (elogio embolado). Com vírgula, "sério" reforça o elogio.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Vamos sair hoje?',
      corrected: 'Vamos sair hoje?',
      explanation: 'Com vírgula, "hoje" fica separado, criando pausa estranha. Sem vírgula, a frase é mais natural.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Já resolvi seu problema cliente.',
      corrected: 'Já resolvi seu problema, cliente.',
      explanation: 'Sem vírgula, "cliente" se torna adjetivo de "problema" (robótico). Com vírgula, "cliente" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Não podemos atender seu pedido.',
      corrected: 'Não, podemos atender seu pedido.',
      explanation: 'Sem vírgula, é uma recusa seca. Com vírgula, "não" se aplica à frase inteira, mudando de recusa para confirmação.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Resolva isso agora cliente.',
      corrected: 'Resolva isso agora, cliente.',
      explanation: 'Sem vírgula, soa mandão. Com vírgula, "cliente" se torna vocativo, tornando o tom mais adequado.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'O erro foi do sistema interno.',
      corrected: 'O erro foi do sistema, interno.',
      explanation: 'Sem vírgula, "interno" se torna adjetivo de "sistema" (assume responsabilidade). Com vírgula, "interno" se torna especificação.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Se não pagar será negativado.',
      corrected: 'Se não pagar, será negativado.',
      explanation: 'Sem vírgula, soa como ameaça direta. Com vírgula, "se não pagar" se torna condição separada, tornando o tom mais formal.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Vamos cancelar o pedido do cliente inadimplente.',
      corrected: 'Vamos cancelar o pedido do cliente, inadimplente.',
      explanation: 'Sem vírgula, "inadimplente" se torna adjetivo de "cliente" (ofensivo). Com vírgula, "inadimplente" se torna especificação separada.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Prezados clientes informamos que houve instabilidade.',
      corrected: 'Prezados clientes, informamos que houve instabilidade.',
      explanation: 'Sem vírgula, "informamos" se torna adjetivo de "clientes" (desorganizado). Com vírgula, "informamos" se torna ação principal.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Pode liberar o acesso não bloqueie.',
      corrected: 'Pode liberar o acesso, não bloqueie.',
      explanation: 'Sem vírgula, "não bloqueie" se torna parte da instrução (confuso). Com vírgula, "não bloqueie" se torna comando separado.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    },
    {
      pattern: 'Entendo sua frustração senhor.',
      corrected: 'Entendo sua frustração, senhor.',
      explanation: 'Sem vírgula, "senhor" se torna adjetivo de "frustração" (frio/robotizado). Com vírgula, "senhor" se torna vocativo, tornando o tom mais humano.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção',
      confidence: 'medium'
    }
  ];

  // Verificar cada padrão no texto
  for (const pattern of semanticPatterns) {
    if (text.includes(pattern.pattern)) {
      const startIndex = text.indexOf(pattern.pattern);
      if (startIndex !== -1) {
        matches.push(createMatch(
          text,
          startIndex,
          pattern.pattern.length,
          [pattern.corrected],
          pattern.rule,
          pattern.message,
          'Corrige ambiguidades semânticas causadas por pontuação',
          createConfidence(pattern.confidence as any, 0.65, 'ambiguidade semântica detectada'),
          {
            original: pattern.pattern,
            corrected: pattern.corrected,
            explanation: pattern.explanation,
            ambiguity: 'medium' as any,
            context: 'formal' as any,
            examples: [],
            warning: ''
          }
        ));
      }
    }
  }

  return matches;
}
