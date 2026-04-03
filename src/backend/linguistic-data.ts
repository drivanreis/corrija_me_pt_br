import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeDictionaryWord } from "../core/text.js";
import type {
  AllowedUnknownWordEntry,
  BasicSyntaxPattern,
  DerivationRuleSet,
  LexicalEntry,
  LinguisticData,
  NominalInflectionRule,
  VerbConjugationRule,
  VerbalAgreementProfile
} from "../core/types.js";

interface LinguisticManifest {
  lexical?: string[];
  rules?: string[];
  agreement?: string[];
  irregularities?: string[];
  syntax?: string[];
  exceptions?: string[];
}

function readJsonFile<T>(pathname: string, fallback: T): T {
  if (!existsSync(pathname)) {
    return fallback;
  }

  return JSON.parse(readFileSync(pathname, "utf8")) as T;
}

function normalizeKey(value: string): string {
  return normalizeDictionaryWord(value);
}

function addLexicalEntries(target: Map<string, LexicalEntry>, source: Record<string, Partial<LexicalEntry>>): void {
  for (const [rawLemma, rawEntry] of Object.entries(source)) {
    const lemma = normalizeKey(rawLemma);
    if (!lemma) {
      continue;
    }

    const existing = target.get(lemma);
    const nextClasses = Array.isArray(rawEntry.classes)
      ? rawEntry.classes.filter(Boolean)
      : [];

    const merged: LexicalEntry = {
      lemma,
      classes: existing ? Array.from(new Set([...existing.classes, ...nextClasses])) : nextClasses,
      genero: rawEntry.genero ?? existing?.genero ?? null,
      numero: rawEntry.numero ?? existing?.numero ?? null,
      pessoa: rawEntry.pessoa ?? existing?.pessoa ?? null,
      grupo: rawEntry.grupo ?? existing?.grupo ?? null,
      irregular: rawEntry.irregular ?? existing?.irregular ?? false,
      variavel: rawEntry.variavel ?? existing?.variavel ?? false,
      autoCorrect: rawEntry.autoCorrect ?? existing?.autoCorrect ?? "allow",
      tags: Array.from(new Set([...(existing?.tags || []), ...((rawEntry.tags || []).filter(Boolean))])),
      forms: Array.from(new Set([...(existing?.forms || []), ...((rawEntry.forms || []).map(normalizeKey).filter(Boolean))])),
      notes: Array.from(new Set([...(existing?.notes || []), ...((rawEntry.notes || []).filter(Boolean))]))
    };

    target.set(lemma, merged);

    const aliases = new Set<string>([rawLemma, ...(merged.forms || [])]);
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

function loadLexicalEntries(baseDir: string, fileNames: string[]): Map<string, LexicalEntry> {
  const lexicalEntries = new Map<string, LexicalEntry>();

  for (const fileName of fileNames) {
    const pathname = join(baseDir, "Lexico", fileName);
    const content = readJsonFile<Record<string, Partial<LexicalEntry>>>(pathname, {});
    addLexicalEntries(lexicalEntries, content);
  }

  return lexicalEntries;
}

function loadAllowedUnknownWords(baseDir: string): {
  allowedUnknownWords: Set<string>;
  blockedAutoCorrections: Set<string>;
} {
  const entries = readJsonFile<Record<string, AllowedUnknownWordEntry>>(join(baseDir, "Excecoes", "palavras_desconhecidas.json"), {});
  const allowedUnknownWords = new Set<string>();
  const blockedAutoCorrections = new Set<string>();

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

function loadLocutions(baseDir: string): Map<string, string> {
  const content = readJsonFile<Record<string, string>>(join(baseDir, "Excecoes", "locucoes.json"), {});
  return new Map(
    Object.entries(content)
      .map(([key, value]) => [normalizeKey(key), value] as const)
      .filter(([key, value]) => key && typeof value === "string" && value.trim())
  );
}

function loadSyntaxPatterns(baseDir: string): BasicSyntaxPattern[] {
  const content = readJsonFile<{ patterns?: BasicSyntaxPattern[] }>(join(baseDir, "Sintaxe", "padroes_basicos.json"), { patterns: [] });
  return Array.isArray(content.patterns) ? content.patterns : [];
}

function loadVerbConjugation(baseDir: string): Record<string, VerbConjugationRule> {
  return readJsonFile<Record<string, VerbConjugationRule>>(join(baseDir, "Regras", "conjugacao_verbal.json"), {});
}

function loadNominalInflection(baseDir: string): NominalInflectionRule | null {
  return readJsonFile<NominalInflectionRule | null>(join(baseDir, "Regras", "flexao_nominal.json"), null);
}

function loadDerivation(baseDir: string): DerivationRuleSet | null {
  return readJsonFile<DerivationRuleSet | null>(join(baseDir, "Regras", "derivacao.json"), null);
}

function loadVerbalAgreement(baseDir: string): Record<string, VerbalAgreementProfile> {
  const content = readJsonFile<Record<string, VerbalAgreementProfile>>(join(baseDir, "Concordancia", "verbal.json"), {});
  return Object.fromEntries(
    Object.entries(content).map(([key, value]) => [normalizeKey(key), value])
  );
}

function loadIrregularVerbs(baseDir: string): Record<string, Record<string, string[]>> {
  return readJsonFile<Record<string, Record<string, string[]>>>(join(baseDir, "Irregularidades", "verbos_irregulares.json"), {});
}

function loadIrregularPlurals(baseDir: string): Record<string, string> {
  return readJsonFile<Record<string, string>>(join(baseDir, "Irregularidades", "plurais_irregulares.json"), {});
}

export function createEmptyLinguisticData(): LinguisticData {
  return {
    lexicalEntries: new Map<string, LexicalEntry>(),
    blockedAutoCorrections: new Set<string>(),
    allowedUnknownWords: new Set<string>(),
    locutions: new Map<string, string>(),
    verbConjugationRules: {},
    nominalInflection: null,
    derivation: null,
    verbalAgreement: {},
    irregularVerbs: {},
    irregularPlurals: {},
    syntaxPatterns: []
  };
}

export function loadLinguisticData(dataDir: string): LinguisticData {
  const baseDir = join(dataDir, "linguistic");
  if (!existsSync(baseDir)) {
    return createEmptyLinguisticData();
  }

  const manifest = readJsonFile<LinguisticManifest>(join(baseDir, "manifest.json"), {});
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
