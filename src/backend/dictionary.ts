import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDictionaryWord } from "../core/text.js";
import type { ReplacementEntry } from "../core/types.js";

interface CommonMistakeFileEntry {
  from: string;
  replacements: string[];
  description?: string;
}

interface DictionaryManifest {
  wordFiles?: string[];
  customWordsFile?: string;
  commonMistakesFile?: string;
}

export interface DictionaryResources {
  replacements: ReplacementEntry[];
  words: Set<string>;
  commonMistakes: ReplacementEntry[];
  dictionaryReady: boolean;
}

function loadReplacementEntries(pathname: string): ReplacementEntry[] {
  return JSON.parse(readFileSync(pathname, "utf8")) as ReplacementEntry[];
}

function loadCommonMistakeEntries(pathname: string): ReplacementEntry[] {
  const entries = JSON.parse(readFileSync(pathname, "utf8")) as CommonMistakeFileEntry[];
  return entries.map((entry) => ({
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
  const manifest = loadDictionaryManifest(dictionaryDir);
  const dictionaryFiles = manifest?.wordFiles?.length
    ? [...manifest.wordFiles]
    : readdirSync(dictionaryDir)
      .filter((name) => /^words_\d+\.txt$/u.test(name))
      .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));

  const words = new Set<string>();
  for (const fileName of dictionaryFiles) {
    for (const word of loadWordList(join(dictionaryDir, fileName))) {
      words.add(word);
    }
  }

  const customWordsFile = manifest?.customWordsFile || "custom_words.txt";
  for (const word of loadWordList(join(dictionaryDir, customWordsFile))) {
    words.add(word);
  }

  const commonMistakesFile = manifest?.commonMistakesFile || "common_mistakes.json";
  const commonMistakes = loadCommonMistakeEntries(join(dictionaryDir, commonMistakesFile));
  const dictionaryReady = words.size >= 5_000;

  return {
    replacements,
    words,
    commonMistakes,
    dictionaryReady
  };
}
