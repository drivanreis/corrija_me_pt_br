import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dictionaryDir = path.join(rootDir, "data", "dictionary");
const linguisticDir = path.join(rootDir, "data", "linguistic");
const migrationDir = path.join(linguisticDir, "migration");

function normalizeWord(value) {
  return value.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const manualClassifications = {
  "foque": {
    target_file: "Lexico/verbos.json",
    entry: {
      classes: ["verbo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar", "imperativo_ou_subjuntivo"]
    },
    confidence: "media"
  },
  "cheque": {
    target_file: "Lexico/substantivos_uso_recorrente.json",
    entry: {
      classes: ["substantivo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence: "media"
  },
  "xeque": {
    target_file: "Lexico/substantivos_uso_recorrente.json",
    entry: {
      classes: ["substantivo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence: "media"
  },
  "voo": {
    target_file: "Lexico/substantivos_uso_recorrente.json",
    entry: {
      classes: ["substantivo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence: "media"
  },
  "solicito": {
    target_file: "Lexico/verbos.json",
    entry: {
      classes: ["verbo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar", "forma_flexionada"]
    },
    confidence: "alta"
  },
  "domicílio": {
    target_file: "Lexico/substantivos_uso_recorrente.json",
    entry: {
      classes: ["substantivo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence: "alta"
  },
  "informamos": {
    target_file: "Lexico/verbos.json",
    entry: {
      classes: ["verbo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar", "forma_flexionada"]
    },
    confidence: "alta"
  },
  "conosco": {
    target_file: "Lexico/pronomes.json",
    entry: {
      classes: ["pronome"],
      tags: ["migrado_do_legado", "revisar", "obliquo_tonico"]
    },
    confidence: "alta"
  },
  "vossa": {
    target_file: "Lexico/pronomes.json",
    entry: {
      classes: ["pronome"],
      tags: ["migrado_do_legado", "revisar", "possessivo_tratamento"]
    },
    confidence: "alta"
  },
  "senhoria": {
    target_file: "Lexico/substantivos_uso_recorrente.json",
    entry: {
      classes: ["substantivo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar", "tratamento_formal"]
    },
    confidence: "media"
  }
};

const adjectiveCandidatePatterns = [
  /^semi.+/u
];

function buildVerbCandidate(confidence = "media") {
  return {
    target_file: "Lexico/verbos.json",
    entry: {
      classes: ["verbo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence
  };
}

function buildNounCandidate(confidence = "baixa") {
  return {
    target_file: "Lexico/substantivos_uso_recorrente.json",
    entry: {
      classes: ["substantivo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence
  };
}

function buildAdjectiveCandidate(confidence = "media") {
  return {
    target_file: "Lexico/adjetivos_uso_recorrente.json",
    entry: {
      classes: ["adjetivo"],
      autoCorrect: "review",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence
  };
}

function classifyCustomWord(word) {
  if (manualClassifications[word]) {
    return manualClassifications[word];
  }

  if (/[_.-]/u.test(word) || /[A-Z]/u.test(word)) {
    return {
      target_file: "Lexico/termos_tecnicos.json",
      entry: {
        classes: ["termo_tecnico"],
        autoCorrect: "blocked",
        tags: ["migrado_do_legado", "revisar"]
      },
      confidence: "media"
    };
  }

  if (adjectiveCandidatePatterns.some((pattern) => pattern.test(word))) {
    return buildAdjectiveCandidate("media");
  }

  if (/(ar|er|ir)$/u.test(word)) {
    return buildVerbCandidate("media");
  }

  if (/(amos|emos|imos)$/u.test(word)) {
    return {
      ...buildVerbCandidate("media"),
      entry: {
        classes: ["verbo"],
        autoCorrect: "review",
        tags: ["migrado_do_legado", "revisar", "forma_flexionada"]
      }
    };
  }

  if (/(a|as|o|os)$/u.test(word)) {
    return buildNounCandidate("baixa");
  }

  return {
    target_file: "Excecoes/palavras_desconhecidas.json",
    entry: {
      status: "permitido",
      tags: ["migrado_do_legado", "revisar"]
    },
    confidence: "baixa"
  };
}

async function readWordsFile(filePath) {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/u)
    .map(normalizeWord)
    .filter((word) => word && !word.startsWith("#"));
}

async function loadLexicalManifest() {
  const manifest = JSON.parse(await readFile(path.join(linguisticDir, "manifest.json"), "utf8"));
  return Array.isArray(manifest.lexical) ? manifest.lexical : [];
}

async function loadExistingLexicalEntries() {
  const lexicalFiles = await loadLexicalManifest();
  const existing = new Set();

  for (const fileName of lexicalFiles) {
    const filePath = path.join(linguisticDir, "Lexico", fileName);
    const content = JSON.parse(await readFile(filePath, "utf8"));
    for (const [key, entry] of Object.entries(content)) {
      existing.add(normalizeWord(key));
      if (entry && typeof entry === "object" && Array.isArray(entry.forms)) {
        for (const form of entry.forms) {
          if (isNonEmptyString(form)) {
            existing.add(normalizeWord(form));
          }
        }
      }
    }
  }

  return existing;
}

async function loadAllowedUnknownWords() {
  const filePath = path.join(linguisticDir, "Excecoes", "palavras_desconhecidas.json");
  const content = JSON.parse(await readFile(filePath, "utf8"));
  return new Set(Object.keys(content).map(normalizeWord));
}

async function loadExistingReplacements() {
  const filePath = path.join(rootDir, "data", "replacements.json");
  const content = JSON.parse(await readFile(filePath, "utf8"));

  return new Set(
    Array.isArray(content)
      ? content
        .filter((entry) => entry && isNonEmptyString(entry.from))
        .map((entry) => normalizeWord(entry.from))
      : []
  );
}

async function loadCommonMistakes() {
  const filePath = path.join(dictionaryDir, "common_mistakes.json");
  const content = JSON.parse(await readFile(filePath, "utf8"));

  return Array.isArray(content)
    ? content
      .filter((entry) => entry && isNonEmptyString(entry.from) && Array.isArray(entry.replacements))
      .map((entry) => ({
        from: normalizeWord(entry.from),
        replacements: entry.replacements.map(normalizeWord).filter(Boolean),
        description: isNonEmptyString(entry.description) ? entry.description.trim() : "sem_descricao"
      }))
    : [];
}

async function main() {
  await mkdir(migrationDir, { recursive: true });

  const customWords = await readWordsFile(path.join(dictionaryDir, "custom_words.txt"));
  const commonMistakes = await loadCommonMistakes();
  const existingLexicalEntries = await loadExistingLexicalEntries();
  const allowedUnknownWords = await loadAllowedUnknownWords();
  const existingReplacements = await loadExistingReplacements();

  const lexicalCandidates = [];
  const exceptionCandidates = [];
  const skippedCustomWords = [];

  for (const word of customWords) {
    if (existingLexicalEntries.has(word) || allowedUnknownWords.has(word)) {
      skippedCustomWords.push({
        word,
        reason: "ja_coberto_na_base_estruturada"
      });
      continue;
    }

    const classified = classifyCustomWord(word);
    const candidate = {
      source: "data/dictionary/custom_words.txt",
      word,
      confidence: classified.confidence,
      target_file: classified.target_file,
      entry: classified.entry
    };

    if (classified.target_file.startsWith("Excecoes/")) {
      exceptionCandidates.push(candidate);
    } else {
      lexicalCandidates.push(candidate);
    }
  }

  const replacementCandidates = commonMistakes
    .filter((entry) => entry.replacements.length && !existingReplacements.has(entry.from))
    .map((entry) => ({
      source: "data/dictionary/common_mistakes.json",
      from: entry.from,
      replacements: entry.replacements,
      description: entry.description,
      suggested_lemma: entry.replacements[0],
      confidence: "media"
    }));

  const summary = {
    generated_at: new Date().toISOString(),
    custom_words_total: customWords.length,
    common_mistakes_total: commonMistakes.length,
    lexical_candidates: lexicalCandidates.length,
    exception_candidates: exceptionCandidates.length,
    replacement_candidates: replacementCandidates.length,
    skipped_custom_words: skippedCustomWords.length
  };

  await writeFile(
    path.join(migrationDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`
  );

  await writeFile(
    path.join(migrationDir, "lexical_candidates.json"),
    `${JSON.stringify(lexicalCandidates, null, 2)}\n`
  );

  await writeFile(
    path.join(migrationDir, "exception_candidates.json"),
    `${JSON.stringify(exceptionCandidates, null, 2)}\n`
  );

  await writeFile(
    path.join(migrationDir, "replacement_candidates.json"),
    `${JSON.stringify(replacementCandidates, null, 2)}\n`
  );

  await writeFile(
    path.join(migrationDir, "skipped_custom_words.json"),
    `${JSON.stringify(skippedCustomWords, null, 2)}\n`
  );

  console.log("Migracao inicial do legado concluida.");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
