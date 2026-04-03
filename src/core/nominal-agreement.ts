import { buildContext, createWordTokenPattern, dedupeStrings, normalizeDictionaryWord, preserveReplacementCase } from "./text.js";
import type { DictionaryData, LexicalEntry, RuleMatch } from "./types.js";

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

function isArticle(entry: LexicalEntry | undefined): boolean {
  return Boolean(entry?.classes.includes("artigo"));
}

function isDeterminer(entry: LexicalEntry | undefined): boolean {
  return Boolean(
    entry
    && (entry.classes.includes("artigo") || entry.classes.includes("pronome"))
    && entry.numero
  );
}

function isNoun(entry: LexicalEntry | undefined): boolean {
  return Boolean(entry?.classes.includes("substantivo"));
}

function isVariableAdjective(entry: LexicalEntry | undefined): boolean {
  return Boolean(
    entry?.classes.includes("adjetivo")
    && (entry?.variavel || (entry?.forms?.length || 0) > 1)
  );
}

function isLinkingVerb(entry: LexicalEntry | undefined): boolean {
  const lemma = normalizeDictionaryWord(entry?.lemma || "");
  return Boolean(entry?.classes.includes("verbo") && (lemma === "ser" || lemma === "estar"));
}

function isAttachmentVerb(entry: LexicalEntry | undefined): boolean {
  const lemma = normalizeDictionaryWord(entry?.lemma || "");
  return Boolean(entry?.classes.includes("verbo") && lemma === "seguir");
}

function inferNumber(word: string): "singular" | "plural" {
  return /s$/u.test(normalizeDictionaryWord(word)) ? "plural" : "singular";
}

function inferGender(word: string): "masculino" | "feminino" | null {
  const normalized = normalizeDictionaryWord(word);
  if (/(a|ã|as|ãs)$/u.test(normalized)) {
    return "feminino";
  }

  if (/(o|os)$/u.test(normalized)) {
    return "masculino";
  }

  return null;
}

function matchFormByTraits(forms: string[], targetGenero: string | null, targetNumero: string): string | null {
  const normalizedForms = Array.from(new Set(forms.map((value) => normalizeDictionaryWord(value)).filter(Boolean)));

  const exact = normalizedForms.find((candidate) => (
    inferNumber(candidate) === targetNumero
    && (!targetGenero || inferGender(candidate) === targetGenero || inferGender(candidate) === null)
  ));

  if (exact) {
    return exact;
  }

  const sameNumber = normalizedForms.find((candidate) => inferNumber(candidate) === targetNumero);
  return sameNumber || null;
}

function createNounPluralFromRules(base: string, dictionary: DictionaryData): string | null {
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

function getExpectedNounForm(entry: LexicalEntry | undefined, targetGenero: string | null, targetNumero: string, dictionary: DictionaryData): string | null {
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

function getExpectedAdjectiveForm(entry: LexicalEntry | undefined, targetGenero: string | null, targetNumero: string): string | null {
  if (!entry) {
    return null;
  }

  const forms = entry.forms?.length ? entry.forms : [entry.lemma || ""];
  return matchFormByTraits(forms, targetGenero, targetNumero);
}

function createAgreementMatch(text: string, token: TokenMatch, replacement: string, description: string): RuleMatch {
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

function createDeterminerNounMatches(text: string, tokens: TokenMatch[], dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

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

function createDeterminerNounAdjectiveMatches(text: string, tokens: TokenMatch[], dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

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

function createNounAdjectiveMatches(text: string, tokens: TokenMatch[], dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

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

function createNominalPredicateMatches(text: string, tokens: TokenMatch[], dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (let index = 0; index < tokens.length - 2; index += 1) {
    const firstToken = tokens[index];
    const secondToken = tokens[index + 1];
    const thirdToken = tokens[index + 2];
    const fourthToken = tokens[index + 3];

    const firstEntry = dictionary.linguisticData.lexicalEntries.get(firstToken?.normalized || "");
    const secondEntry = dictionary.linguisticData.lexicalEntries.get(secondToken?.normalized || "");
    const thirdEntry = dictionary.linguisticData.lexicalEntries.get(thirdToken?.normalized || "");
    const fourthEntry = dictionary.linguisticData.lexicalEntries.get(fourthToken?.normalized || "");

    if (
      firstToken
      && secondToken
      && thirdToken
      && isDeterminer(firstEntry)
      && isNoun(secondEntry)
      && isLinkingVerb(thirdEntry)
      && isVariableAdjective(dictionary.linguisticData.lexicalEntries.get(thirdToken.normalized)) === false
      && isVariableAdjective(fourthEntry)
      && fourthToken
    ) {
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

    if (
      firstToken
      && secondToken
      && thirdToken
      && isNoun(firstEntry)
      && isLinkingVerb(secondEntry)
      && isVariableAdjective(thirdEntry)
    ) {
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

function createExpandedNominalPredicateMatches(text: string, tokens: TokenMatch[], dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

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

    if (
      !determinerToken
      || !nounToken
      || !nounQualifierToken
      || !linkingVerbToken
      || !adjectiveToken
      || !isDeterminer(determinerEntry)
      || !isNoun(nounEntry)
      || !isVariableAdjective(nounQualifierEntry)
      || !isLinkingVerb(linkingVerbEntry)
      || !isVariableAdjective(adjectiveEntry)
    ) {
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

function createAttachmentPredicateMatches(text: string, tokens: TokenMatch[], dictionary: DictionaryData): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (let index = 0; index < tokens.length - 3; index += 1) {
    const verbToken = tokens[index];
    const adjectiveToken = tokens[index + 1];
    const determinerToken = tokens[index + 2];
    const nounToken = tokens[index + 3];

    const verbEntry = dictionary.linguisticData.lexicalEntries.get(verbToken?.normalized || "");
    const adjectiveEntry = dictionary.linguisticData.lexicalEntries.get(adjectiveToken?.normalized || "");
    const determinerEntry = dictionary.linguisticData.lexicalEntries.get(determinerToken?.normalized || "");
    const nounEntry = dictionary.linguisticData.lexicalEntries.get(nounToken?.normalized || "");

    if (
      !verbToken
      || !adjectiveToken
      || !determinerToken
      || !nounToken
      || !isAttachmentVerb(verbEntry)
      || !isVariableAdjective(adjectiveEntry)
      || !isDeterminer(determinerEntry)
      || !isNoun(nounEntry)
    ) {
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

export function createSimpleNominalAgreementMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  const tokens = tokenizeText(text);
  return [
    ...createDeterminerNounMatches(text, tokens, dictionary),
    ...createDeterminerNounAdjectiveMatches(text, tokens, dictionary),
    ...createNounAdjectiveMatches(text, tokens, dictionary),
    ...createNominalPredicateMatches(text, tokens, dictionary),
    ...createExpandedNominalPredicateMatches(text, tokens, dictionary),
    ...createAttachmentPredicateMatches(text, tokens, dictionary)
  ];
}
