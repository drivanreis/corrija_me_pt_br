import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDictionaryWord } from "../core/text.js";
import type { ContextRuleDefinition, PhraseRuleDefinition, ReplacementEntry } from "../core/types.js";
import { loadLinguisticData } from "./linguistic-data.js";

interface CommonMistakeFileEntry {
  from: string;
  replacements: string[];
  description?: string;
}

interface DictionaryManifest {
  wordFiles?: string[];
  customWordsFile?: string;
  commonMistakesFile?: string;
  useLegacyWordFiles?: boolean;
  useLegacyCustomWords?: boolean;
  useLegacyCommonMistakes?: boolean;
}

export interface DictionaryResources {
  replacements: ReplacementEntry[];
  words: Set<string>;
  commonMistakes: ReplacementEntry[];
  dictionaryReady: boolean;
  contextRules: ContextRuleDefinition[];
  phraseRules: PhraseRuleDefinition[];
  linguisticData: import("../core/types.js").LinguisticData;
}

function loadReplacementEntries(pathname: string): ReplacementEntry[] {
  return JSON.parse(readFileSync(pathname, "utf8")) as ReplacementEntry[];
}

function loadCommonMistakeEntries(pathname: string, existingReplacementEntries: ReplacementEntry[]): ReplacementEntry[] {
  const existingFrom = new Set(existingReplacementEntries.map((entry) => normalizeDictionaryWord(entry.from)));
  const entries = JSON.parse(readFileSync(pathname, "utf8")) as CommonMistakeFileEntry[];
  return entries
    .filter((entry) => !existingFrom.has(normalizeDictionaryWord(entry.from)))
    .map((entry) => ({
      from: entry.from,
      replacements: entry.replacements,
      source: entry.description?.trim() || "common_mistakes"
    }));
}

function loadWordList(pathname: string): string[] {
  return readFileSync(pathname, "utf8")
    .split(/\r?\n/u)
    .map(normalizeDictionaryWord)
    .filter((word) => word && !word.startsWith("#"));
}

function loadContextRules(pathname: string): ContextRuleDefinition[] {
  return JSON.parse(readFileSync(pathname, "utf8")) as ContextRuleDefinition[];
}

function loadPhraseRules(pathname: string): PhraseRuleDefinition[] {
  return JSON.parse(readFileSync(pathname, "utf8")) as PhraseRuleDefinition[];
}

function loadDictionaryManifest(dictionaryDir: string): DictionaryManifest | null {
  const manifestPath = join(dictionaryDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(manifestPath, "utf8")) as DictionaryManifest;
}

export function loadDictionaryResources(dataDir: string): DictionaryResources {
  const replacements = loadReplacementEntries(join(dataDir, "replacements.json"));
  const dictionaryDir = join(dataDir, "dictionary");
  const rulesDir = join(dataDir, "rules");
  const linguisticData = loadLinguisticData(dataDir);
  const manifest = loadDictionaryManifest(dictionaryDir);
  const useLegacyWordFiles = manifest?.useLegacyWordFiles ?? true;
  const useLegacyCustomWords = manifest?.useLegacyCustomWords ?? true;
  const useLegacyCommonMistakes = manifest?.useLegacyCommonMistakes ?? true;
  const dictionaryFiles = manifest?.wordFiles?.length
    ? [...manifest.wordFiles]
    : readdirSync(dictionaryDir)
      .filter((name) => /^words_\d+\.txt$/u.test(name))
      .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));

  const words = new Set<string>();
  if (useLegacyWordFiles) {
    for (const fileName of dictionaryFiles) {
      for (const word of loadWordList(join(dictionaryDir, fileName))) {
        words.add(word);
      }
    }
  }

  const customWordsFile = manifest?.customWordsFile || "custom_words.txt";
  if (useLegacyCustomWords) {
    for (const word of loadWordList(join(dictionaryDir, customWordsFile))) {
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
  const commonMistakes = useLegacyCommonMistakes
    ? loadCommonMistakeEntries(join(dictionaryDir, commonMistakesFile), replacements)
    : [];
  const dictionaryReady = words.size >= 5_000;
  const contextRules = loadContextRules(join(rulesDir, "context_rules.json"));
  const phraseRules = loadPhraseRules(join(rulesDir, "phrase_rules.json"));

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
