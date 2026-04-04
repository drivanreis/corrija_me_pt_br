import { buildContext } from "./text.js";
import type { RuleMatch } from "./types.js";

function createPunctuationMatch(
  text: string,
  offset: number,
  length: number,
  replacement: string,
  ruleId: string,
  message: string,
  description: string
): RuleMatch {
  return {
    message,
    shortMessage: message,
    offset,
    length,
    replacements: replacement ? [{ value: replacement }] : [],
    rule: {
      id: ruleId,
      description,
      issueType: "punctuation"
    },
    context: buildContext(text, offset, length)
  };
}

function addMatch(matches: RuleMatch[], candidate: RuleMatch): void {
  const start = candidate.offset;
  const end = candidate.offset + candidate.length;
  const overlaps = matches.some((existing) => start < existing.offset + existing.length && existing.offset < end);
  if (!overlaps) {
    matches.push(candidate);
  }
}

function createPrefixMatch(text: string, pattern: RegExp, replacementFactory: (...groups: string[]) => string, ruleId: string, message: string, description: string, matches: RuleMatch[]): void {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) {
    return;
  }

  const replacement = replacementFactory(...match.slice(1));
  addMatch(matches, createPunctuationMatch(text, match.index, match[0].length, replacement, ruleId, message, description));
}

function createMiddleMatch(text: string, pattern: RegExp, replacementFactory: (...groups: string[]) => string, ruleId: string, message: string, description: string, matches: RuleMatch[]): void {
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const replacement = replacementFactory(...match.slice(1));
    addMatch(matches, createPunctuationMatch(text, match.index, match[0].length, replacement, ruleId, message, description));
  }
}

function createTerminalMatch(text: string, pattern: RegExp, punctuation: string, ruleId: string, message: string, description: string, matches: RuleMatch[]): void {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) {
    return;
  }

  addMatch(matches, createPunctuationMatch(
    text,
    match.index,
    match[0].length,
    `${match[0]}${punctuation}`,
    ruleId,
    message,
    description
  ));
}

function createTerminalReplacementMatch(text: string, pattern: RegExp, replacement: string, ruleId: string, message: string, description: string, matches: RuleMatch[]): void {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) {
    return;
  }

  addMatch(matches, createPunctuationMatch(
    text,
    match.index,
    match[0].length,
    replacement,
    ruleId,
    message,
    description
  ));
}

export function createPunctuationHeuristicMatches(text: string): RuleMatch[] {
  const matches: RuleMatch[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return matches;
  }

  createPrefixMatch(
    text,
    /^((?:Oi|Olá|Ola)) ([A-ZÀ-Ý][\p{L}\p{M}]*)/u,
    (greeting, name) => `${greeting}, ${name},`,
    "PT_BR_PUNCTUATION_GREETING_NAME",
    "Saudação inicial costuma vir separada por vírgulas.",
    "Insere vírgulas em saudação seguida de chamamento.",
    matches
  );

  createPrefixMatch(
    text,
    /^((?:Oi|Olá|Ola|Por favor|Infelizmente|Atenciosamente|Senhoras e senhores))(?!,)\b/u,
    (marker) => `${marker},`,
    "PT_BR_PUNCTUATION_INITIAL_MARKER",
    "Expressão inicial costuma vir seguida de vírgula.",
    "Insere vírgula após marcador inicial frequente.",
    matches
  );

  createMiddleMatch(
    text,
    /(?<![,;])(?<!\bou)\s+(mas)\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction} `,
    "PT_BR_PUNCTUATION_MAS",
    "A conjunção adversativa costuma vir precedida por vírgula.",
    "Insere vírgula antes de 'mas'.",
    matches
  );

  createMiddleMatch(
    text,
    /(?<![,;])\s+((?:porém|porem))\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction} `,
    "PT_BR_PUNCTUATION_POREM",
    "A conjunção adversativa costuma vir isolada por pontuação.",
    "Insere vírgula antes de 'porém'.",
    matches
  );

  createMiddleMatch(
    text,
    /(?<![,;])\s+(portanto)\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction}, `,
    "PT_BR_PUNCTUATION_PORTANTO",
    "A conjunção conclusiva costuma vir isolada por vírgulas.",
    "Insere vírgulas em torno de 'portanto'.",
    matches
  );

  createMiddleMatch(
    text,
    /(?<![,;])\s+(contudo)\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction}, `,
    "PT_BR_PUNCTUATION_CONTUDO",
    "O advérbio intercalado costuma vir isolado por vírgulas.",
    "Insere vírgulas em torno de 'contudo'.",
    matches
  );

  createMiddleMatch(
    text,
    /(?<![,;])\s+(no entanto)\s+(?![,;])/giu,
    (expression) => `; ${expression}, `,
    "PT_BR_PUNCTUATION_NO_ENTANTO",
    "A locução conjuntiva costuma vir destacada por pontuação.",
    "Insere ponto e vírgula e vírgula em 'no entanto'.",
    matches
  );

  createMiddleMatch(
    text,
    /([.!?]\s*)(Então)(?!,)\b/gu,
    (prefix, term) => `${prefix}${term},`,
    "PT_BR_PUNCTUATION_ENTAO",
    "A retomada com 'Então' costuma vir seguida de vírgula.",
    "Insere vírgula após 'Então' em retomada de frase.",
    matches
  );

  const lower = trimmed.toLocaleLowerCase("pt-BR");
  const questionStarts = ["quem", "onde", "quando", "como", "qual", "quais", "por que", "o que", "você"];
  const exclamationStarts = ["que belo", "que dia lindo", "que belo dia"];
  const looksLikeQuestion = questionStarts.some((prefix) => lower.startsWith(prefix));
  const looksLikeExclamation = exclamationStarts.some((prefix) => lower.startsWith(prefix));

  if (!/[?!.]\s*$/u.test(trimmed)) {
    if (looksLikeQuestion) {
      createTerminalMatch(
        text,
        /([\p{L}\p{M}\d]+)\s*$/u,
        "?",
        "PT_BR_PUNCTUATION_FINAL_QUESTION",
        "A frase parece pedir ponto de interrogação.",
        "Adiciona ponto de interrogação ao final da frase.",
        matches
      );
    } else if (looksLikeExclamation) {
      createTerminalMatch(
        text,
        /([\p{L}\p{M}\d]+)\s*$/u,
        "!",
        "PT_BR_PUNCTUATION_FINAL_EXCLAMATION",
        "A frase parece pedir ponto de exclamação.",
        "Adiciona ponto de exclamação ao final da frase.",
        matches
      );
    }
  } else if (looksLikeQuestion && /\.\s*$/u.test(trimmed)) {
    createTerminalReplacementMatch(
      text,
      /\.\s*$/u,
      "?",
      "PT_BR_PUNCTUATION_FINAL_QUESTION",
      "A frase parece pedir ponto de interrogação.",
      "Substitui ponto final por ponto de interrogação ao final da frase.",
      matches
    );
  }

  return matches;
}
