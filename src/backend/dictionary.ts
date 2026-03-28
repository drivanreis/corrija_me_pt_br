import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDictionaryWord } from "../core/text.js";
import type { ReplacementEntry } from "../core/types.js";

interface CommonMistakeFileEntry {
  from: string;
  replacements: string[];
  description?: string;
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

export function loadDictionaryResources(dataDir: string): DictionaryResources {
  const replacements = loadReplacementEntries(join(dataDir, "replacements.json"));
  const dictionaryDir = join(dataDir, "dictionary");
  const dictionaryFiles = readdirSync(dictionaryDir)
    .filter((name) => /^words_\d+\.txt$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));

  const words = new Set<string>();
  for (const fileName of dictionaryFiles) {
    for (const word of loadWordList(join(dictionaryDir, fileName))) {
      words.add(word);
    }
  }

  for (const word of loadWordList(join(dictionaryDir, "custom_words.txt"))) {
    words.add(word);
  }

  const commonMistakes = loadCommonMistakeEntries(join(dictionaryDir, "common_mistakes.json"));
  const dictionaryReady = words.size >= 5_000;

  return {
    replacements,
    words,
    commonMistakes,
    dictionaryReady
  };
}
