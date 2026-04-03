import { buildContext, createWordTokenPattern, dedupeStrings, normalizeDictionaryWord, preserveReplacementCase } from "./text.js";
import type { DictionaryData, LexicalEntry, RuleMatch } from "./types.js";

interface TokenMatch {
  value: string;
  normalized: string;
  offset: number;
  length: number;
}

interface SubjectCandidate {
  text: string;
  normalized: string;
  nextVerbIndex: number;
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

function getAgreementIndex(pessoa: number, numero: string): number | null {
  if (numero === "singular") {
    return pessoa >= 1 && pessoa <= 3 ? pessoa - 1 : null;
  }

  if (numero === "plural") {
    return pessoa >= 1 && pessoa <= 3 ? pessoa + 2 : null;
  }

  return null;
}

function createRegularExpectedForm(lemma: string, group: string, dictionary: DictionaryData, pessoa: number, numero: string): string | null {
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

function createIrregularExpectedForm(lemma: string, dictionary: DictionaryData, pessoa: number, numero: string): string | null {
  const paradigm = dictionary.linguisticData.irregularVerbs[normalizeDictionaryWord(lemma)];
  const agreementIndex = getAgreementIndex(pessoa, numero);
  const forms = paradigm?.presente;

  if (!forms || agreementIndex === null || !forms[agreementIndex]) {
    return null;
  }

  return forms[agreementIndex];
}

function getVerbExpectedForm(entry: LexicalEntry | undefined, dictionary: DictionaryData, pessoa: number, numero: string): string | null {
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

function getPresentTenseForms(entry: LexicalEntry | undefined, dictionary: DictionaryData): string[] {
  if (!entry?.lemma) {
    return [];
  }

  const normalizedLemma = normalizeDictionaryWord(entry.lemma);

  if (entry.irregular) {
    return (dictionary.linguisticData.irregularVerbs[normalizedLemma]?.presente || [])
      .map((value) => normalizeDictionaryWord(value));
  }

  if (!entry.grupo) {
    return [];
  }

  const forms: string[] = [];
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

function isLikelyPresentTenseForm(token: TokenMatch, entry: LexicalEntry | undefined, dictionary: DictionaryData): boolean {
  return getPresentTenseForms(entry, dictionary).includes(token.normalized);
}

function createAgreementMatch(text: string, token: TokenMatch, replacement: string, subject: string): RuleMatch {
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

function isSimpleVerbCandidate(token: TokenMatch, entry: LexicalEntry | undefined): boolean {
  return Boolean(
    entry
    && entry.classes.includes("verbo")
    && !token.normalized.includes("-")
  );
}

function isPreposition(token: TokenMatch | undefined, dictionary: DictionaryData): boolean {
  if (!token) {
    return false;
  }

  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
  return Boolean(lexicalEntry?.classes.includes("preposicao"));
}

function isAdverb(token: TokenMatch | undefined, dictionary: DictionaryData): boolean {
  if (!token) {
    return false;
  }

  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
  return Boolean(lexicalEntry?.classes.includes("adverbio"));
}

function isCliticPronoun(token: TokenMatch | undefined, dictionary: DictionaryData): boolean {
  if (!token) {
    return false;
  }

  const lexicalEntry = dictionary.linguisticData.lexicalEntries.get(token.normalized);
  return Boolean(
    lexicalEntry
    && lexicalEntry.classes.includes("pronome")
    && lexicalEntry.tags?.includes("clitico")
  );
}

function shouldSkipInfinitiveLikeContext(tokens: TokenMatch[], subjectIndex: number, verbToken: TokenMatch, verbEntry: LexicalEntry | undefined, dictionary: DictionaryData): boolean {
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

function resolveVerbIndex(tokens: TokenMatch[], subject: SubjectCandidate, dictionary: DictionaryData): number | null {
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

function resolveSubjectCandidate(tokens: TokenMatch[], index: number, dictionary: DictionaryData): SubjectCandidate | null {
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

export function createSimpleVerbalAgreementMatches(text: string, dictionary: DictionaryData): RuleMatch[] {
  const tokens = tokenizeText(text);
  const matches: RuleMatch[] = [];

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

    matches.push(createAgreementMatch(text, verbToken, expectedForm, subject.text));
  }

  return matches;
}
