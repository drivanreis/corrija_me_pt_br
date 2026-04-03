/* corrija_me_pt_br backend */
"use strict";

// src/backend/server.ts
var import_node_http = require("node:http");
var import_node_path3 = require("node:path");

// src/core/text.ts
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isWordLike(value) {
  return /[\p{L}\p{N}]/u.test(value);
}
function createWholeWordPattern(term) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
}
function createWordTokenPattern() {
  return /(?<![\p{L}\p{N}\p{M}])[\p{L}][\p{L}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;
}
function preserveReplacementCase(original, replacement) {
  if (!replacement) {
    return replacement;
  }
  if (original === original.toUpperCase() && /[\p{L}]/u.test(original)) {
    return replacement.toUpperCase();
  }
  if (original[0] && original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
function buildContext(text, offset, length) {
  const start = Math.max(0, offset - 25);
  const end = Math.min(text.length, offset + length + 25);
  return {
    text: text.slice(start, end),
    offset: offset - start,
    length
  };
}
function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
function normalizeDictionaryWord(value) {
  return value.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}
function stripDiacritics(value) {
  return value.normalize("NFD").replace(new RegExp("\\p{Diacritic}+", "gu"), "");
}

// src/core/context-rules.ts
function tokenizeText(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function createContextMatch(text, token, rule) {
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
function createContextRuleMatches(text, rules) {
  if (!rules.length) {
    return [];
  }
  const tokens = tokenizeText(text);
  const matches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    for (const rule of rules) {
      if (index + rule.pattern.length > tokens.length) {
        continue;
      }
      const matched = rule.pattern.every((expected, patternIndex) => tokens[index + patternIndex]?.normalized === normalizeDictionaryWord(expected));
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

// src/core/nominal-agreement.ts
function tokenizeText2(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function isDeterminer(entry) {
  return Boolean(
    entry && (entry.classes.includes("artigo") || entry.classes.includes("pronome")) && entry.numero
  );
}
function isNoun(entry) {
  return Boolean(entry?.classes.includes("substantivo"));
}
function isVariableAdjective(entry) {
  return Boolean(
    entry?.classes.includes("adjetivo") && (entry?.variavel || (entry?.forms?.length || 0) > 1)
  );
}
function isLinkingVerb(entry) {
  const lemma = normalizeDictionaryWord(entry?.lemma || "");
  return Boolean(entry?.classes.includes("verbo") && (lemma === "ser" || lemma === "estar"));
}
function isAttachmentVerb(entry) {
  const lemma = normalizeDictionaryWord(entry?.lemma || "");
  return Boolean(entry?.classes.includes("verbo") && lemma === "seguir");
}
function inferNumber(word) {
  return /s$/u.test(normalizeDictionaryWord(word)) ? "plural" : "singular";
}
function inferGender(word) {
  const normalized = normalizeDictionaryWord(word);
  if (/(a|ã|as|ãs)$/u.test(normalized)) {
    return "feminino";
  }
  if (/(o|os)$/u.test(normalized)) {
    return "masculino";
  }
  return null;
}
function matchFormByTraits(forms, targetGenero, targetNumero) {
  const normalizedForms = Array.from(new Set(forms.map((value) => normalizeDictionaryWord(value)).filter(Boolean)));
  const exact = normalizedForms.find((candidate) => inferNumber(candidate) === targetNumero && (!targetGenero || inferGender(candidate) === targetGenero || inferGender(candidate) === null));
  if (exact) {
    return exact;
  }
  const sameNumber = normalizedForms.find((candidate) => inferNumber(candidate) === targetNumero);
  return sameNumber || null;
}
function createNounPluralFromRules(base, dictionary) {
  const irregular = dictionary.linguisticData.irregularPlurals[base];
  if (irregular) {
    return irregular;
  }
  const rules = dictionary.linguisticData.nominalInflection?.plural || [];
  for (const rule of rules) {
    if (base.endsWith(rule.terminacao)) {
      return `${base.slice(0, -rule.terminacao.length)}${rule.resultado}`;
    }
  }
  return null;
}
function getExpectedNounForm(entry, targetGenero, targetNumero, dictionary) {
  if (!entry) {
    return null;
  }
  const forms = entry.forms?.length ? entry.forms : [entry.lemma || ""];
  const direct = matchFormByTraits(forms, targetGenero, targetNumero);
  if (direct) {
    return direct;
  }
  if (targetNumero === "plural" && entry.lemma) {
    return createNounPluralFromRules(normalizeDictionaryWord(entry.lemma), dictionary);
  }
  return normalizeDictionaryWord(entry.lemma || "") || null;
}
function getExpectedAdjectiveForm(entry, targetGenero, targetNumero) {
  if (!entry) {
    return null;
  }
  const forms = entry.forms?.length ? entry.forms : [entry.lemma || ""];
  return matchFormByTraits(forms, targetGenero, targetNumero);
}
function createAgreementMatch(text, token, replacement, description) {
  const replacements = dedupeStrings([preserveReplacementCase(token.value, replacement)]);
  return {
    message: "Possivel erro de concordancia nominal.",
    shortMessage: "Possivel erro de concordancia nominal.",
    offset: token.offset,
    length: token.length,
    replacements: replacements.map((value) => ({ value })),
    rule: {
      id: "PT_BR_SIMPLE_NOMINAL_AGREEMENT",
      description,
      issueType: "grammar"
    },
    context: buildContext(text, token.offset, token.length)
  };
}
function createDeterminerNounMatches(text, tokens, dictionary) {
  const matches = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const articleToken = tokens[index];
    const nounToken = tokens[index + 1];
    if (!articleToken || !nounToken) {
      continue;
    }
    const articleEntry = dictionary.linguisticData.lexicalEntries.get(articleToken.normalized);
    const nounEntry = dictionary.linguisticData.lexicalEntries.get(nounToken.normalized);
    if (!isDeterminer(articleEntry) || !isNoun(nounEntry)) {
      continue;
    }
    const targetGenero = articleEntry?.genero || nounEntry?.genero || null;
    const targetNumero = articleEntry?.numero || "singular";
    const expectedForm = getExpectedNounForm(nounEntry, targetGenero, targetNumero, dictionary);
    if (!expectedForm || expectedForm === nounToken.normalized) {
      continue;
    }
    matches.push(createAgreementMatch(
      text,
      nounToken,
      expectedForm,
      `O substantivo pode nao concordar com o determinante '${articleToken.value}'.`
    ));
  }
  return matches;
}
function createDeterminerNounAdjectiveMatches(text, tokens, dictionary) {
  const matches = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const determinerToken = tokens[index];
    const nounToken = tokens[index + 1];
    const adjectiveToken = tokens[index + 2];
    if (!determinerToken || !nounToken || !adjectiveToken) {
      continue;
    }
    const determinerEntry = dictionary.linguisticData.lexicalEntries.get(determinerToken.normalized);
    const nounEntry = dictionary.linguisticData.lexicalEntries.get(nounToken.normalized);
    const adjectiveEntry = dictionary.linguisticData.lexicalEntries.get(adjectiveToken.normalized);
    if (!isDeterminer(determinerEntry) || !isNoun(nounEntry) || !isVariableAdjective(adjectiveEntry)) {
      continue;
    }
    const targetGenero = determinerEntry?.genero || nounEntry?.genero || inferGender(nounToken.normalized);
    const targetNumero = determinerEntry?.numero || inferNumber(nounToken.normalized);
    const expectedNoun = getExpectedNounForm(nounEntry, targetGenero, targetNumero, dictionary);
    const reference = expectedNoun || nounToken.normalized;
    const expectedAdjective = getExpectedAdjectiveForm(adjectiveEntry, targetGenero, inferNumber(reference));
    if (!expectedAdjective || expectedAdjective === adjectiveToken.normalized) {
      continue;
    }
    matches.push(createAgreementMatch(
      text,
      adjectiveToken,
      expectedAdjective,
      `O adjetivo pode nao concordar com o grupo nominal iniciado por '${determinerToken.value}'.`
    ));
  }
  return matches;
}
function createNounAdjectiveMatches(text, tokens, dictionary) {
  const matches = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const nounToken = tokens[index];
    const adjectiveToken = tokens[index + 1];
    if (!nounToken || !adjectiveToken) {
      continue;
    }
    const nounEntry = dictionary.linguisticData.lexicalEntries.get(nounToken.normalized);
    const adjectiveEntry = dictionary.linguisticData.lexicalEntries.get(adjectiveToken.normalized);
    if (!isNoun(nounEntry) || !isVariableAdjective(adjectiveEntry)) {
      continue;
    }
    const targetGenero = nounEntry?.genero || inferGender(nounToken.normalized);
    const targetNumero = inferNumber(nounToken.normalized);
    const expectedForm = getExpectedAdjectiveForm(adjectiveEntry, targetGenero, targetNumero);
    if (!expectedForm || expectedForm === adjectiveToken.normalized) {
      continue;
    }
    matches.push(createAgreementMatch(
      text,
      adjectiveToken,
      expectedForm,
      `O adjetivo pode nao concordar com o substantivo '${nounToken.value}'.`
    ));
  }
  return matches;
}
function createNominalPredicateMatches(text, tokens, dictionary) {
  const matches = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const firstToken = tokens[index];
    const secondToken = tokens[index + 1];
    const thirdToken = tokens[index + 2];
    const fourthToken = tokens[index + 3];
    const firstEntry = dictionary.linguisticData.lexicalEntries.get(firstToken?.normalized || "");
    const secondEntry = dictionary.linguisticData.lexicalEntries.get(secondToken?.normalized || "");
    const thirdEntry = dictionary.linguisticData.lexicalEntries.get(thirdToken?.normalized || "");
    const fourthEntry = dictionary.linguisticData.lexicalEntries.get(fourthToken?.normalized || "");
    if (firstToken && secondToken && thirdToken && isDeterminer(firstEntry) && isNoun(secondEntry) && isLinkingVerb(thirdEntry) && isVariableAdjective(dictionary.linguisticData.lexicalEntries.get(thirdToken.normalized)) === false && isVariableAdjective(fourthEntry) && fourthToken) {
      const targetGenero = firstEntry?.genero || secondEntry?.genero || inferGender(secondToken.normalized);
      const targetNumero = firstEntry?.numero || inferNumber(secondToken.normalized);
      const expectedAdjective = getExpectedAdjectiveForm(fourthEntry, targetGenero, targetNumero);
      if (expectedAdjective && expectedAdjective !== fourthToken.normalized) {
        matches.push(createAgreementMatch(
          text,
          fourthToken,
          expectedAdjective,
          `O predicativo pode nao concordar com o grupo nominal '${firstToken.value} ${secondToken.value}'.`
        ));
      }
    }
    if (firstToken && secondToken && thirdToken && isNoun(firstEntry) && isLinkingVerb(secondEntry) && isVariableAdjective(thirdEntry)) {
      const targetGenero = firstEntry?.genero || inferGender(firstToken.normalized);
      const targetNumero = inferNumber(firstToken.normalized);
      const expectedAdjective = getExpectedAdjectiveForm(thirdEntry, targetGenero, targetNumero);
      if (expectedAdjective && expectedAdjective !== thirdToken.normalized) {
        matches.push(createAgreementMatch(
          text,
          thirdToken,
          expectedAdjective,
          `O predicativo pode nao concordar com o substantivo '${firstToken.value}'.`
        ));
      }
    }
  }
  return matches;
}
function createExpandedNominalPredicateMatches(text, tokens, dictionary) {
  const matches = [];
  for (let index = 0; index < tokens.length - 4; index += 1) {
    const determinerToken = tokens[index];
    const nounToken = tokens[index + 1];
    const nounQualifierToken = tokens[index + 2];
    const linkingVerbToken = tokens[index + 3];
    const adjectiveToken = tokens[index + 4];
    const determinerEntry = dictionary.linguisticData.lexicalEntries.get(determinerToken?.normalized || "");
    const nounEntry = dictionary.linguisticData.lexicalEntries.get(nounToken?.normalized || "");
    const nounQualifierEntry = dictionary.linguisticData.lexicalEntries.get(nounQualifierToken?.normalized || "");
    const linkingVerbEntry = dictionary.linguisticData.lexicalEntries.get(linkingVerbToken?.normalized || "");
    const adjectiveEntry = dictionary.linguisticData.lexicalEntries.get(adjectiveToken?.normalized || "");
    if (!determinerToken || !nounToken || !nounQualifierToken || !linkingVerbToken || !adjectiveToken || !isDeterminer(determinerEntry) || !isNoun(nounEntry) || !isVariableAdjective(nounQualifierEntry) || !isLinkingVerb(linkingVerbEntry) || !isVariableAdjective(adjectiveEntry)) {
      continue;
    }
    const targetGenero = determinerEntry?.genero || nounEntry?.genero || inferGender(nounToken.normalized);
    const targetNumero = determinerEntry?.numero || inferNumber(nounToken.normalized);
    const expectedAdjective = getExpectedAdjectiveForm(adjectiveEntry, targetGenero, targetNumero);
    if (!expectedAdjective || expectedAdjective === adjectiveToken.normalized) {
      continue;
    }
    matches.push(createAgreementMatch(
      text,
      adjectiveToken,
      expectedAdjective,
      `O predicativo pode nao concordar com o grupo nominal '${determinerToken.value} ${nounToken.value} ${nounQualifierToken.value}'.`
    ));
  }
  return matches;
}
function createAttachmentPredicateMatches(text, tokens, dictionary) {
  const matches = [];
  for (let index = 0; index < tokens.length - 3; index += 1) {
    const verbToken = tokens[index];
    const adjectiveToken = tokens[index + 1];
    const determinerToken = tokens[index + 2];
    const nounToken = tokens[index + 3];
    const verbEntry = dictionary.linguisticData.lexicalEntries.get(verbToken?.normalized || "");
    const adjectiveEntry = dictionary.linguisticData.lexicalEntries.get(adjectiveToken?.normalized || "");
    const determinerEntry = dictionary.linguisticData.lexicalEntries.get(determinerToken?.normalized || "");
    const nounEntry = dictionary.linguisticData.lexicalEntries.get(nounToken?.normalized || "");
    if (!verbToken || !adjectiveToken || !determinerToken || !nounToken || !isAttachmentVerb(verbEntry) || !isVariableAdjective(adjectiveEntry) || !isDeterminer(determinerEntry) || !isNoun(nounEntry)) {
      continue;
    }
    const targetGenero = determinerEntry?.genero || nounEntry?.genero || inferGender(nounToken.normalized);
    const targetNumero = determinerEntry?.numero || inferNumber(nounToken.normalized);
    const expectedAdjective = getExpectedAdjectiveForm(adjectiveEntry, targetGenero, targetNumero);
    if (!expectedAdjective || expectedAdjective === adjectiveToken.normalized) {
      continue;
    }
    matches.push(createAgreementMatch(
      text,
      adjectiveToken,
      expectedAdjective,
      `O predicativo pode nao concordar com o grupo nominal posterior '${determinerToken.value} ${nounToken.value}'.`
    ));
  }
  return matches;
}
function createSimpleNominalAgreementMatches(text, dictionary) {
  const tokens = tokenizeText2(text);
  return [
    ...createDeterminerNounMatches(text, tokens, dictionary),
    ...createDeterminerNounAdjectiveMatches(text, tokens, dictionary),
    ...createNounAdjectiveMatches(text, tokens, dictionary),
    ...createNominalPredicateMatches(text, tokens, dictionary),
    ...createExpandedNominalPredicateMatches(text, tokens, dictionary),
    ...createAttachmentPredicateMatches(text, tokens, dictionary)
  ];
}

// src/core/phrase-rules.ts
function tokenizeText3(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function createPhraseMatch(text, startToken, endToken, rule) {
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
function createPhraseRuleMatches(text, rules) {
  if (!rules.length) {
    return [];
  }
  const tokens = tokenizeText3(text);
  const matches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    for (const rule of rules) {
      if (index + rule.pattern.length > tokens.length) {
        continue;
      }
      const matched = rule.pattern.every((expected, patternIndex) => tokens[index + patternIndex]?.normalized === normalizeDictionaryWord(expected));
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

// src/core/punctuation-rules.ts
function createPunctuationMatch(text, offset, length, replacement, ruleId, message, description) {
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
function addMatch(matches, candidate) {
  const start = candidate.offset;
  const end = candidate.offset + candidate.length;
  const overlaps = matches.some((existing) => start < existing.offset + existing.length && existing.offset < end);
  if (!overlaps) {
    matches.push(candidate);
  }
}
function createPrefixMatch(text, pattern, replacementFactory, ruleId, message, description, matches) {
  const match = pattern.exec(text);
  if (!match || match.index === void 0) {
    return;
  }
  const replacement = replacementFactory(...match.slice(1));
  addMatch(matches, createPunctuationMatch(text, match.index, match[0].length, replacement, ruleId, message, description));
}
function createMiddleMatch(text, pattern, replacementFactory, ruleId, message, description, matches) {
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    const replacement = replacementFactory(...match.slice(1));
    addMatch(matches, createPunctuationMatch(text, match.index, match[0].length, replacement, ruleId, message, description));
  }
}
function createTerminalMatch(text, pattern, punctuation, ruleId, message, description, matches) {
  const match = pattern.exec(text);
  if (!match || match.index === void 0) {
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
function createPunctuationHeuristicMatches(text) {
  const matches = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return matches;
  }
  createPrefixMatch(
    text,
    /^((?:Oi|Olá|Ola)) ([A-ZÀ-Ý][\p{L}\p{M}]*)/u,
    (greeting, name) => `${greeting}, ${name},`,
    "PT_BR_PUNCTUATION_GREETING_NAME",
    "Sauda\xE7\xE3o inicial costuma vir separada por v\xEDrgulas.",
    "Insere v\xEDrgulas em sauda\xE7\xE3o seguida de chamamento.",
    matches
  );
  createPrefixMatch(
    text,
    /^((?:Oi|Olá|Ola|Por favor|Infelizmente|Atenciosamente|Senhoras e senhores))(?!,)\b/u,
    (marker) => `${marker},`,
    "PT_BR_PUNCTUATION_INITIAL_MARKER",
    "Express\xE3o inicial costuma vir seguida de v\xEDrgula.",
    "Insere v\xEDrgula ap\xF3s marcador inicial frequente.",
    matches
  );
  createMiddleMatch(
    text,
    /(?<![,;])(?<!\bou)\s+(mas)\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction} `,
    "PT_BR_PUNCTUATION_MAS",
    "A conjun\xE7\xE3o adversativa costuma vir precedida por v\xEDrgula.",
    "Insere v\xEDrgula antes de 'mas'.",
    matches
  );
  createMiddleMatch(
    text,
    /(?<![,;])\s+((?:porém|porem))\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction} `,
    "PT_BR_PUNCTUATION_POREM",
    "A conjun\xE7\xE3o adversativa costuma vir isolada por pontua\xE7\xE3o.",
    "Insere v\xEDrgula antes de 'por\xE9m'.",
    matches
  );
  createMiddleMatch(
    text,
    /(?<![,;])\s+(portanto)\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction}, `,
    "PT_BR_PUNCTUATION_PORTANTO",
    "A conjun\xE7\xE3o conclusiva costuma vir isolada por v\xEDrgulas.",
    "Insere v\xEDrgulas em torno de 'portanto'.",
    matches
  );
  createMiddleMatch(
    text,
    /(?<![,;])\s+(contudo)\s+(?![,;])/giu,
    (conjunction) => `, ${conjunction}, `,
    "PT_BR_PUNCTUATION_CONTUDO",
    "O adv\xE9rbio intercalado costuma vir isolado por v\xEDrgulas.",
    "Insere v\xEDrgulas em torno de 'contudo'.",
    matches
  );
  createMiddleMatch(
    text,
    /(?<![,;])\s+(no entanto)\s+(?![,;])/giu,
    (expression) => `; ${expression}, `,
    "PT_BR_PUNCTUATION_NO_ENTANTO",
    "A locu\xE7\xE3o conjuntiva costuma vir destacada por pontua\xE7\xE3o.",
    "Insere ponto e v\xEDrgula e v\xEDrgula em 'no entanto'.",
    matches
  );
  createMiddleMatch(
    text,
    /([.!?]\s*)(Então)(?!,)\b/gu,
    (prefix, term) => `${prefix}${term},`,
    "PT_BR_PUNCTUATION_ENTAO",
    "A retomada com 'Ent\xE3o' costuma vir seguida de v\xEDrgula.",
    "Insere v\xEDrgula ap\xF3s 'Ent\xE3o' em retomada de frase.",
    matches
  );
  if (!/[?!.]\s*$/u.test(trimmed)) {
    const lower = trimmed.toLocaleLowerCase("pt-BR");
    const questionStarts = ["quem", "onde", "quando", "como", "qual", "quais", "por que", "o que", "voc\xEA"];
    const exclamationStarts = ["que belo", "que dia lindo", "que belo dia"];
    if (questionStarts.some((prefix) => lower.startsWith(prefix))) {
      createTerminalMatch(
        text,
        /([\p{L}\p{M}\d]+)\s*$/u,
        "?",
        "PT_BR_PUNCTUATION_FINAL_QUESTION",
        "A frase parece pedir ponto de interroga\xE7\xE3o.",
        "Adiciona ponto de interroga\xE7\xE3o ao final da frase.",
        matches
      );
    } else if (exclamationStarts.some((prefix) => lower.startsWith(prefix))) {
      createTerminalMatch(
        text,
        /([\p{L}\p{M}\d]+)\s*$/u,
        "!",
        "PT_BR_PUNCTUATION_FINAL_EXCLAMATION",
        "A frase parece pedir ponto de exclama\xE7\xE3o.",
        "Adiciona ponto de exclama\xE7\xE3o ao final da frase.",
        matches
      );
    }
  }
  return matches;
}

// src/core/syntax-patterns.ts
function tokenizeText4(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function getRelevantSyntaxClasses(entry) {
  if (!entry) {
    return [];
  }
  const relevant = entry.classes.filter((value) => value === "pronome" || value === "verbo" || value === "substantivo" || value === "artigo" || value === "adjetivo" || value === "adverbio" || value === "preposicao");
  return Array.from(new Set(relevant));
}
function getPrimarySyntaxClass(entry) {
  const relevant = getRelevantSyntaxClasses(entry);
  return relevant.length === 1 ? relevant[0] : null;
}
function matchesPattern(sequence, pattern) {
  return sequence.length === pattern.pattern.length && sequence.every((value, index) => value === pattern.pattern[index]);
}
function hasLongerValidPattern(tokens, startIndex, patterns, dictionary, currentLength) {
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
    if (matchesPattern(sequence, pattern)) {
      return true;
    }
  }
  return false;
}
function hasExactPatternOfSameLength(sequence, patterns) {
  return patterns.some((pattern) => pattern.pattern.length === sequence.length && matchesPattern(sequence, pattern));
}
function createSyntaxMatch(text, startToken, endToken, sequence) {
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
function crossesSentenceBoundary(text, slice) {
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
function hasUnknownNeighboringSyntaxClass(tokens, startIndex, endIndex, dictionary) {
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
function createSimpleSyntaxPatternMatches(text, dictionary) {
  const patterns = dictionary.linguisticData.syntaxPatterns || [];
  if (!patterns.length) {
    return [];
  }
  const tokens = tokenizeText4(text);
  const matches = [];
  const seen = /* @__PURE__ */ new Set();
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
      const syntaxSequence = sequence;
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

// src/core/verbal-agreement.ts
function tokenizeText5(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function getAgreementIndex(pessoa, numero) {
  if (numero === "singular") {
    return pessoa >= 1 && pessoa <= 3 ? pessoa - 1 : null;
  }
  if (numero === "plural") {
    return pessoa >= 1 && pessoa <= 3 ? pessoa + 2 : null;
  }
  return null;
}
function createRegularExpectedForm(lemma, group, dictionary, pessoa, numero) {
  const rule = dictionary.linguisticData.verbConjugationRules[group];
  const endings = rule?.tempos?.presente;
  const agreementIndex = getAgreementIndex(pessoa, numero);
  if (!endings || agreementIndex === null || !endings[agreementIndex]) {
    return null;
  }
  const normalizedLemma = normalizeDictionaryWord(lemma);
  if (normalizedLemma.length < 2) {
    return null;
  }
  const radical = normalizedLemma.slice(0, -2);
  return `${radical}${endings[agreementIndex]}`;
}
function createIrregularExpectedForm(lemma, dictionary, pessoa, numero) {
  const paradigm = dictionary.linguisticData.irregularVerbs[normalizeDictionaryWord(lemma)];
  const agreementIndex = getAgreementIndex(pessoa, numero);
  const forms = paradigm?.presente;
  if (!forms || agreementIndex === null || !forms[agreementIndex]) {
    return null;
  }
  return forms[agreementIndex];
}
function getVerbExpectedForm(entry, dictionary, pessoa, numero) {
  if (!entry) {
    return null;
  }
  const lemma = entry.lemma || "";
  if (!lemma) {
    return null;
  }
  if (entry.irregular) {
    return createIrregularExpectedForm(lemma, dictionary, pessoa, numero);
  }
  if (!entry.grupo) {
    return null;
  }
  return createRegularExpectedForm(lemma, entry.grupo, dictionary, pessoa, numero);
}
function getPresentTenseForms(entry, dictionary) {
  if (!entry?.lemma) {
    return [];
  }
  const normalizedLemma = normalizeDictionaryWord(entry.lemma);
  if (entry.irregular) {
    return (dictionary.linguisticData.irregularVerbs[normalizedLemma]?.presente || []).map((value) => normalizeDictionaryWord(value));
  }
  if (!entry.grupo) {
    return [];
  }
  const forms = [];
  for (let pessoa = 1; pessoa <= 3; pessoa += 1) {
    const singular = createRegularExpectedForm(normalizedLemma, entry.grupo, dictionary, pessoa, "singular");
    const plural = createRegularExpectedForm(normalizedLemma, entry.grupo, dictionary, pessoa, "plural");
    if (singular) {
      forms.push(normalizeDictionaryWord(singular));
    }
    if (plural) {
      forms.push(normalizeDictionaryWord(plural));
    }
  }
  return forms;
}
function isLikelyPresentTenseForm(token, entry, dictionary) {
  return getPresentTenseForms(entry, dictionary).includes(token.normalized);
}
function createAgreementMatch2(text, token, replacement, subject) {
  const replacements = dedupeStrings([preserveReplacementCase(token.value, replacement)]);
  return {
    message: "Possivel erro de concordancia verbal.",
    shortMessage: "Possivel erro de concordancia verbal.",
    offset: token.offset,
    length: token.length,
    replacements: replacements.map((value) => ({ value })),
    rule: {
      id: "PT_BR_SIMPLE_VERBAL_AGREEMENT",
      description: `A forma verbal pode nao concordar com o sujeito '${subject}'.`,
      issueType: "grammar"
    },
    context: buildContext(text, token.offset, token.length)
  };
}
function isSimpleVerbCandidate(token, entry) {
  return Boolean(
    entry && entry.classes.includes("verbo") && !token.normalized.includes("-")
  );
}
function isPreposition(token, dictionary) {
  if (!token) {
    return false;
  }
  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
  return Boolean(lexicalEntry?.classes.includes("preposicao"));
}
function isAdverb(token, dictionary) {
  if (!token) {
    return false;
  }
  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
  return Boolean(lexicalEntry?.classes.includes("adverbio"));
}
function isCliticPronoun(token, dictionary) {
  if (!token) {
    return false;
  }
  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
  return Boolean(
    lexicalEntry && lexicalEntry.classes.includes("pronome") && lexicalEntry.tags?.includes("clitico")
  );
}
function shouldSkipInfinitiveLikeContext(tokens, subjectIndex, verbToken, verbEntry, dictionary) {
  if (!verbEntry) {
    return true;
  }
  const lemma = normalizeDictionaryWord(verbEntry.lemma || "");
  if (lemma && verbToken.normalized === lemma) {
    return true;
  }
  const previousToken = tokens[subjectIndex - 1];
  if (isPreposition(previousToken, dictionary)) {
    return true;
  }
  return false;
}
function resolveVerbIndex(tokens, subject, dictionary) {
  let index = subject.nextVerbIndex;
  let skippedAdverb = false;
  let skippedClitic = false;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      return null;
    }
    if (!skippedClitic && isCliticPronoun(token, dictionary)) {
      skippedClitic = true;
      index += 1;
      continue;
    }
    if (!skippedAdverb && isAdverb(token, dictionary)) {
      skippedAdverb = true;
      index += 1;
      continue;
    }
    return index;
  }
  return null;
}
function resolveSubjectCandidate(tokens, index, dictionary) {
  const first = tokens[index];
  const second = tokens[index + 1];
  if (!first) {
    return null;
  }
  if (second) {
    const joined = `${first.normalized} ${second.normalized}`;
    if (dictionary.linguisticData.verbalAgreement[joined]) {
      return {
        text: `${first.value} ${second.value}`,
        normalized: joined,
        nextVerbIndex: index + 2
      };
    }
  }
  if (dictionary.linguisticData.verbalAgreement[first.normalized]) {
    return {
      text: first.value,
      normalized: first.normalized,
      nextVerbIndex: index + 1
    };
  }
  return null;
}
function createSimpleVerbalAgreementMatches(text, dictionary) {
  const tokens = tokenizeText5(text);
  const matches = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const subject = resolveSubjectCandidate(tokens, index, dictionary);
    if (!subject) {
      continue;
    }
    const verbIndex = resolveVerbIndex(tokens, subject, dictionary);
    if (verbIndex === null) {
      continue;
    }
    const verbToken = tokens[verbIndex];
    if (!verbToken) {
      continue;
    }
    const agreement = dictionary.linguisticData.verbalAgreement[subject.normalized];
    if (!agreement) {
      continue;
    }
    const verbEntry = dictionary.linguisticData.lexicalEntries.get(verbToken.normalized);
    if (!isSimpleVerbCandidate(verbToken, verbEntry)) {
      continue;
    }
    if (!isLikelyPresentTenseForm(verbToken, verbEntry, dictionary)) {
      continue;
    }
    if (shouldSkipInfinitiveLikeContext(tokens, index, verbToken, verbEntry, dictionary)) {
      continue;
    }
    const expectedForm = getVerbExpectedForm(verbEntry, dictionary, agreement.pessoa, agreement.numero);
    if (!expectedForm || normalizeDictionaryWord(expectedForm) === verbToken.normalized) {
      continue;
    }
    const expectedEntry = dictionary.linguisticData.lexicalEntries.get(normalizeDictionaryWord(expectedForm));
    if (!expectedEntry || !expectedEntry.classes.includes("verbo")) {
      continue;
    }
    matches.push(createAgreementMatch2(text, verbToken, expectedForm, subject.text));
  }
  return matches;
}

// src/core/engine.ts
function createConfidence(level, score, reason) {
  return {
    level,
    score: Number(score.toFixed(2)),
    reason
  };
}
function createMatch(text, offset, length, replacements, ruleId, message, description, confidence = createConfidence("high", 0.95, "regra explicita")) {
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
      issueType: "misspelling"
    },
    context: buildContext(text, offset, length)
  };
}
function addIfNoOverlap(matches, candidate) {
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
function getTechnicalSpans(text) {
  const pattern = /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}_-]+\.)+(?:json|md|txt|js|ts|tsx|jsx|html|css|yaml|yml|xml|csv)(?![\p{L}\p{N}])/giu;
  const spans = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    spans.push({
      offset: match.index,
      length: match[0].length
    });
  }
  return spans;
}
function overlapsTechnicalSpan(offset, length, spans) {
  return spans.some((span) => offset < span.offset + span.length && span.offset < offset + length);
}
function createReplacementMatches(text, entries) {
  const matches = [];
  for (const entry of entries) {
    const pattern = isWordLike(entry.from) ? createWholeWordPattern(entry.from) : new RegExp(entry.from, "giu");
    const textMatches = text.matchAll(pattern);
    for (const match of textMatches) {
      if (match.index === void 0) {
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
function createDictionaryMistakeMatches(text, dictionary) {
  if (!dictionary.commonMistakes.length) {
    return [];
  }
  return createReplacementMatches(text, dictionary.commonMistakes);
}
function isIgnorableToken(word) {
  return word.length < 3 || /\d/u.test(word) || /^[A-Z0-9_-]+$/u.test(word) || /[_@/\\.-]/u.test(word);
}
function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }
  return previous[right.length];
}
function countDiacriticMarks(value) {
  return (value.normalize("NFD").match(new RegExp("\\p{Diacritic}", "gu")) || []).length;
}
function hasSafePrefixAndSuffixMatch(word, candidate) {
  const minPrefix = word.length >= 6 && candidate.length >= 6 ? 2 : 1;
  const prefixMatches = word.slice(0, minPrefix) === candidate.slice(0, minPrefix);
  const suffixMatches = word.at(-1) === candidate.at(-1);
  return prefixMatches && suffixMatches;
}
function createUnknownWordSuggestions(word, dictionary) {
  const normalizedWord = normalizeDictionaryWord(word);
  const plainWord = stripDiacritics(normalizedWord);
  const originalDiacritics = countDiacriticMarks(normalizedWord);
  const candidates = [];
  for (const candidate of dictionary.words) {
    const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(candidate);
    if (lexicalEntry?.autoCorrect === "blocked" || lexicalEntry?.autoCorrect === "review") {
      continue;
    }
    if (dictionary.linguisticData.blockedAutoCorrections.has(candidate)) {
      continue;
    }
    if (Math.abs(candidate.length - normalizedWord.length) > 2) {
      continue;
    }
    const plainCandidate = stripDiacritics(candidate);
    if (plainCandidate[0] !== plainWord[0]) {
      continue;
    }
    const distance = levenshteinDistance(plainWord, plainCandidate);
    const normalizedDistance = levenshteinDistance(normalizedWord, candidate);
    const candidateDiacritics = countDiacriticMarks(candidate);
    const samePlainWord = plainCandidate === plainWord;
    if (samePlainWord) {
      if (originalDiacritics > candidateDiacritics) {
        continue;
      }
      if (normalizedDistance > 2) {
        continue;
      }
    } else {
      if (distance > 1) {
        continue;
      }
      if (!hasSafePrefixAndSuffixMatch(normalizedWord, candidate)) {
        continue;
      }
    }
    if (distance > 2) {
      continue;
    }
    let confidenceScore = samePlainWord ? 0.96 : 0.82;
    confidenceScore -= distance * 0.18;
    confidenceScore -= normalizedDistance * 0.08;
    if (lexicalEntry?.classes.length && lexicalEntry.classes.length > 1) {
      confidenceScore -= 0.18;
    }
    if (lexicalEntry?.irregular) {
      confidenceScore -= 0.06;
    }
    if (lexicalEntry?.tags?.some((tag) => ["tecnico", "produto", "marca", "plataforma", "interno", "ia", "desenvolvimento"].includes(tag))) {
      confidenceScore -= 0.14;
    }
    if (!samePlainWord && normalizedWord.length <= 4) {
      confidenceScore -= 0.08;
    }
    if (distance === 1 && normalizedDistance > 1) {
      confidenceScore -= 0.05;
    }
    if (confidenceScore < 0.45) {
      continue;
    }
    candidates.push({
      word: candidate,
      score: samePlainWord ? normalizedDistance : distance + normalizedDistance,
      confidence: createConfidence(
        confidenceScore >= 0.85 ? "high" : confidenceScore >= 0.68 ? "medium" : "low",
        Math.max(0.01, Math.min(confidenceScore, 0.99)),
        samePlainWord ? "forma conhecida com diferenca principalmente de acentuacao" : "aproximacao ortografica com filtros conservadores"
      )
    });
  }
  return candidates.sort((left, right) => right.confidence.score - left.confidence.score || left.score - right.score || left.word.localeCompare(right.word, "pt-BR")).slice(0, 5).map((entry) => ({
    ...entry,
    word: preserveReplacementCase(word, entry.word)
  }));
}
function createUnknownWordMatches(text, dictionary) {
  if (!dictionary.dictionaryReady || !dictionary.words.size) {
    return [];
  }
  const matches = [];
  const seenOffsets = /* @__PURE__ */ new Set();
  const pattern = createWordTokenPattern();
  const technicalSpans = getTechnicalSpans(text);
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    const original = match[0];
    const normalized = normalizeDictionaryWord(original);
    if (!normalized || isIgnorableToken(original) || dictionary.words.has(normalized) || dictionary.linguisticData.allowedUnknownWords.has(normalized) || dictionary.linguisticData.blockedAutoCorrections.has(normalized) || overlapsTechnicalSpan(match.index, original.length, technicalSpans)) {
      continue;
    }
    const key = `${match.index}:${original.length}`;
    if (seenOffsets.has(key)) {
      continue;
    }
    const replacements = createUnknownWordSuggestions(original, dictionary);
    if (!replacements.length) {
      continue;
    }
    const [bestSuggestion, secondSuggestion] = replacements;
    const hasStrongBestSuggestion = bestSuggestion.confidence.score >= 0.78;
    const hasClearLead = !secondSuggestion || bestSuggestion.confidence.score - secondSuggestion.confidence.score >= 0.12;
    if (!hasStrongBestSuggestion || !hasClearLead) {
      continue;
    }
    seenOffsets.add(key);
    addIfNoOverlap(matches, createMatch(
      text,
      match.index,
      original.length,
      replacements.map((entry) => entry.word),
      "PT_BR_UNKNOWN_WORD",
      "Palavra possivelmente incorreta para pt-BR.",
      "Sugestao baseada no dicionario local.",
      bestSuggestion.confidence
    ));
  }
  return matches;
}
function createRepeatedWordMatches(text) {
  const pattern = /(?<![\p{L}\p{N}\p{M}])([\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*)\s+(\1)(?![\p{L}\p{N}\p{M}])/giu;
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function createDoubleSpaceMatches(text) {
  const matches = [];
  const pattern = / {2,}/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function tokenizeSlices(text) {
  const tokens = [];
  const pattern = createWordTokenPattern();
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function createStructuredMatch(text, offset, length, replacement, ruleId, message, description, issueType, confidence) {
  return {
    message,
    shortMessage: message,
    offset,
    length,
    replacements: [{ value: replacement }],
    confidence,
    rule: {
      id: ruleId,
      description,
      issueType
    },
    context: buildContext(text, offset, length)
  };
}
function createCraseHeuristicMatches(text) {
  const matches = [];
  for (const match of text.matchAll(/\b([Oo]nde\s+você\s+estava|[Ee]le\s+passou\s+mal\s+ontem|[Oo]ntem|[Hh]oje)\s+a\s+noite\b/gu)) {
    if (match.index === void 0) {
      continue;
    }
    const whole = match[0];
    const replacement = whole.replace(/\sa\s+noite$/u, " \xE0 noite");
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      match.index,
      whole.length,
      replacement,
      "PT_BR_CRASE_TEMPORAL_LOCUTION",
      "Use crase na locu\xE7\xE3o temporal '\xE0 noite'.",
      "Corrige aus\xEAncia de crase em locu\xE7\xE3o temporal recorrente.",
      "grammar",
      createConfidence("high", 0.9, "locucao temporal recorrente")
    ));
  }
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}])(á)(?=\s+\d+\s+(?:minuto|minutos|hora|horas)\b)/gu)) {
    if (match.index === void 0) {
      continue;
    }
    const accentOffset = match.index + match[1].length;
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      accentOffset,
      match[2].length,
      preserveReplacementCase(match[2], "a"),
      "PT_BR_CRASE_DISTANCE",
      "N\xE3o use acento nessa indica\xE7\xE3o de dist\xE2ncia ou tempo.",
      "Corrige uso indevido de acento em 'a 5 minutos', 'a 2 horas' e constru\xE7\xF5es semelhantes.",
      "grammar",
      createConfidence("high", 0.92, "indicacao de distancia ou tempo")
    ));
  }
  return matches;
}
function createLocalizationDateMatches(text) {
  const matches = [];
  const pattern = /\b(0?[1-9]|1[0-2])\/(1[3-9]|2[0-9]|3[0-1])\/(\d{4})\b/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    const [, month, day, year] = match;
    const replacement = `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      match.index,
      match[0].length,
      replacement,
      "PT_BR_LOCALIZATION_DATE",
      "Formato de data possivelmente fora do padr\xE3o pt-BR.",
      "Converte data claramente no padr\xE3o mes/dia/ano para dia/mes/ano.",
      "style",
      createConfidence("high", 0.91, "data em formato US claramente identificavel")
    ));
  }
  return matches;
}
function isPluralAnnouncementLead(tokens, index) {
  const next = tokens[index + 1];
  const nextNext = tokens[index + 2];
  const pluralIndicators = /* @__PURE__ */ new Set([
    "dois",
    "duas",
    "tres",
    "tr\xEAs",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
    "dez",
    "alguns",
    "algumas",
    "muitos",
    "muitas",
    "v\xE1rios",
    "varios",
    "v\xE1rias",
    "varias"
  ]);
  if (!next) {
    return false;
  }
  if (pluralIndicators.has(next.normalized)) {
    return true;
  }
  if (/s$/u.test(next.normalized) && next.normalized.length > 3) {
    return true;
  }
  if (nextNext && /s$/u.test(nextNext.normalized) && nextNext.normalized.length > 3) {
    return true;
  }
  return false;
}
function createAnnouncementAgreementMatches(text) {
  const tokens = tokenizeSlices(text);
  const matches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.normalized === "vende-se" && isPluralAnnouncementLead(tokens, index)) {
      addIfNoOverlap(matches, createStructuredMatch(
        text,
        token.offset,
        token.length,
        preserveReplacementCase(token.value, "vendem-se"),
        "PT_BR_ANNOUNCEMENT_VENDEM_SE",
        "Com sujeito plural, o verbo deve concordar.",
        "Corrige concord\xE2ncia verbal frequente em an\xFAncios com 'vende-se'.",
        "grammar",
        createConfidence("high", 0.87, "padrao recorrente de anuncio com sujeito plural")
      ));
    }
    if (token.normalized === "aluga-se" && isPluralAnnouncementLead(tokens, index)) {
      addIfNoOverlap(matches, createStructuredMatch(
        text,
        token.offset,
        token.length,
        preserveReplacementCase(token.value, "alugam-se"),
        "PT_BR_ANNOUNCEMENT_ALUGAM_SE",
        "Com sujeito plural, o verbo deve concordar.",
        "Corrige concord\xE2ncia verbal frequente em an\xFAncios com 'aluga-se'.",
        "grammar",
        createConfidence("high", 0.87, "padrao recorrente de anuncio com sujeito plural")
      ));
    }
  }
  return matches;
}
function createSpaceBeforePunctuationMatches(text) {
  const matches = [];
  const pattern = / ([,.;:!?])/g;
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
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
function createSentenceCaseMatches(text) {
  const matches = [];
  const pattern = /(^|[.!?]\s+)([a-zà-ÿ])/gmu;
  const technicalSpans = getTechnicalSpans(text);
  for (const match of text.matchAll(pattern)) {
    if (match.index === void 0) {
      continue;
    }
    const prefix = match[1];
    const lowerChar = match[2];
    const offset = match.index + prefix.length;
    if (overlapsTechnicalSpan(offset, lowerChar.length, technicalSpans)) {
      continue;
    }
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
function clampConfidenceScore(score) {
  return Math.max(0.01, Math.min(score, 0.99));
}
function lexicalRiskPenalty(replacement, dictionary) {
  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(normalizeDictionaryWord(replacement));
  if (!lexicalEntry) {
    return 0;
  }
  let penalty = 0;
  if (lexicalEntry.autoCorrect === "review") {
    penalty += 0.14;
  }
  if ((lexicalEntry.classes?.length || 0) > 1) {
    penalty += 0.12;
  }
  if (lexicalEntry.irregular) {
    penalty += 0.05;
  }
  if (lexicalEntry.tags?.some((tag) => ["tecnico", "produto", "marca", "plataforma", "interno", "ia", "desenvolvimento"].includes(tag))) {
    penalty += 0.12;
  }
  return penalty;
}
function deriveMatchConfidence(match, text, dictionary) {
  if (match.confidence) {
    return match.confidence;
  }
  const original = text.slice(match.offset, match.offset + match.length);
  const primaryReplacement = match.replacements[0]?.value || "";
  const replacementPenalty = lexicalRiskPenalty(primaryReplacement, dictionary);
  const hasMultipleSuggestions = match.replacements.length > 1;
  if (match.rule.id === "PT_BR_REPEATED_WORD") {
    return createConfidence("high", 0.98, "repeticao literal detectada");
  }
  if (match.rule.id === "PT_BR_DOUBLE_SPACE") {
    return createConfidence("high", 0.99, "padrao mecanico de espaco duplicado");
  }
  if (match.rule.id === "PT_BR_SPACE_BEFORE_PUNCTUATION") {
    return createConfidence("high", 0.98, "padrao mecanico de pontuacao");
  }
  if (match.rule.id === "PT_BR_SENTENCE_CASE") {
    return createConfidence("high", 0.94, "regra ortografica simples de inicio de frase");
  }
  if (match.rule.id.startsWith("PT_BR_PUNCTUATION_")) {
    let score = 0.88;
    if (match.rule.id.includes("FINAL_")) {
      score = 0.7;
    }
    if (match.rule.id.includes("GREETING_NAME") || match.rule.id.includes("INITIAL_MARKER")) {
      score = 0.9;
    }
    return createConfidence(score >= 0.85 ? "high" : "medium", clampConfidenceScore(score), "heuristica de pontuacao recorrente");
  }
  if (match.rule.id === "PT_BR_SIMPLE_SYNTAX_PATTERN") {
    return createConfidence("low", 0.42, "padrao sintatico heuristico e sensivel a contexto");
  }
  if (match.rule.id === "PT_BR_SIMPLE_VERBAL_AGREEMENT") {
    let score = 0.78;
    if (match.length <= 3) {
      score -= 0.08;
    }
    return createConfidence(score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "concordancia verbal por heuristica local");
  }
  if (match.rule.id === "PT_BR_SIMPLE_NOMINAL_AGREEMENT") {
    let score = 0.74;
    if (match.length <= 3) {
      score -= 0.08;
    }
    return createConfidence(score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "concordancia nominal por heuristica local");
  }
  if (match.rule.id.startsWith("PT_BR_CONTEXT_") || match.rule.id.includes("CONTEXT")) {
    let score = 0.88;
    if (hasMultipleSuggestions) {
      score -= 0.08;
    }
    return createConfidence(score >= 0.85 ? "high" : "medium", clampConfidenceScore(score), "regra contextual explicita");
  }
  if (match.rule.id.startsWith("PT_BR_PHRASE_")) {
    let score = 0.93;
    if (hasMultipleSuggestions) {
      score -= 0.04;
    }
    if (match.length <= 4) {
      score -= 0.06;
    }
    return createConfidence(score >= 0.85 ? "high" : "medium", clampConfidenceScore(score), "regra frasal explicita");
  }
  if (match.rule.issueType === "style") {
    let score = 0.76;
    if (hasMultipleSuggestions) {
      score -= 0.06;
    }
    if (match.length >= 12) {
      score -= 0.04;
    }
    return createConfidence(score >= 0.85 ? "high" : score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "ajuste de frase ou estilo");
  }
  if (match.rule.id === "PT_BR_SIMPLE_REPLACE") {
    let score = 0.9;
    if (hasMultipleSuggestions) {
      score -= 0.1;
    }
    if (original.length <= 3) {
      score -= 0.12;
    }
    if (Math.abs(primaryReplacement.length - original.length) >= 3) {
      score -= 0.08;
    }
    score -= replacementPenalty;
    return createConfidence(score >= 0.85 ? "high" : score >= 0.68 ? "medium" : "low", clampConfidenceScore(score), "substituicao lexical direta");
  }
  if (match.rule.issueType === "grammar") {
    return createConfidence("medium", 0.72, "heuristica gramatical");
  }
  return createConfidence("high", 0.9, "confianca padrao");
}
function shouldExposeMatch(match) {
  if (match.replacements.length) {
    return true;
  }
  if (match.confidence?.level === "low") {
    return false;
  }
  return true;
}
function collapseOverlappingMatches(matches) {
  const selected = [];
  const ranked = [...matches].sort((left, right) => (right.confidence?.score || 0) - (left.confidence?.score || 0) || right.length - left.length || left.offset - right.offset);
  for (const candidate of ranked) {
    const start = candidate.offset;
    const end = candidate.offset + candidate.length;
    const overlaps = selected.some((existing) => start < existing.offset + existing.length && existing.offset < end);
    if (!overlaps) {
      selected.push(candidate);
    }
  }
  return selected.sort((left, right) => left.offset - right.offset || left.length - right.length);
}
function checkText(text, replacements, dictionary) {
  const replacementMatches = createReplacementMatches(text, replacements);
  const dictionaryMistakeMatches = createDictionaryMistakeMatches(text, dictionary);
  const phraseRuleMatches = createPhraseRuleMatches(text, dictionary.phraseRules);
  const contextRuleMatches = createContextRuleMatches(text, dictionary.contextRules);
  const craseHeuristicMatches = createCraseHeuristicMatches(text);
  const localizationDateMatches = createLocalizationDateMatches(text);
  const announcementAgreementMatches = createAnnouncementAgreementMatches(text);
  const verbalAgreementMatches = createSimpleVerbalAgreementMatches(text, dictionary);
  const nominalAgreementMatches = createSimpleNominalAgreementMatches(text, dictionary);
  const syntaxPatternMatches = createSimpleSyntaxPatternMatches(text, dictionary);
  const baseProtectedMatches = [
    ...replacementMatches,
    ...dictionaryMistakeMatches,
    ...phraseRuleMatches,
    ...contextRuleMatches,
    ...craseHeuristicMatches,
    ...localizationDateMatches,
    ...announcementAgreementMatches,
    ...verbalAgreementMatches,
    ...nominalAgreementMatches,
    ...syntaxPatternMatches
  ];
  const punctuationHeuristicMatches = createPunctuationHeuristicMatches(text).filter((candidate) => !baseProtectedMatches.some((existing) => candidate.offset < existing.offset + existing.length && existing.offset < candidate.offset + candidate.length));
  const protectedMatches = [...baseProtectedMatches, ...punctuationHeuristicMatches];
  const unknownWordMatches = createUnknownWordMatches(text, dictionary).filter((candidate) => !protectedMatches.some((existing) => candidate.offset < existing.offset + existing.length && existing.offset < candidate.offset + candidate.length));
  const allMatches = [
    ...replacementMatches,
    ...dictionaryMistakeMatches,
    ...phraseRuleMatches,
    ...contextRuleMatches,
    ...craseHeuristicMatches,
    ...localizationDateMatches,
    ...announcementAgreementMatches,
    ...verbalAgreementMatches,
    ...nominalAgreementMatches,
    ...syntaxPatternMatches,
    ...punctuationHeuristicMatches,
    ...unknownWordMatches,
    ...createRepeatedWordMatches(text),
    ...createDoubleSpaceMatches(text),
    ...createSpaceBeforePunctuationMatches(text),
    ...createSentenceCaseMatches(text)
  ].map((match) => ({
    ...match,
    confidence: deriveMatchConfidence(match, text, dictionary)
  })).filter((match) => shouldExposeMatch(match));
  const visibleMatches = collapseOverlappingMatches(allMatches);
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
    matches: visibleMatches
  };
}

// src/backend/dictionary.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// src/backend/linguistic-data.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function readJsonFile(pathname, fallback) {
  if (!(0, import_node_fs.existsSync)(pathname)) {
    return fallback;
  }
  return JSON.parse((0, import_node_fs.readFileSync)(pathname, "utf8"));
}
function normalizeKey(value) {
  return normalizeDictionaryWord(value);
}
function addLexicalEntries(target, source) {
  for (const [rawLemma, rawEntry] of Object.entries(source)) {
    const lemma = normalizeKey(rawLemma);
    if (!lemma) {
      continue;
    }
    const existing = target.get(lemma);
    const nextClasses = Array.isArray(rawEntry.classes) ? rawEntry.classes.filter(Boolean) : [];
    const merged = {
      lemma,
      classes: existing ? Array.from(/* @__PURE__ */ new Set([...existing.classes, ...nextClasses])) : nextClasses,
      genero: rawEntry.genero ?? existing?.genero ?? null,
      numero: rawEntry.numero ?? existing?.numero ?? null,
      pessoa: rawEntry.pessoa ?? existing?.pessoa ?? null,
      grupo: rawEntry.grupo ?? existing?.grupo ?? null,
      irregular: rawEntry.irregular ?? existing?.irregular ?? false,
      variavel: rawEntry.variavel ?? existing?.variavel ?? false,
      autoCorrect: rawEntry.autoCorrect ?? existing?.autoCorrect ?? "allow",
      tags: Array.from(/* @__PURE__ */ new Set([...existing?.tags || [], ...(rawEntry.tags || []).filter(Boolean)])),
      forms: Array.from(/* @__PURE__ */ new Set([...existing?.forms || [], ...(rawEntry.forms || []).map(normalizeKey).filter(Boolean)])),
      notes: Array.from(/* @__PURE__ */ new Set([...existing?.notes || [], ...(rawEntry.notes || []).filter(Boolean)]))
    };
    target.set(lemma, merged);
    const aliases = /* @__PURE__ */ new Set([rawLemma, ...merged.forms || []]);
    for (const alias of aliases) {
      const normalizedAlias = normalizeKey(alias);
      if (!normalizedAlias || target.has(normalizedAlias)) {
        continue;
      }
      target.set(normalizedAlias, {
        ...merged,
        lemma
      });
    }
  }
}
function loadLexicalEntries(baseDir, fileNames) {
  const lexicalEntries = /* @__PURE__ */ new Map();
  for (const fileName of fileNames) {
    const pathname = (0, import_node_path.join)(baseDir, "Lexico", fileName);
    const content = readJsonFile(pathname, {});
    addLexicalEntries(lexicalEntries, content);
  }
  return lexicalEntries;
}
function loadAllowedUnknownWords(baseDir) {
  const entries = readJsonFile((0, import_node_path.join)(baseDir, "Excecoes", "palavras_desconhecidas.json"), {});
  const allowedUnknownWords = /* @__PURE__ */ new Set();
  const blockedAutoCorrections = /* @__PURE__ */ new Set();
  for (const [rawWord, config] of Object.entries(entries)) {
    const word = normalizeKey(rawWord);
    if (!word) {
      continue;
    }
    allowedUnknownWords.add(word);
    if (config?.status === "bloquear_autocorrecao") {
      blockedAutoCorrections.add(word);
    }
  }
  return { allowedUnknownWords, blockedAutoCorrections };
}
function loadLocutions(baseDir) {
  const content = readJsonFile((0, import_node_path.join)(baseDir, "Excecoes", "locucoes.json"), {});
  return new Map(
    Object.entries(content).map(([key, value]) => [normalizeKey(key), value]).filter(([key, value]) => key && typeof value === "string" && value.trim())
  );
}
function loadSyntaxPatterns(baseDir) {
  const content = readJsonFile((0, import_node_path.join)(baseDir, "Sintaxe", "padroes_basicos.json"), { patterns: [] });
  return Array.isArray(content.patterns) ? content.patterns : [];
}
function loadVerbConjugation(baseDir) {
  return readJsonFile((0, import_node_path.join)(baseDir, "Regras", "conjugacao_verbal.json"), {});
}
function loadNominalInflection(baseDir) {
  return readJsonFile((0, import_node_path.join)(baseDir, "Regras", "flexao_nominal.json"), null);
}
function loadDerivation(baseDir) {
  return readJsonFile((0, import_node_path.join)(baseDir, "Regras", "derivacao.json"), null);
}
function loadVerbalAgreement(baseDir) {
  const content = readJsonFile((0, import_node_path.join)(baseDir, "Concordancia", "verbal.json"), {});
  return Object.fromEntries(
    Object.entries(content).map(([key, value]) => [normalizeKey(key), value])
  );
}
function loadIrregularVerbs(baseDir) {
  return readJsonFile((0, import_node_path.join)(baseDir, "Irregularidades", "verbos_irregulares.json"), {});
}
function loadIrregularPlurals(baseDir) {
  return readJsonFile((0, import_node_path.join)(baseDir, "Irregularidades", "plurais_irregulares.json"), {});
}
function createEmptyLinguisticData() {
  return {
    lexicalEntries: /* @__PURE__ */ new Map(),
    blockedAutoCorrections: /* @__PURE__ */ new Set(),
    allowedUnknownWords: /* @__PURE__ */ new Set(),
    locutions: /* @__PURE__ */ new Map(),
    verbConjugationRules: {},
    nominalInflection: null,
    derivation: null,
    verbalAgreement: {},
    irregularVerbs: {},
    irregularPlurals: {},
    syntaxPatterns: []
  };
}
function loadLinguisticData(dataDir2) {
  const baseDir = (0, import_node_path.join)(dataDir2, "linguistic");
  if (!(0, import_node_fs.existsSync)(baseDir)) {
    return createEmptyLinguisticData();
  }
  const manifest = readJsonFile((0, import_node_path.join)(baseDir, "manifest.json"), {});
  const lexicalEntries = loadLexicalEntries(baseDir, manifest.lexical || []);
  const { allowedUnknownWords, blockedAutoCorrections } = loadAllowedUnknownWords(baseDir);
  const locutions = loadLocutions(baseDir);
  for (const locution of locutions.keys()) {
    blockedAutoCorrections.add(locution);
  }
  return {
    lexicalEntries,
    blockedAutoCorrections,
    allowedUnknownWords,
    locutions,
    verbConjugationRules: loadVerbConjugation(baseDir),
    nominalInflection: loadNominalInflection(baseDir),
    derivation: loadDerivation(baseDir),
    verbalAgreement: loadVerbalAgreement(baseDir),
    irregularVerbs: loadIrregularVerbs(baseDir),
    irregularPlurals: loadIrregularPlurals(baseDir),
    syntaxPatterns: loadSyntaxPatterns(baseDir)
  };
}

// src/backend/dictionary.ts
function loadReplacementEntries(pathname) {
  return JSON.parse((0, import_node_fs2.readFileSync)(pathname, "utf8"));
}
function loadCommonMistakeEntries(pathname, existingReplacementEntries) {
  const existingFrom = new Set(existingReplacementEntries.map((entry) => normalizeDictionaryWord(entry.from)));
  const entries = JSON.parse((0, import_node_fs2.readFileSync)(pathname, "utf8"));
  return entries.filter((entry) => !existingFrom.has(normalizeDictionaryWord(entry.from))).map((entry) => ({
    from: entry.from,
    replacements: entry.replacements,
    source: entry.description?.trim() || "common_mistakes"
  }));
}
function loadWordList(pathname) {
  return (0, import_node_fs2.readFileSync)(pathname, "utf8").split(/\r?\n/u).map(normalizeDictionaryWord).filter((word) => word && !word.startsWith("#"));
}
function loadContextRules(pathname) {
  return JSON.parse((0, import_node_fs2.readFileSync)(pathname, "utf8"));
}
function loadPhraseRules(pathname) {
  return JSON.parse((0, import_node_fs2.readFileSync)(pathname, "utf8"));
}
function loadOptionalPhraseRules(pathname) {
  if (!(0, import_node_fs2.existsSync)(pathname)) {
    return [];
  }
  return loadPhraseRules(pathname);
}
function loadDictionaryManifest(dictionaryDir) {
  const manifestPath = (0, import_node_path2.join)(dictionaryDir, "manifest.json");
  if (!(0, import_node_fs2.existsSync)(manifestPath)) {
    return null;
  }
  return JSON.parse((0, import_node_fs2.readFileSync)(manifestPath, "utf8"));
}
function loadDictionaryResources(dataDir2) {
  const replacements = loadReplacementEntries((0, import_node_path2.join)(dataDir2, "replacements.json"));
  const dictionaryDir = (0, import_node_path2.join)(dataDir2, "dictionary");
  const rulesDir = (0, import_node_path2.join)(dataDir2, "rules");
  const linguisticData = loadLinguisticData(dataDir2);
  const manifest = loadDictionaryManifest(dictionaryDir);
  const useLegacyWordFiles = manifest?.useLegacyWordFiles ?? true;
  const useLegacyCustomWords = manifest?.useLegacyCustomWords ?? true;
  const useLegacyCommonMistakes = manifest?.useLegacyCommonMistakes ?? true;
  const dictionaryFiles = manifest?.wordFiles?.length ? [...manifest.wordFiles] : (0, import_node_fs2.readdirSync)(dictionaryDir).filter((name) => /^words_\d+\.txt$/u.test(name)).sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
  const words = /* @__PURE__ */ new Set();
  if (useLegacyWordFiles) {
    for (const fileName of dictionaryFiles) {
      for (const word of loadWordList((0, import_node_path2.join)(dictionaryDir, fileName))) {
        words.add(word);
      }
    }
  }
  const customWordsFile = manifest?.customWordsFile || "custom_words.txt";
  if (useLegacyCustomWords) {
    for (const word of loadWordList((0, import_node_path2.join)(dictionaryDir, customWordsFile))) {
      words.add(word);
    }
  }
  for (const lemma of linguisticData.lexicalEntries.keys()) {
    words.add(lemma);
    const entry = linguisticData.lexicalEntries.get(lemma);
    for (const form of entry?.forms || []) {
      words.add(form);
    }
  }
  for (const word of linguisticData.allowedUnknownWords) {
    words.add(word);
  }
  const commonMistakesFile = manifest?.commonMistakesFile || "common_mistakes.json";
  const commonMistakes = useLegacyCommonMistakes ? loadCommonMistakeEntries((0, import_node_path2.join)(dictionaryDir, commonMistakesFile), replacements) : [];
  const dictionaryReady = words.size >= 5e3;
  const contextRules = loadContextRules((0, import_node_path2.join)(rulesDir, "context_rules.json"));
  const phraseRules = [
    ...loadPhraseRules((0, import_node_path2.join)(rulesDir, "phrase_rules.json")),
    ...loadOptionalPhraseRules((0, import_node_path2.join)(rulesDir, "phrase_rules_continuous.json"))
  ];
  return {
    replacements,
    words,
    commonMistakes,
    dictionaryReady,
    contextRules,
    phraseRules,
    linguisticData
  };
}

// src/backend/server.ts
var import_node_fs3 = require("node:fs");
var DEFAULT_PORT = Number(process.env.CORRIJA_ME_PORT ?? "18081");
var currentDir = __dirname;
var dataDir = (0, import_node_path3.join)(currentDir, "../data");
var dictionaryResources = loadDictionaryResources(dataDir);
var dictionaryManifestPath = (0, import_node_path3.join)(dataDir, "dictionary", "manifest.json");
var dictionaryManifest = (0, import_node_fs3.existsSync)(dictionaryManifestPath) ? JSON.parse((0, import_node_fs3.readFileSync)(dictionaryManifestPath, "utf8")) : null;
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}
function parseBody(body, contentType) {
  if (contentType?.includes("application/json")) {
    const parsed = JSON.parse(body || "{}");
    return {
      text: parsed.text ?? "",
      language: parsed.language ?? "pt-BR"
    };
  }
  const params = new URLSearchParams(body);
  return {
    text: params.get("text") ?? "",
    language: params.get("language") ?? "pt-BR"
  };
}
var server = (0, import_node_http.createServer)(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "OPTIONS") {
    sendJson(response, 200, {});
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "corrija_me_pt_br_node",
      dictionary: {
        words: dictionaryResources.words.size,
        commonMistakes: dictionaryResources.commonMistakes.length,
        ready: dictionaryResources.dictionaryReady,
        contextRules: dictionaryResources.contextRules.length,
        phraseRules: dictionaryResources.phraseRules.length,
        lexicalEntries: dictionaryResources.linguisticData.lexicalEntries.size,
        syntaxPatterns: dictionaryResources.linguisticData.syntaxPatterns.length,
        legacySources: {
          wordFiles: dictionaryManifest?.useLegacyWordFiles ?? true,
          customWords: dictionaryManifest?.useLegacyCustomWords ?? true,
          commonMistakes: dictionaryManifest?.useLegacyCommonMistakes ?? true
        }
      }
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v2/languages") {
    sendJson(response, 200, [
      {
        name: "Portuguese (Brazil)",
        code: "pt",
        longCode: "pt-BR"
      }
    ]);
    return;
  }
  if (request.method === "POST" && url.pathname === "/v2/check") {
    const bodyChunks = [];
    for await (const chunk of request) {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const { text, language } = parseBody(Buffer.concat(bodyChunks).toString("utf8"), request.headers["content-type"]);
    if ((language || "pt-BR") !== "pt-BR") {
      sendJson(response, 400, { error: "Somente pt-BR esta disponivel nesta versao." });
      return;
    }
    sendJson(response, 200, checkText(text, dictionaryResources.replacements, {
      words: dictionaryResources.words,
      commonMistakes: dictionaryResources.commonMistakes,
      dictionaryReady: dictionaryResources.dictionaryReady,
      contextRules: dictionaryResources.contextRules,
      phraseRules: dictionaryResources.phraseRules,
      linguisticData: dictionaryResources.linguisticData
    }));
    return;
  }
  sendJson(response, 404, { error: "Rota nao encontrada." });
});
server.listen(DEFAULT_PORT, "127.0.0.1", () => {
  console.log(`corrija_me_pt_br backend local ativo em http://127.0.0.1:${DEFAULT_PORT}`);
});
