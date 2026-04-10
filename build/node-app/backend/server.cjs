/* corrija_me_pt_br backend */
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/backend/server.ts
var import_node_http = require("node:http");
var import_node_child_process = require("node:child_process");
var import_node_path4 = require("node:path");

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
  return /(?<![\p{L}\p{N}\p{M}])[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*(?![\p{L}\p{N}\p{M}])/gu;
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
function isHyphenatedToken(token) {
  return Boolean(token?.normalized.includes("-"));
}
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
    if (isHyphenatedToken(articleToken) || isHyphenatedToken(nounToken)) {
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
    if (isHyphenatedToken(determinerToken) || isHyphenatedToken(nounToken) || isHyphenatedToken(adjectiveToken)) {
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
    if (isHyphenatedToken(nounToken) || isHyphenatedToken(adjectiveToken)) {
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
      if (isHyphenatedToken(firstToken) || isHyphenatedToken(secondToken) || isHyphenatedToken(thirdToken) || isHyphenatedToken(fourthToken)) {
        continue;
      }
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
      if (isHyphenatedToken(firstToken) || isHyphenatedToken(secondToken) || isHyphenatedToken(thirdToken)) {
        continue;
      }
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
    if (isHyphenatedToken(determinerToken) || isHyphenatedToken(nounToken) || isHyphenatedToken(nounQualifierToken) || isHyphenatedToken(linkingVerbToken) || isHyphenatedToken(adjectiveToken)) {
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
    if (isHyphenatedToken(verbToken) || isHyphenatedToken(adjectiveToken) || isHyphenatedToken(determinerToken) || isHyphenatedToken(nounToken)) {
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
function createTerminalReplacementMatch(text, pattern, replacement, ruleId, message, description, matches) {
  const match = pattern.exec(text);
  if (!match || match.index === void 0) {
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
  const lower = trimmed.toLocaleLowerCase("pt-BR");
  const questionStarts = ["quem", "onde", "quando", "como", "qual", "quais", "por que", "o que"];
  const exclamationStarts = ["que belo", "que dia lindo", "que belo dia"];
  const looksLikeQuestion = questionStarts.some((prefix) => lower.startsWith(prefix));
  const looksLikeExclamation = exclamationStarts.some((prefix) => lower.startsWith(prefix));
  const hasInternalTerminalPunctuation = /[?!.]/u.test(trimmed.replace(/[?!.]\s*$/u, ""));
  if (!/[?!.]\s*$/u.test(trimmed) && !hasInternalTerminalPunctuation) {
    if (looksLikeQuestion) {
      createTerminalMatch(
        text,
        /([\p{L}\p{M}\d]+)\s*$/u,
        "?",
        "PT_BR_PUNCTUATION_FINAL_QUESTION",
        "A frase parece pedir ponto de interroga\xE7\xE3o.",
        "Adiciona ponto de interroga\xE7\xE3o ao final da frase.",
        matches
      );
    } else if (looksLikeExclamation) {
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
  } else if (looksLikeQuestion && /\.\s*$/u.test(trimmed) && !hasInternalTerminalPunctuation) {
    createTerminalReplacementMatch(
      text,
      /\.\s*$/u,
      "?",
      "PT_BR_PUNCTUATION_FINAL_QUESTION",
      "A frase parece pedir ponto de interroga\xE7\xE3o.",
      "Substitui ponto final por ponto de interroga\xE7\xE3o ao final da frase.",
      matches
    );
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
var preparedReplacementIndexCache = /* @__PURE__ */ new WeakMap();
var checkResultCache = /* @__PURE__ */ new Map();
var MAX_CHECK_RESULT_CACHE_SIZE = 512;
var MAX_CORRECTION_PASSES = 3;
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
function prepareReplacementIndex(entries) {
  const cached = preparedReplacementIndexCache.get(entries);
  if (cached) {
    return cached;
  }
  const prioritizedEntries = [...entries].sort((left, right) => right.from.length - left.from.length || right.replacements.join("|").length - left.replacements.join("|").length).map((entry) => ({
    entry,
    pattern: isWordLike(entry.from) ? createWholeWordPattern(entry.from) : new RegExp(entry.from, "giu"),
    normalizedFrom: normalizeDictionaryWord(entry.from)
  }));
  const exactEntriesByText = /* @__PURE__ */ new Map();
  for (const preparedEntry of prioritizedEntries) {
    const bucket = exactEntriesByText.get(preparedEntry.normalizedFrom);
    if (bucket) {
      bucket.push(preparedEntry);
      continue;
    }
    exactEntriesByText.set(preparedEntry.normalizedFrom, [preparedEntry]);
  }
  const preparedIndex = {
    prioritizedEntries,
    exactEntriesByText
  };
  preparedReplacementIndexCache.set(entries, preparedIndex);
  return preparedIndex;
}
function createReplacementMatches(text, entries) {
  const matches = [];
  const preparedIndex = prepareReplacementIndex(entries);
  const normalizedText = normalizeDictionaryWord(text);
  const exactEntries = preparedIndex.exactEntriesByText.get(normalizedText);
  if (exactEntries?.length) {
    for (const preparedEntry of exactEntries) {
      const replacements = dedupeStrings(preparedEntry.entry.replacements.map((value) => preserveReplacementCase(text, value)));
      if (!replacements.length) {
        continue;
      }
      addIfNoOverlap(matches, createMatch(
        text,
        0,
        text.length,
        replacements,
        "PT_BR_SIMPLE_REPLACE",
        "Possivel substituicao sugerida para pt-BR.",
        `Substituicao sugerida a partir de ${preparedEntry.entry.source}`
      ));
    }
    if (matches.length) {
      return matches;
    }
  }
  for (const preparedEntry of preparedIndex.prioritizedEntries) {
    const textMatches = text.matchAll(preparedEntry.pattern);
    for (const match of textMatches) {
      if (match.index === void 0) {
        continue;
      }
      const original = match[0];
      const replacements = dedupeStrings(preparedEntry.entry.replacements.map((value) => preserveReplacementCase(original, value)));
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
        `Substituicao sugerida a partir de ${preparedEntry.entry.source}`
      ));
    }
  }
  return matches;
}
function isIgnorableToken(word) {
  return word.length < 3 || /\d/u.test(word) || /^[A-Z0-9_-]+$/u.test(word) || /-/u.test(word) || /[_@/\\.-]/u.test(word);
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
    if (/^(segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)-feira$/iu.test(original)) {
      continue;
    }
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
function buildTokenChangeGroups(sourceTokens, targetTokens) {
  const rows = sourceTokens.length + 1;
  const cols = targetTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i2 = 0; i2 < rows; i2 += 1) {
    dp[i2][0] = i2;
  }
  for (let j2 = 0; j2 < cols; j2 += 1) {
    dp[0][j2] = j2;
  }
  for (let i2 = 1; i2 < rows; i2 += 1) {
    for (let j2 = 1; j2 < cols; j2 += 1) {
      if (sourceTokens[i2 - 1] === targetTokens[j2 - 1]) {
        dp[i2][j2] = dp[i2 - 1][j2 - 1];
      } else {
        dp[i2][j2] = Math.min(
          dp[i2 - 1][j2] + 1,
          dp[i2][j2 - 1] + 1,
          dp[i2 - 1][j2 - 1] + 1
        );
      }
    }
  }
  const operations = [];
  let i = sourceTokens.length;
  let j = targetTokens.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sourceTokens[i - 1] === targetTokens[j - 1]) {
      operations.push({ type: "equal", srcIndex: i - 1, tgtIndex: j - 1 });
      i -= 1;
      j -= 1;
      continue;
    }
    const replaceCost = i > 0 && j > 0 ? dp[i - 1][j - 1] : Number.POSITIVE_INFINITY;
    const deleteCost = i > 0 ? dp[i - 1][j] : Number.POSITIVE_INFINITY;
    const currentCost = dp[i][j];
    if (i > 0 && j > 0 && currentCost === replaceCost + 1) {
      operations.push({ type: "replace", srcIndex: i - 1, tgtIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && currentCost === deleteCost + 1) {
      operations.push({ type: "delete", srcIndex: i - 1 });
      i -= 1;
    } else {
      operations.push({ type: "insert", tgtIndex: j - 1 });
      j -= 1;
    }
  }
  operations.reverse();
  const groups = [];
  let currentGroup = null;
  let sourceCursor = 0;
  let targetCursor = 0;
  function closeGroup() {
    if (!currentGroup) {
      return;
    }
    groups.push({
      ...currentGroup,
      srcText: currentGroup.srcTokens.join(" ").trim(),
      tgtText: currentGroup.tgtTokens.join(" ").trim()
    });
    currentGroup = null;
  }
  for (const operation of operations) {
    if (operation.type === "equal") {
      closeGroup();
      sourceCursor += 1;
      targetCursor += 1;
      continue;
    }
    if (!currentGroup) {
      currentGroup = {
        srcStart: sourceCursor,
        srcEnd: sourceCursor,
        tgtStart: targetCursor,
        tgtEnd: targetCursor,
        srcTokens: [],
        tgtTokens: []
      };
    }
    if (operation.type === "replace") {
      currentGroup.srcTokens.push(sourceTokens[operation.srcIndex ?? 0] || "");
      currentGroup.tgtTokens.push(targetTokens[operation.tgtIndex ?? 0] || "");
      sourceCursor += 1;
      targetCursor += 1;
    } else if (operation.type === "delete") {
      currentGroup.srcTokens.push(sourceTokens[operation.srcIndex ?? 0] || "");
      sourceCursor += 1;
    } else {
      currentGroup.tgtTokens.push(targetTokens[operation.tgtIndex ?? 0] || "");
      targetCursor += 1;
    }
    currentGroup.srcEnd = sourceCursor;
    currentGroup.tgtEnd = targetCursor;
  }
  closeGroup();
  return groups.filter((group) => group.srcText && group.tgtText);
}
function createIterativeDiffMatches(originalText, finalText) {
  if (originalText === finalText) {
    return [];
  }
  const originalTokens = tokenizeSlices(originalText);
  const finalTokens = tokenizeSlices(finalText);
  const sourceTokenValues = originalTokens.map((token) => token.normalized);
  const targetTokenValues = finalTokens.map((token) => token.normalized);
  const groups = buildTokenChangeGroups(sourceTokenValues, targetTokenValues);
  const diffMatches = groups.map((group) => {
    const startToken = originalTokens[group.srcStart];
    const endToken = originalTokens[group.srcEnd - 1];
    if (!startToken || !endToken) {
      return null;
    }
    const offset = startToken.offset;
    const length = endToken.offset + endToken.length - startToken.offset;
    const replacement = finalTokens.slice(group.tgtStart, group.tgtEnd).map((token) => token.value).join(" ").trim();
    if (!replacement) {
      return null;
    }
    return createMatch(
      originalText,
      offset,
      length,
      [replacement],
      "PT_BR_MULTI_PASS",
      "Corre\xE7\xE3o composta inferida a partir de m\xFAltiplas passagens.",
      "Agrupa corre\xE7\xF5es encadeadas encontradas ap\xF3s reprocessar a frase.",
      createConfidence("high", 0.93, "correcao iterativa consolidada")
    );
  }).filter((match) => Boolean(match));
  return diffMatches.map((match) => {
    const original = originalText.slice(match.offset, match.offset + match.length);
    const replacement = match.replacements[0]?.value || "";
    const leftContext = originalText.slice(0, match.offset);
    const porMatch = /\bpor\s$/iu.exec(leftContext);
    if (stripDiacritics(normalizeDictionaryWord(original)) === "que" && stripDiacritics(normalizeDictionaryWord(replacement)) === "que" && porMatch) {
      const expandedOffset = match.offset - porMatch[0].length;
      const expandedOriginal = originalText.slice(expandedOffset, match.offset + match.length);
      return createMatch(
        originalText,
        expandedOffset,
        expandedOriginal.length,
        [preserveReplacementCase(expandedOriginal, "por qu\xEA")],
        "PT_BR_MULTI_PASS",
        "Corre\xE7\xE3o composta inferida a partir de m\xFAltiplas passagens.",
        "Agrupa corre\xE7\xF5es encadeadas encontradas ap\xF3s reprocessar a frase.",
        createConfidence("high", 0.93, "correcao iterativa consolidada")
      );
    }
    return match;
  });
}
function createWholeTextInferenceMatch(originalText, finalText) {
  return createMatch(
    originalText,
    0,
    originalText.length,
    [finalText],
    "PT_BR_MULTI_PASS",
    "Corre\xE7\xE3o composta inferida a partir de m\xFAltiplas passagens.",
    "Consolida a frase final quando a diferen\xE7a token a token nao preserva toda a corre\xE7\xE3o.",
    createConfidence("high", 0.9, "consolidacao integral da frase")
  );
}
function sanitizeInvalidWeekdayHyphenForms(text) {
  return text.replace(/\bsegundas-feira\b/giu, "segunda-feira").replace(/\bterças-feira\b/giu, "ter\xE7a-feira").replace(/\btercas-feira\b/giu, "ter\xE7a-feira").replace(/\bquartas-feira\b/giu, "quarta-feira").replace(/\bquintas-feira\b/giu, "quinta-feira").replace(/\bsextas-feira\b/giu, "sexta-feira").replace(/\bsábados-feira\b/giu, "s\xE1bado-feira").replace(/\bsabados-feira\b/giu, "s\xE1bado-feira").replace(/\bdomingos-feira\b/giu, "domingo-feira");
}
function createConsolidatedInferenceMatches(originalText, finalText) {
  const sanitizedFinalText = sanitizeInvalidWeekdayHyphenForms(finalText);
  if (originalText === sanitizedFinalText) {
    return [];
  }
  if (originalText === finalText) {
    return [];
  }
  const diffMatches = createIterativeDiffMatches(originalText, sanitizedFinalText);
  if (!diffMatches.length) {
    return [createWholeTextInferenceMatch(originalText, sanitizedFinalText)];
  }
  const reconstructedText = applyVisibleMatches(originalText, diffMatches);
  if (reconstructedText !== sanitizedFinalText) {
    return [createWholeTextInferenceMatch(originalText, sanitizedFinalText)];
  }
  return diffMatches;
}
function applyVisibleMatches(text, matches) {
  const ordered = collapseOverlappingMatches(matches).filter((match) => Array.isArray(match.replacements) && Boolean(match.replacements[0]?.value)).sort((left, right) => right.offset - left.offset || right.length - left.length);
  let updatedText = text;
  for (const match of ordered) {
    const replacement = match.replacements[0]?.value;
    if (!replacement) {
      continue;
    }
    updatedText = updatedText.slice(0, match.offset) + replacement + updatedText.slice(match.offset + match.length);
  }
  return updatedText;
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
function createPorQueHeuristicMatches(text) {
  const matches = [];
  const indirectQuestionPrefixes = [
    "n\xE3o sei",
    "nao sei",
    "ningu\xE9m sabe",
    "ninguem sabe",
    "ningu\xE9m entende",
    "ninguem entende",
    "quero saber",
    "queria saber",
    "gostaria de saber",
    "n\xE3o sabemos",
    "nao sabemos",
    "explique"
  ];
  for (const prefix of indirectQuestionPrefixes) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
    const becausePattern = new RegExp(`\\b(${escapedPrefix})\\s+(porque|porqu\xEA)(?=\\s+\\p{L})`, "giu");
    for (const match of text.matchAll(becausePattern)) {
      if (match.index === void 0) {
        continue;
      }
      const token = match[2];
      const offset = match.index + match[0].lastIndexOf(token);
      addIfNoOverlap(matches, createStructuredMatch(
        text,
        offset,
        token.length,
        preserveReplacementCase(token, "por que"),
        "PT_BR_POR_QUE_INDIRECT_QUESTION",
        "Em pergunta indireta, a forma esperada aqui e 'por que'.",
        "Corrige o uso de 'porque' ou 'porqu\xEA' em construcoes de pergunta indireta.",
        "grammar",
        createConfidence("high", 0.91, "pergunta indireta recorrente")
      ));
    }
  }
  for (const match of text.matchAll(/\bpor\s+que(?=\s*[?!]\s*$)/giu)) {
    if (match.index === void 0) {
      continue;
    }
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      match.index,
      match[0].length,
      preserveReplacementCase(match[0], "por qu\xEA"),
      "PT_BR_POR_QUE_FINAL",
      "No fim de pergunta, a forma esperada aqui e 'por qu\xEA'.",
      "Corrige 'por que' em final de pergunta direta.",
      "grammar",
      createConfidence("high", 0.93, "por que em final de pergunta")
    ));
  }
  for (const match of text.matchAll(new RegExp("\\bexplicou\\s+porqu\xEA(?=\\s+\\p{L})", "giu"))) {
    if (match.index === void 0) {
      continue;
    }
    const token = "porqu\xEA";
    const offset = match.index + match[0].toLowerCase().lastIndexOf(token);
    addIfNoOverlap(matches, createStructuredMatch(
      text,
      offset,
      token.length,
      "porque",
      "PT_BR_PORQUE_EXPLICATIVO",
      "Em ora\xE7\xE3o explicativa, a forma esperada aqui e 'porque'.",
      "Corrige uso de 'porqu\xEA' onde a construcao pede conjuncao explicativa.",
      "grammar",
      createConfidence("high", 0.89, "oracao explicativa recorrente")
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
    if (match.rule.id === "PT_BR_PUNCTUATION_POREM") {
      score = 0.94;
    }
    if (match.rule.id.includes("FINAL_")) {
      score = 0.84;
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
    let score = 0.97;
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
function finalizeMatches(text, matches, dictionary) {
  const visibleMatches = collapseOverlappingMatches(matches.map((match) => ({
    ...match,
    confidence: deriveMatchConfidence(match, text, dictionary)
  })).filter((match) => shouldExposeMatch(match)));
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
function storeCheckResultInCache(text, result) {
  if (checkResultCache.has(text)) {
    checkResultCache.delete(text);
  }
  checkResultCache.set(text, result);
  if (checkResultCache.size <= MAX_CHECK_RESULT_CACHE_SIZE) {
    return;
  }
  const oldestKey = checkResultCache.keys().next().value;
  if (typeof oldestKey === "string") {
    checkResultCache.delete(oldestKey);
  }
}
function hasSingleWholeTextMatch(result, text) {
  return result.matches.length === 1 && result.matches[0]?.offset === 0 && result.matches[0]?.length === text.length && Boolean(result.matches[0]?.replacements[0]?.value);
}
function collectVisibleStageMatches(text, dictionary, matches) {
  return finalizeMatches(text, matches, dictionary).matches;
}
function findWholeTextSpecialistMatches(text, replacements, dictionary) {
  const candidates = [
    ...createReplacementMatches(text, replacements),
    ...createPhraseRuleMatches(text, dictionary.phraseRules),
    ...createContextRuleMatches(text, dictionary.contextRules)
  ];
  const wholeTextCandidates = candidates.filter((match) => match.offset === 0 && match.length === text.length);
  if (!wholeTextCandidates.length) {
    return [];
  }
  return finalizeMatches(text, wholeTextCandidates, dictionary).matches.filter((match) => match.offset === 0 && match.length === text.length);
}
function createInferenceStages(replacements, dictionary) {
  return [
    {
      id: "symbolic_context",
      description: "Aplica especialistas simbolicos de frase e contexto.",
      collectMatches: (text) => [
        ...createPhraseRuleMatches(text, dictionary.phraseRules),
        ...createContextRuleMatches(text, dictionary.contextRules),
        ...createPorQueHeuristicMatches(text),
        ...createCraseHeuristicMatches(text),
        ...createLocalizationDateMatches(text),
        ...createAnnouncementAgreementMatches(text)
      ]
    },
    {
      id: "normalization",
      description: "Normaliza trocas seguras e problemas mecanicos.",
      collectMatches: (text) => [
        ...createReplacementMatches(text, replacements),
        ...createRepeatedWordMatches(text),
        ...createDoubleSpaceMatches(text),
        ...createSpaceBeforePunctuationMatches(text),
        ...createSentenceCaseMatches(text)
      ]
    },
    {
      id: "linguistic_agreement",
      description: "Resolve concordancia e sintaxe curta.",
      collectMatches: (text) => [
        ...createSimpleVerbalAgreementMatches(text, dictionary),
        ...createSimpleNominalAgreementMatches(text, dictionary),
        ...createSimpleSyntaxPatternMatches(text, dictionary)
      ]
    },
    {
      id: "refinement",
      description: "Fecha a frase com refinamentos heur\xEDsticos.",
      collectMatches: (text) => {
        const punctuationHeuristicMatches = createPunctuationHeuristicMatches(text);
        const unknownWordMatches = createUnknownWordMatches(text, dictionary).filter((candidate) => !punctuationHeuristicMatches.some((existing) => candidate.offset < existing.offset + existing.length && existing.offset < candidate.offset + candidate.length));
        return [
          ...punctuationHeuristicMatches,
          ...unknownWordMatches
        ];
      }
    }
  ];
}
function runInferencePipeline(text, replacements, dictionary) {
  const wholeTextMatches = findWholeTextSpecialistMatches(text, replacements, dictionary);
  if (wholeTextMatches.length) {
    return finalizeMatches(text, wholeTextMatches, dictionary);
  }
  let currentText = text;
  let exactWholeTextResult = null;
  for (const stage of createInferenceStages(replacements, dictionary)) {
    const visibleMatches = collectVisibleStageMatches(currentText, dictionary, stage.collectMatches(currentText));
    if (!visibleMatches.length) {
      continue;
    }
    if (visibleMatches.length === 1 && visibleMatches[0]?.offset === 0 && visibleMatches[0]?.length === currentText.length) {
      exactWholeTextResult = finalizeMatches(text, [createWholeTextInferenceMatch(text, visibleMatches[0].replacements[0]?.value || currentText)], dictionary);
      currentText = visibleMatches[0].replacements[0]?.value || currentText;
      break;
    }
    const nextText = applyVisibleMatches(currentText, visibleMatches);
    if (nextText === currentText) {
      continue;
    }
    currentText = nextText;
  }
  if (exactWholeTextResult) {
    return exactWholeTextResult;
  }
  return finalizeMatches(text, createConsolidatedInferenceMatches(text, currentText), dictionary);
}
function checkTextSinglePass(text, replacements, dictionary) {
  return runInferencePipeline(text, replacements, dictionary);
  const replacementMatches = createReplacementMatches(text, replacements);
  const exactWholeTextReplacementMatches = replacementMatches.filter((match) => match.offset === 0 && match.length === text.length);
  if (exactWholeTextReplacementMatches.length) {
    return finalizeMatches(text, exactWholeTextReplacementMatches, dictionary);
  }
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
  const result = finalizeMatches(text, allMatches, dictionary);
  return result;
}
function checkText(text, replacements, dictionary) {
  const cached = checkResultCache.get(text);
  if (cached) {
    return cached;
  }
  let currentText = text;
  let passResult = checkTextSinglePass(currentText, replacements, dictionary);
  if (hasSingleWholeTextMatch(passResult, text)) {
    storeCheckResultInCache(text, passResult);
    return passResult;
  }
  let passCount = 1;
  while (passCount < MAX_CORRECTION_PASSES) {
    if (!passResult.matches.length) {
      break;
    }
    const nextText = applyVisibleMatches(currentText, passResult.matches);
    if (nextText === currentText) {
      break;
    }
    currentText = nextText;
    passResult = checkTextSinglePass(currentText, replacements, dictionary);
    passCount += 1;
  }
  const result = currentText !== text && passCount > 1 ? finalizeMatches(text, createConsolidatedInferenceMatches(text, currentText), dictionary) : checkTextSinglePass(text, replacements, dictionary);
  storeCheckResultInCache(text, result);
  return result;
}

// src/backend/llm-core.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);
var DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
var DEFAULT_OLLAMA_MODEL = "jandaia-1";
var DEFAULT_TIMEOUT_MS = 15e3;
var BASE_PROFILE_PATH = import_node_path.default.join(process.cwd(), "data", "ai", "jandaia-base-profiles.json");
function readBaseProfileConfig(env = process.env) {
  const raw = JSON.parse((0, import_node_fs.readFileSync)(BASE_PROFILE_PATH, "utf8"));
  const profileId = env.CORRIJA_ME_JANDAIA_BASE_PROFILE || raw.preferredProfile || "qwen2_5_1_5b";
  const profile = raw.profiles?.[profileId];
  if (!profile) {
    return {
      id: profileId,
      localModelCandidates: []
    };
  }
  return {
    id: profileId,
    localModelCandidates: Array.isArray(profile.localModelCandidates) ? profile.localModelCandidates.map((candidate) => import_node_path.default.join(process.cwd(), candidate)) : []
  };
}
function resolveLocalModelPath(env = process.env) {
  const profile = readBaseProfileConfig(env);
  return profile.localModelCandidates.find((candidate) => (0, import_node_fs.existsSync)(candidate)) || profile.localModelCandidates[0] || "";
}
var MIN_ROUTE_TEXT_LENGTH = 12;
var MAX_ROUTE_TEXT_LENGTH = 280;
var MIN_ROUTE_WORD_COUNT = 3;
var HOMOPHONE_TRIGGER_PATTERN = /\b(?:sess[aã]o|se[cç][aã]o|cess[aã]o|concerto|conserto|concertar|consertar|taxar|tachar|ratificar|retificar|infligir|infringir|onde|aonde|porque|por que|porquê|por quê)\b/iu;
var JANDAIA_DIRECTIVE = [
  "Voc\xEA \xE9 jandaia 1, especialista em corre\xE7\xE3o de portugu\xEAs do Brasil.",
  "Sua tarefa \xE9 corrigir a frase com a MENOR quantidade de mudan\xE7as poss\xEDvel.",
  "Preserve o sentido original, a estrutura da frase e as palavras j\xE1 corretas.",
  "N\xE3o reescreva por estilo, n\xE3o resuma, n\xE3o melhore fluidez e n\xE3o troque palavras por sin\xF4nimos.",
  "N\xE3o invente detalhes, n\xE3o acrescente informa\xE7\xE3o e n\xE3o remova conte\xFAdo.",
  "Se a frase j\xE1 estiver correta, devolva a mesma frase.",
  "Responda somente com JSON v\xE1lido em uma \xFAnica linha.",
  'Formato obrigat\xF3rio: {"final":"FRASE_CORRIGIDA","changed":true}.',
  "N\xE3o escreva nada antes ou depois do JSON."
].join("\n");
function buildJandaiaPrompt(text) {
  return [
    JANDAIA_DIRECTIVE,
    "",
    "Exemplos:",
    "Errada: A gente vamos no cinema amanh\xE3.",
    '{"final":"A gente vai ao cinema amanh\xE3.","changed":true}',
    "",
    "Errada: A se\xE7\xE3o de cinema come\xE7a \xE0s 20h.",
    '{"final":"A sess\xE3o de cinema come\xE7a \xE0s 20h.","changed":true}',
    "",
    "Errada: Ele n\xE3o sabe porque voc\xEA faltou.",
    '{"final":"Ele n\xE3o sabe por que voc\xEA faltou.","changed":true}',
    "",
    "Errada: Os dois garotos foi na rua comprar p\xE3o mas eles n\xE3o lembro do dinheiro e esqueceu a chave de casa.",
    '{"final":"Os dois garotos foram \xE0 rua comprar p\xE3o, mas eles n\xE3o se lembraram do dinheiro e esqueceram a chave de casa.","changed":true}',
    "",
    "Agora corrija apenas a frase abaixo.",
    `Errada: ${text}`,
    '{"final":'
  ].join("\n");
}
function looksLikeCleanSentence(text) {
  if (!text) {
    return false;
  }
  if (/[<>{}\[\]]/u.test(text)) {
    return false;
  }
  if (/\b(?:resposta|instruction|instrução|prompt|correta:|errada:)\b/iu.test(text)) {
    return false;
  }
  if (text.length < 3 || text.length > 280) {
    return false;
  }
  const letterCount = (text.match(new RegExp("\\p{L}", "gu")) || []).length;
  if (letterCount < 2) {
    return false;
  }
  const weirdPunctuationCount = (text.match(/["`]/gu) || []).length;
  if (weirdPunctuationCount > 2) {
    return false;
  }
  return true;
}
function parseBooleanFlag(value) {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on", "sim"].includes(value.trim().toLowerCase());
}
function normalizeGeneratedText(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/u);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const structuredFinal = String(parsed?.final || "").trim();
      if (looksLikeCleanSentence(structuredFinal)) {
        return structuredFinal;
      }
    } catch {
    }
  }
  const cleaned = text.trim().replace(/<[^>]+>/gu, " ").replace(/^["'`]+|["'`]+$/g, "").replace(/^corrigida:\s*/iu, "").replace(/^frase corrigida:\s*/iu, "").replace(/^correta:\s*/iu, "").trim();
  const firstLine = cleaned.split(/\r?\n/u)[0]?.trim() || "";
  if (!looksLikeCleanSentence(firstLine)) {
    return "";
  }
  return firstLine;
}
function readJandaiaArchitectureProfile() {
  return {
    runtimeMode: "motor_first_with_budgeted_specialized_llm_fallback",
    primaryRole: "fallback_qualificado_pt_br",
    instructors: ["tucano_2", "quillbot"],
    externalAdvisor: "gemini",
    correctionStyle: [
      "preservar_sentido",
      "menor_correcao_suficiente",
      "evitar_sofisticacao_desnecessaria",
      "priorizar_pt_br_natural"
    ],
    executionPolicy: {
      strategy: "motor_imediato_com_jandaia_orcada_em_segundo_plano",
      serviceLevelBudgetMs: DEFAULT_TIMEOUT_MS,
      simpleCasesLayer: "motor",
      complexCasesLayer: "jandaia_1"
    }
  };
}
function readLlmCoreConfig(env = process.env) {
  return {
    enabled: parseBooleanFlag(env.CORRIJA_ME_LLM_CORE_ENABLED),
    baseUrl: (env.CORRIJA_ME_LLM_CORE_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/u, ""),
    model: env.CORRIJA_ME_LLM_CORE_MODEL || DEFAULT_OLLAMA_MODEL,
    timeoutMs: Number(env.CORRIJA_ME_LLM_CORE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}
async function checkLlmCoreHealth(config) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 1e4));
    const response = await fetch(`${config.baseUrl}/api/version`, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return {
        reachable: false,
        model: config.model,
        error: `http_${response.status}`
      };
    }
    const payload = await response.json();
    return {
      reachable: true,
      model: config.model,
      version: payload.version || "unknown"
    };
  } catch (error) {
    return {
      reachable: false,
      model: config.model,
      error: error instanceof Error ? error.message : "llm_core_unreachable"
    };
  }
}
async function readJandaiaRuntimeReadiness(config) {
  const health = await checkLlmCoreHealth(config);
  const baseProfile = readBaseProfileConfig().id;
  const resolvedLocalModelPath = resolveLocalModelPath();
  const localModelFilePresent = (0, import_node_fs.existsSync)(resolvedLocalModelPath);
  let configuredModelPresent = false;
  if (health.reachable) {
    try {
      const response = await fetch(`${config.baseUrl}/api/tags`);
      if (response.ok) {
        const payload = await response.json();
        configuredModelPresent = Array.isArray(payload.models) && payload.models.some((entry) => String(entry?.name || "").startsWith(`${config.model}:`));
      }
    } catch {
      configuredModelPresent = false;
    }
  }
  return {
    baseProfile,
    configuredModel: config.model,
    localModelFilePresent,
    ollamaReachable: Boolean(health.reachable),
    llmCoreEnabled: config.enabled,
    configuredModelPresent,
    readyForActivation: config.enabled && Boolean(health.reachable) && configuredModelPresent,
    localModelPath: resolvedLocalModelPath
  };
}
function decideLlmRouting(text, result) {
  const normalizedText = text.trim();
  const wordCount = (normalizedText.match(/[\p{L}\p{N}]+/gu) || []).length;
  const matchCount = result.matches.length;
  const confidenceScores = result.matches.map((match) => match.confidence?.score).filter((score) => typeof score === "number");
  const confidenceFloor = confidenceScores.length ? Math.min(...confidenceScores) : 0;
  const ambiguousMatchCount = result.matches.filter((match) => (match.replacements?.length || 0) > 1).length;
  const hasHomophoneTrigger = HOMOPHONE_TRIGGER_PATTERN.test(text);
  const hasWholeTextMatch = result.matches.some((match) => match.offset === 0 && match.length === normalizedText.length);
  const hasMultiPassMatch = result.matches.some((match) => match.rule?.id === "PT_BR_MULTI_PASS");
  const triggers = [];
  if (normalizedText.length < MIN_ROUTE_TEXT_LENGTH || wordCount < MIN_ROUTE_WORD_COUNT) {
    return {
      shouldRoute: false,
      reason: "texto_curto_ou_pouco_informativo",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "motor"
    };
  }
  if (normalizedText.length > MAX_ROUTE_TEXT_LENGTH) {
    return {
      shouldRoute: false,
      reason: "texto_grande_demais_para_fallback",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "motor"
    };
  }
  if (!matchCount) {
    triggers.push("motor_sem_saida");
    return {
      shouldRoute: true,
      reason: "motor_sem_saida",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }
  if (hasHomophoneTrigger && (confidenceFloor < 0.96 || ambiguousMatchCount > 0)) {
    triggers.push("homofono_ou_contexto_ambiguo");
    return {
      shouldRoute: true,
      reason: "homofono_ou_contexto_ambiguo",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }
  if (confidenceFloor < 0.85) {
    triggers.push("confianca_baixa");
    return {
      shouldRoute: true,
      reason: "confianca_baixa",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }
  if (matchCount >= 3) {
    triggers.push("muitas_edicoes_acopladas");
    return {
      shouldRoute: true,
      reason: "muitas_edicoes_acopladas",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }
  if (ambiguousMatchCount > 0) {
    triggers.push("candidatos_competindo");
    return {
      shouldRoute: true,
      reason: "candidatos_competindo",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }
  if (hasWholeTextMatch && confidenceFloor < 0.94) {
    triggers.push("correcao_integral_com_confianca_intermediaria");
    return {
      shouldRoute: true,
      reason: "correcao_integral_com_confianca_intermediaria",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }
  if (hasMultiPassMatch && confidenceFloor < 0.95) {
    triggers.push("consolidacao_multipla_passagem");
    return {
      shouldRoute: true,
      reason: "consolidacao_multipla_passagem",
      confidenceFloor,
      ambiguousMatchCount,
      matchCount,
      triggers,
      routeTarget: "jandaia_1"
    };
  }
  return {
    shouldRoute: false,
    reason: "motor_confiavel",
    confidenceFloor,
    ambiguousMatchCount,
    matchCount,
    triggers,
    routeTarget: "motor"
  };
}
async function requestLlmCoreSuggestion(text, config) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        options: {
          temperature: 0,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.35,
          num_predict: 80,
          stop: ["}\n", "\n\n"]
        },
        prompt: buildJandaiaPrompt(text)
      })
    });
    if (!response.ok) {
      throw new Error(`llm_core_http_${response.status}`);
    }
    const payload = await response.json();
    const correctedText = normalizeGeneratedText(payload.response || "");
    if (!correctedText) {
      return null;
    }
    return {
      correctedText,
      latencyMs: Date.now() - startedAt,
      model: config.model
    };
  } finally {
    clearTimeout(timeout);
  }
}
function buildWholeTextLlmMatch(text, correctedText, reason) {
  return {
    message: "Sugest\xE3o do n\xFAcleo local para pt-BR.",
    shortMessage: "Sugest\xE3o do n\xFAcleo local.",
    offset: 0,
    length: text.length,
    replacements: [{ value: correctedText }],
    confidence: {
      level: "medium",
      score: 0.74,
      reason
    },
    rule: {
      id: "PT_BR_LLM_CORE",
      description: "Corre\xE7\xE3o integral sugerida pela camada local de IA.",
      issueType: "misspelling"
    },
    context: {
      text,
      offset: 0,
      length: text.length
    }
  };
}

// src/backend/dictionary.ts
var import_node_fs3 = require("node:fs");
var import_node_path3 = require("node:path");

// src/backend/linguistic-data.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
function readJsonFile(pathname, fallback) {
  if (!(0, import_node_fs2.existsSync)(pathname)) {
    return fallback;
  }
  return JSON.parse((0, import_node_fs2.readFileSync)(pathname, "utf8"));
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
    const pathname = (0, import_node_path2.join)(baseDir, "Lexico", fileName);
    const content = readJsonFile(pathname, {});
    addLexicalEntries(lexicalEntries, content);
  }
  return lexicalEntries;
}
function loadAllowedUnknownWords(baseDir) {
  const entries = readJsonFile((0, import_node_path2.join)(baseDir, "Excecoes", "palavras_desconhecidas.json"), {});
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
  const content = readJsonFile((0, import_node_path2.join)(baseDir, "Excecoes", "locucoes.json"), {});
  return new Map(
    Object.entries(content).map(([key, value]) => [normalizeKey(key), value]).filter(([key, value]) => key && typeof value === "string" && value.trim())
  );
}
function loadSyntaxPatterns(baseDir) {
  const content = readJsonFile((0, import_node_path2.join)(baseDir, "Sintaxe", "padroes_basicos.json"), { patterns: [] });
  return Array.isArray(content.patterns) ? content.patterns : [];
}
function loadVerbConjugation(baseDir) {
  return readJsonFile((0, import_node_path2.join)(baseDir, "Regras", "conjugacao_verbal.json"), {});
}
function loadNominalInflection(baseDir) {
  return readJsonFile((0, import_node_path2.join)(baseDir, "Regras", "flexao_nominal.json"), null);
}
function loadDerivation(baseDir) {
  return readJsonFile((0, import_node_path2.join)(baseDir, "Regras", "derivacao.json"), null);
}
function loadVerbalAgreement(baseDir) {
  const content = readJsonFile((0, import_node_path2.join)(baseDir, "Concordancia", "verbal.json"), {});
  return Object.fromEntries(
    Object.entries(content).map(([key, value]) => [normalizeKey(key), value])
  );
}
function loadIrregularVerbs(baseDir) {
  return readJsonFile((0, import_node_path2.join)(baseDir, "Irregularidades", "verbos_irregulares.json"), {});
}
function loadIrregularPlurals(baseDir) {
  return readJsonFile((0, import_node_path2.join)(baseDir, "Irregularidades", "plurais_irregulares.json"), {});
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
  const baseDir = (0, import_node_path2.join)(dataDir2, "linguistic");
  if (!(0, import_node_fs2.existsSync)(baseDir)) {
    return createEmptyLinguisticData();
  }
  const manifest = readJsonFile((0, import_node_path2.join)(baseDir, "manifest.json"), {});
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
  return JSON.parse((0, import_node_fs3.readFileSync)(pathname, "utf8"));
}
function tokenizeReplacementText(value) {
  return String(value || "").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*/gu) || [];
}
var AMBIGUOUS_HOMOPHONE_FAMILIES = [
  ["cessao", "sessao", "secao"],
  ["concerto", "conserto"],
  ["concertar", "consertar"],
  ["taxar", "tachar"],
  ["ratificar", "retificar"],
  ["infligir", "infringir"]
].map((family) => new Set(family.map((word) => normalizeDictionaryWord(word))));
function isAmbiguousHomophonePair(from, to) {
  if (!from || !to || from === to) {
    return false;
  }
  return AMBIGUOUS_HOMOPHONE_FAMILIES.some((family) => family.has(from) && family.has(to));
}
function sanitizeReplacementEntries(entries) {
  const symmetricPairs = /* @__PURE__ */ new Set();
  const directional = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const fromTokens = tokenizeReplacementText(entry.from).map((token) => normalizeDictionaryWord(token));
    const toTokens = Array.isArray(entry.replacements) && entry.replacements.length === 1 ? tokenizeReplacementText(entry.replacements[0]).map((token) => normalizeDictionaryWord(token)) : [];
    if (fromTokens.length !== 1 || toTokens.length !== 1) {
      continue;
    }
    const from = fromTokens[0];
    const to = toTokens[0];
    if (!from || !to || from === to) {
      continue;
    }
    if (isAmbiguousHomophonePair(from, to)) {
      continue;
    }
    directional.set(`${from}->${to}`, entry.source || "");
    if (directional.has(`${to}->${from}`)) {
      symmetricPairs.add(`${from}<->${to}`);
      symmetricPairs.add(`${to}<->${from}`);
    }
  }
  return entries.filter((entry) => {
    const fromTokens = tokenizeReplacementText(entry.from).map((token) => normalizeDictionaryWord(token));
    const toTokens = Array.isArray(entry.replacements) && entry.replacements.length === 1 ? tokenizeReplacementText(entry.replacements[0]).map((token) => normalizeDictionaryWord(token)) : [];
    if (fromTokens.length !== 1 || toTokens.length !== 1) {
      return true;
    }
    const from = fromTokens[0];
    const to = toTokens[0];
    if (isAmbiguousHomophonePair(from, to)) {
      return false;
    }
    return !symmetricPairs.has(`${from}<->${to}`);
  });
}
function loadOptionalReplacementEntries(pathname) {
  if (!(0, import_node_fs3.existsSync)(pathname)) {
    return [];
  }
  return sanitizeReplacementEntries(loadReplacementEntries(pathname));
}
function loadContextRules(pathname) {
  return JSON.parse((0, import_node_fs3.readFileSync)(pathname, "utf8"));
}
function loadPhraseRules(pathname) {
  return JSON.parse((0, import_node_fs3.readFileSync)(pathname, "utf8"));
}
function tokenizeRuleText(value) {
  return String(value || "").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*/gu) || [];
}
function isUnsafeContinuousPhraseRule(rule) {
  if (!String(rule.id || "").startsWith("PT_BR_CONTINUOUS_")) {
    return false;
  }
  const patternTokens = Array.isArray(rule.pattern) ? rule.pattern.map((token) => normalizeDictionaryWord(token)) : [];
  const replacement = Array.isArray(rule.replacements) ? String(rule.replacements[0] || "") : "";
  const replacementTokens = tokenizeRuleText(replacement).map((token) => normalizeDictionaryWord(token));
  if (!patternTokens.length || !replacementTokens.length) {
    return false;
  }
  const patternHasDigits = patternTokens.some((token) => /\d/u.test(token));
  const replacementHasDigits = replacementTokens.some((token) => /\d/u.test(token));
  if (!patternHasDigits && replacementHasDigits) {
    return true;
  }
  return false;
}
function sanitizePhraseRules(rules) {
  return rules.filter((rule) => !isUnsafeContinuousPhraseRule(rule));
}
function loadOptionalPhraseRules(pathname) {
  if (!(0, import_node_fs3.existsSync)(pathname)) {
    return [];
  }
  return sanitizePhraseRules(loadPhraseRules(pathname));
}
function loadOptionalContextRules(pathname) {
  if (!(0, import_node_fs3.existsSync)(pathname)) {
    return [];
  }
  return loadContextRules(pathname);
}
function loadDictionaryResources(dataDir2) {
  const replacements = sanitizeReplacementEntries([
    ...loadReplacementEntries((0, import_node_path3.join)(dataDir2, "replacements.json")),
    ...loadOptionalReplacementEntries((0, import_node_path3.join)(dataDir2, "replacements_learned.json"))
  ]);
  const rulesDir = (0, import_node_path3.join)(dataDir2, "rules");
  const linguisticData = loadLinguisticData(dataDir2);
  const words = /* @__PURE__ */ new Set();
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
  const dictionaryReady = words.size >= 5e3;
  const contextRules = [
    ...loadContextRules((0, import_node_path3.join)(rulesDir, "context_rules.json")),
    ...loadOptionalContextRules((0, import_node_path3.join)(rulesDir, "context_rules_learned.json"))
  ];
  const phraseRules = [
    ...sanitizePhraseRules(loadPhraseRules((0, import_node_path3.join)(rulesDir, "phrase_rules.json"))),
    ...loadOptionalPhraseRules((0, import_node_path3.join)(rulesDir, "phrase_rules_seeded.json")),
    ...loadOptionalPhraseRules((0, import_node_path3.join)(rulesDir, "phrase_rules_continuous.json")),
    ...loadOptionalPhraseRules((0, import_node_path3.join)(rulesDir, "phrase_rules_learned.json"))
  ];
  return {
    replacements,
    words,
    dictionaryReady,
    contextRules,
    phraseRules,
    linguisticData
  };
}

// src/backend/server.ts
var DEFAULT_PORT = Number(process.env.CORRIJA_ME_PORT ?? "18081");
var isPackagedBinary = typeof process.pkg !== "undefined";
var isCheckWorkerProcess = process.env.CORRIJA_ME_CHILD_MODE === "check-worker";
var currentDir = __dirname;
var dataDir = (0, import_node_path4.join)(currentDir, "../data");
var dictionaryResources = isCheckWorkerProcess ? null : loadDictionaryResources(dataDir);
var llmCoreConfig = readLlmCoreConfig();
var jandaiaArchitectureProfile = readJandaiaArchitectureProfile();
var RUNTIME_ARCHITECTURE = {
  production: {
    entrypoint: "backend_json_text",
    first_barrier: "motor",
    fallback: "jandaia",
    primary_endpoint: "/v2/check-smart",
    runtime_mode: jandaiaArchitectureProfile.runtimeMode,
    service_level_budget_ms: llmCoreConfig.timeoutMs
  },
  orientation: {
    instructors: ["tucano_2", "quillbot"],
    director: "gemini",
    data_enrichment: "gemini"
  },
  components: {
    motor: {
      role: "primeira_defesa",
      priorities: ["velocidade", "previsibilidade", "baixo_custo"]
    },
    jandaia_1: {
      role: jandaiaArchitectureProfile.primaryRole,
      style: jandaiaArchitectureProfile.correctionStyle
    },
    tucano_2: {
      role: "referencia_de_base_local"
    },
    quillbot: {
      role: "referencia_de_qualidade_de_reescrita"
    },
    gemini: {
      role: "consultor_externo_e_arbitro"
    }
  },
  implementation: {
    phase: "fase_3_orcamento_de_tempo_e_fallback_controlado",
    next_steps: [
      "medir_quantos_casos_complexos_a_jandaia_resolve_dentro_do_teto",
      "reduzir_latencia_do_modelo_local_sem_perder_qualidade",
      "refinar_gatilhos_por_familia_de_erro"
    ]
  }
};
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
var workerSequence = 0;
var checkWorkerProcess = null;
var pendingWorkerJobs = /* @__PURE__ */ new Map();
function rejectPendingWorkerJobs(reason) {
  for (const pending of pendingWorkerJobs.values()) {
    pending.reject(reason);
  }
  pendingWorkerJobs.clear();
}
function ensureCheckWorker() {
  if (checkWorkerProcess && !checkWorkerProcess.killed) {
    return checkWorkerProcess;
  }
  const childArgs = typeof process.pkg !== "undefined" ? [] : [__filename];
  const child = (0, import_node_child_process.spawn)(process.execPath, childArgs, {
    env: {
      ...process.env,
      CORRIJA_ME_CHILD_MODE: "check-worker"
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"]
  });
  child.on("message", (message) => {
    const jobId = message.id ?? -1;
    const pending = pendingWorkerJobs.get(jobId);
    if (!pending) {
      return;
    }
    pendingWorkerJobs.delete(jobId);
    if (message.ok) {
      if (!message.result) {
        pending.reject(new Error("Worker retornou resultado vazio."));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(message.error || "Falha ao processar analise."));
  });
  child.once("error", (error) => {
    checkWorkerProcess = null;
    rejectPendingWorkerJobs(error);
  });
  child.once("exit", (code) => {
    checkWorkerProcess = null;
    if (code !== 0 && pendingWorkerJobs.size) {
      rejectPendingWorkerJobs(new Error(`Worker finalizado com codigo ${code}.`));
    }
  });
  checkWorkerProcess = child;
  return child;
}
function runCheckInWorker(text) {
  return new Promise((resolve, reject) => {
    const jobId = ++workerSequence;
    pendingWorkerJobs.set(jobId, { resolve, reject });
    const child = ensureCheckWorker();
    child.send({ id: jobId, text });
  });
}
function runCheckInProcess(text) {
  if (!dictionaryResources) {
    throw new Error("Recursos do dicionario indisponiveis.");
  }
  return checkText(text, dictionaryResources.replacements, {
    words: dictionaryResources.words,
    dictionaryReady: dictionaryResources.dictionaryReady,
    contextRules: dictionaryResources.contextRules,
    phraseRules: dictionaryResources.phraseRules,
    linguisticData: dictionaryResources.linguisticData
  });
}
function createCorePayload(text, baseResult, correctedText, routing, llmMeta) {
  if (!correctedText || correctedText === text) {
    return {
      result: baseResult,
      baseResult,
      core: {
        enabled: llmCoreConfig.enabled,
        changed: false,
        routeReason: routing.reason,
        targetLayer: "motor",
        routing,
        ...llmMeta
      }
    };
  }
  return {
    result: {
      ...baseResult,
      matches: [buildWholeTextLlmMatch(text, correctedText, routing.reason)]
    },
    baseResult,
    core: {
      enabled: llmCoreConfig.enabled,
      changed: true,
      routeReason: routing.reason,
      targetLayer: "jandaia_1",
      routing,
      correctedText,
      ...llmMeta
    }
  };
}
async function runMotorFirstCoreFlow(text) {
  const startedAt = Date.now();
  const baseResult = isPackagedBinary ? runCheckInProcess(text) : await runCheckInWorker(text);
  const routing = decideLlmRouting(text, baseResult);
  const elapsedBeforeLlmMs = Date.now() - startedAt;
  const remainingBudgetMs = Math.max(0, llmCoreConfig.timeoutMs - elapsedBeforeLlmMs);
  if (!llmCoreConfig.enabled || !routing.shouldRoute) {
    return createCorePayload(text, baseResult, null, routing, {
      attempted: false,
      used: false,
      model: llmCoreConfig.model,
      budgetMs: llmCoreConfig.timeoutMs,
      remainingBudgetMs
    });
  }
  if (remainingBudgetMs < 250) {
    return createCorePayload(text, baseResult, null, routing, {
      attempted: false,
      used: false,
      model: llmCoreConfig.model,
      budgetMs: llmCoreConfig.timeoutMs,
      remainingBudgetMs,
      timedOut: true,
      error: "orcamento_esgotado_no_motor"
    });
  }
  try {
    const suggestion = await requestLlmCoreSuggestion(text, {
      ...llmCoreConfig,
      timeoutMs: remainingBudgetMs
    });
    return createCorePayload(text, baseResult, suggestion?.correctedText || null, routing, {
      attempted: true,
      used: Boolean(suggestion?.correctedText),
      latencyMs: suggestion?.latencyMs,
      model: suggestion?.model || llmCoreConfig.model,
      budgetMs: llmCoreConfig.timeoutMs,
      remainingBudgetMs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "llm_core_failed";
    return createCorePayload(text, baseResult, null, routing, {
      attempted: true,
      used: false,
      model: llmCoreConfig.model,
      error: message,
      timedOut: /aborted|abort|timeout/iu.test(message),
      budgetMs: llmCoreConfig.timeoutMs,
      remainingBudgetMs
    });
  }
}
async function runMotorOnlyFlow(text) {
  return isPackagedBinary ? runCheckInProcess(text) : runCheckInWorker(text);
}
if (isCheckWorkerProcess) {
  const workerResources = loadDictionaryResources(dataDir);
  process.on("message", (message) => {
    const jobId = message.id;
    if (!jobId || typeof message.text !== "string") {
      process.send?.({ id: jobId, ok: false, error: "Payload invalido para analise." });
      return;
    }
    try {
      const result = checkText(message.text, workerResources.replacements, {
        words: workerResources.words,
        dictionaryReady: workerResources.dictionaryReady,
        contextRules: workerResources.contextRules,
        phraseRules: workerResources.phraseRules,
        linguisticData: workerResources.linguisticData
      });
      process.send?.({ id: jobId, ok: true, result });
    } catch (error) {
      const workerError = error instanceof Error ? error.message : "Erro desconhecido";
      process.send?.({ id: jobId, ok: false, error: workerError });
    }
  });
} else {
  const server = (0, import_node_http.createServer)(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    if (request.method === "OPTIONS") {
      sendJson(response, 200, {});
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const llmHealth = llmCoreConfig.enabled ? await checkLlmCoreHealth(llmCoreConfig) : {
        reachable: false,
        model: llmCoreConfig.model,
        error: "disabled"
      };
      const jandaiaRuntime = await readJandaiaRuntimeReadiness(llmCoreConfig);
      sendJson(response, 200, {
        status: "ok",
        service: "corrija_me_pt_br_node",
        dictionary: {
          words: dictionaryResources?.words.size ?? 0,
          ready: dictionaryResources?.dictionaryReady ?? false,
          contextRules: dictionaryResources?.contextRules.length ?? 0,
          phraseRules: dictionaryResources?.phraseRules.length ?? 0,
          lexicalEntries: dictionaryResources?.linguisticData.lexicalEntries.size ?? 0,
          syntaxPatterns: dictionaryResources?.linguisticData.syntaxPatterns.length ?? 0
        },
        llmCore: {
          enabled: llmCoreConfig.enabled,
          ...llmHealth
        },
        jandaiaRuntime,
        architecture: RUNTIME_ARCHITECTURE
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v2/architecture") {
      const jandaiaRuntime = await readJandaiaRuntimeReadiness(llmCoreConfig);
      sendJson(response, 200, {
        status: "ok",
        runtime: RUNTIME_ARCHITECTURE,
        jandaia: jandaiaArchitectureProfile,
        jandaiaRuntime,
        llmCore: {
          enabled: llmCoreConfig.enabled,
          model: llmCoreConfig.model
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
      try {
        const result = await runMotorOnlyFlow(text);
        sendJson(response, 200, result);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao processar analise.";
        sendJson(response, 500, { error: message });
        return;
      }
    }
    if (request.method === "POST" && (url.pathname === "/v2/check-core" || url.pathname === "/v2/check-smart")) {
      const bodyChunks = [];
      for await (const chunk of request) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const { text, language } = parseBody(Buffer.concat(bodyChunks).toString("utf8"), request.headers["content-type"]);
      if ((language || "pt-BR") !== "pt-BR") {
        sendJson(response, 400, { error: "Somente pt-BR esta disponivel nesta versao." });
        return;
      }
      try {
        const payload = await runMotorFirstCoreFlow(text);
        sendJson(response, 200, {
          ...payload,
          runtime: {
            mode: "motor_first_with_budgeted_jandaia_fallback",
            first_barrier: "motor",
            fallback: "jandaia",
            serviceLevelBudgetMs: llmCoreConfig.timeoutMs,
            instructors: ["tucano_2", "quillbot"],
            director: "gemini",
            architectureProfile: jandaiaArchitectureProfile,
            routing: payload.core.routing
          }
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao processar analise.";
        sendJson(response, 500, { error: message });
        return;
      }
    }
    sendJson(response, 404, { error: "Rota nao encontrada." });
  });
  server.listen(DEFAULT_PORT, "127.0.0.1", () => {
    console.log(`corrija_me_pt_br backend local ativo em http://127.0.0.1:${DEFAULT_PORT}`);
  });
}
