import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDictionaryWord } from "../core/text.js";
import type { ContextRuleDefinition, PhraseRuleDefinition, ReplacementEntry } from "../core/types.js";
import { loadLinguisticData } from "./linguistic-data.js";

export interface DictionaryResources {
  replacements: ReplacementEntry[];
  words: Set<string>;
  dictionaryReady: boolean;
  contextRules: ContextRuleDefinition[];
  phraseRules: PhraseRuleDefinition[];
  linguisticData: import("../core/types.js").LinguisticData;
}

function loadReplacementEntries(pathname: string): ReplacementEntry[] {
  return JSON.parse(readFileSync(pathname, "utf8")) as ReplacementEntry[];
}

function tokenizeReplacementText(value: string): string[] {
  return String(value || "").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*/gu) || [];
}

const AMBIGUOUS_HOMOPHONE_FAMILIES = [
  ["cessao", "sessao", "secao"],
  ["concerto", "conserto"],
  ["concertar", "consertar"],
  ["taxar", "tachar"],
  ["ratificar", "retificar"],
  ["infligir", "infringir"]
].map((family) => new Set(family.map((word) => normalizeDictionaryWord(word))));

function isAmbiguousHomophonePair(from: string, to: string): boolean {
  if (!from || !to || from === to) {
    return false;
  }

  return AMBIGUOUS_HOMOPHONE_FAMILIES.some((family) => family.has(from) && family.has(to));
}

function sanitizeReplacementEntries(entries: ReplacementEntry[]): ReplacementEntry[] {
  const symmetricPairs = new Set<string>();
  const directional = new Map<string, string>();

  for (const entry of entries) {
    const fromTokens = tokenizeReplacementText(entry.from).map((token) => normalizeDictionaryWord(token));
    const toTokens = Array.isArray(entry.replacements) && entry.replacements.length === 1
      ? tokenizeReplacementText(entry.replacements[0]).map((token) => normalizeDictionaryWord(token))
      : [];

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
    const toTokens = Array.isArray(entry.replacements) && entry.replacements.length === 1
      ? tokenizeReplacementText(entry.replacements[0]).map((token) => normalizeDictionaryWord(token))
      : [];

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

function loadOptionalReplacementEntries(pathname: string): ReplacementEntry[] {
  if (!existsSync(pathname)) {
    return [];
  }

  return sanitizeReplacementEntries(loadReplacementEntries(pathname));
}

function loadContextRules(pathname: string): ContextRuleDefinition[] {
  return JSON.parse(readFileSync(pathname, "utf8")) as ContextRuleDefinition[];
}

function loadPhraseRules(pathname: string): PhraseRuleDefinition[] {
  return JSON.parse(readFileSync(pathname, "utf8")) as PhraseRuleDefinition[];
}

function tokenizeRuleText(value: string): string[] {
  return String(value || "").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}\p{Pc}\p{Pd}]*/gu) || [];
}

function isUnsafeContinuousPhraseRule(rule: PhraseRuleDefinition): boolean {
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

function sanitizePhraseRules(rules: PhraseRuleDefinition[]): PhraseRuleDefinition[] {
  return rules.filter((rule) => !isUnsafeContinuousPhraseRule(rule));
}

function loadOptionalPhraseRules(pathname: string): PhraseRuleDefinition[] {
  if (!existsSync(pathname)) {
    return [];
  }

  return sanitizePhraseRules(loadPhraseRules(pathname));
}

function loadOptionalContextRules(pathname: string): ContextRuleDefinition[] {
  if (!existsSync(pathname)) {
    return [];
  }

  return loadContextRules(pathname);
}

export function loadDictionaryResources(dataDir: string): DictionaryResources {
  const replacements = sanitizeReplacementEntries([
    ...loadReplacementEntries(join(dataDir, "replacements.json")),
    ...loadOptionalReplacementEntries(join(dataDir, "replacements_learned.json"))
  ]);
  const rulesDir = join(dataDir, "rules");
  const linguisticData = loadLinguisticData(dataDir);

  const words = new Set<string>();

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

  const dictionaryReady = words.size >= 5_000;
  const contextRules = [
    ...loadContextRules(join(rulesDir, "context_rules.json")),
    ...loadOptionalContextRules(join(rulesDir, "context_rules_learned.json"))
  ];
  const phraseRules = [
    ...sanitizePhraseRules(loadPhraseRules(join(rulesDir, "phrase_rules.json"))),
    ...loadOptionalPhraseRules(join(rulesDir, "phrase_rules_seeded.json")),
    ...loadOptionalPhraseRules(join(rulesDir, "phrase_rules_continuous.json")),
    ...loadOptionalPhraseRules(join(rulesDir, "phrase_rules_learned.json"))
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
