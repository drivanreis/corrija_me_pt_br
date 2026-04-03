import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dictionaryDir = path.join(rootDir, "data", "dictionary");
const rulesDir = path.join(rootDir, "data", "rules");
const linguisticDir = path.join(rootDir, "data", "linguistic");

function normalizeWord(value) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function readWordsFile(filePath) {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/u)
    .map(normalizeWord)
    .filter((word) => word && !word.startsWith("#"));
}

async function main() {
  const wordsPath = path.join(dictionaryDir, "words_01.txt");
  const customWordsPath = path.join(dictionaryDir, "custom_words.txt");
  const rulesPath = path.join(rulesDir, "context_rules.json");
  const phraseRulesPath = path.join(rulesDir, "phrase_rules.json");
  const phraseRulesContinuousPath = path.join(rulesDir, "phrase_rules_continuous.json");
  const linguisticManifestPath = path.join(linguisticDir, "manifest.json");

  const words = await readWordsFile(wordsPath);
  const customWords = await readWordsFile(customWordsPath);
  const uniqueWords = new Set([...words, ...customWords]);

  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  if (!Array.isArray(rules)) {
    throw new Error("context_rules.json precisa ser um array JSON.");
  }

  const phraseRules = JSON.parse(await readFile(phraseRulesPath, "utf8"));
  if (!Array.isArray(phraseRules)) {
    throw new Error("phrase_rules.json precisa ser um array JSON.");
  }

  let phraseRulesContinuous = [];
  try {
    phraseRulesContinuous = JSON.parse(await readFile(phraseRulesContinuousPath, "utf8"));
    if (!Array.isArray(phraseRulesContinuous)) {
      throw new Error("phrase_rules_continuous.json precisa ser um array JSON.");
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const linguisticManifest = JSON.parse(await readFile(linguisticManifestPath, "utf8"));
  if (!linguisticManifest || typeof linguisticManifest !== "object") {
    throw new Error("data/linguistic/manifest.json precisa ser um objeto JSON.");
  }

  const errors = [];
  const ids = new Set();
  const lexicalFiles = Array.isArray(linguisticManifest.lexical) ? linguisticManifest.lexical : [];

  rules.forEach((rule, index) => {
    const prefix = `Regra #${index + 1}`;

    if (!rule || typeof rule !== "object") {
      errors.push(`${prefix}: item invalido.`);
      return;
    }

    if (!isNonEmptyString(rule.id)) {
      errors.push(`${prefix}: campo 'id' invalido.`);
    } else if (ids.has(rule.id)) {
      errors.push(`${prefix}: id duplicado '${rule.id}'.`);
    } else {
      ids.add(rule.id);
    }

    if (!Array.isArray(rule.pattern) || !rule.pattern.length || !rule.pattern.every(isNonEmptyString)) {
      errors.push(`${prefix}: campo 'pattern' invalido.`);
    }

    if (!Number.isInteger(rule.targetIndex) || rule.targetIndex < 0) {
      errors.push(`${prefix}: campo 'targetIndex' invalido.`);
    }

    if (!Array.isArray(rule.replacements) || !rule.replacements.every((entry) => typeof entry === "string")) {
      errors.push(`${prefix}: campo 'replacements' invalido.`);
    }

    if (!isNonEmptyString(rule.message)) {
      errors.push(`${prefix}: campo 'message' invalido.`);
    }

    if (!isNonEmptyString(rule.description)) {
      errors.push(`${prefix}: campo 'description' invalido.`);
    }
  });

  phraseRules.forEach((rule, index) => {
    const prefix = `Regra frasal #${index + 1}`;

    if (!rule || typeof rule !== "object") {
      errors.push(`${prefix}: item invalido.`);
      return;
    }

    if (!isNonEmptyString(rule.id)) {
      errors.push(`${prefix}: campo 'id' invalido.`);
    } else if (ids.has(rule.id)) {
      errors.push(`${prefix}: id duplicado '${rule.id}'.`);
    } else {
      ids.add(rule.id);
    }

    if (!Array.isArray(rule.pattern) || !rule.pattern.length || !rule.pattern.every(isNonEmptyString)) {
      errors.push(`${prefix}: campo 'pattern' invalido.`);
    }

    if (!Array.isArray(rule.replacements) || !rule.replacements.length || !rule.replacements.every(isNonEmptyString)) {
      errors.push(`${prefix}: campo 'replacements' invalido.`);
    }

    if (!isNonEmptyString(rule.message)) {
      errors.push(`${prefix}: campo 'message' invalido.`);
    }

    if (!isNonEmptyString(rule.description)) {
      errors.push(`${prefix}: campo 'description' invalido.`);
    }
  });

  phraseRulesContinuous.forEach((rule, index) => {
    const prefix = `Regra frasal contínua #${index + 1}`;

    if (!rule || typeof rule !== "object") {
      errors.push(`${prefix}: item invalido.`);
      return;
    }

    if (!isNonEmptyString(rule.id)) {
      errors.push(`${prefix}: campo 'id' invalido.`);
    } else if (ids.has(rule.id)) {
      errors.push(`${prefix}: id duplicado '${rule.id}'.`);
    } else {
      ids.add(rule.id);
    }

    if (!Array.isArray(rule.pattern) || !rule.pattern.length || !rule.pattern.every(isNonEmptyString)) {
      errors.push(`${prefix}: campo 'pattern' invalido.`);
    }

    if (!Array.isArray(rule.replacements) || !rule.replacements.length || !rule.replacements.every(isNonEmptyString)) {
      errors.push(`${prefix}: campo 'replacements' invalido.`);
    }

    if (!isNonEmptyString(rule.message)) {
      errors.push(`${prefix}: campo 'message' invalido.`);
    }

    if (!isNonEmptyString(rule.description)) {
      errors.push(`${prefix}: campo 'description' invalido.`);
    }
  });

  for (const fileName of lexicalFiles) {
    const filePath = path.join(linguisticDir, "Lexico", fileName);
    const entries = JSON.parse(await readFile(filePath, "utf8"));

    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      errors.push(`Lexico/${fileName}: arquivo precisa ser um objeto JSON.`);
      continue;
    }

    for (const [lemma, entry] of Object.entries(entries)) {
      const prefix = `Lexico/${fileName}:${lemma}`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`${prefix}: entrada invalida.`);
        continue;
      }

      if (!Array.isArray(entry.classes) || !entry.classes.length || !entry.classes.every(isNonEmptyString)) {
        errors.push(`${prefix}: campo 'classes' invalido.`);
      }

      if (entry.forms !== undefined && (!Array.isArray(entry.forms) || !entry.forms.every(isNonEmptyString))) {
        errors.push(`${prefix}: campo 'forms' invalido.`);
      }

      if (entry.autoCorrect !== undefined && !["allow", "blocked", "review"].includes(entry.autoCorrect)) {
        errors.push(`${prefix}: campo 'autoCorrect' invalido.`);
      }
    }
  }

  const allowedUnknownWords = JSON.parse(await readFile(path.join(linguisticDir, "Excecoes", "palavras_desconhecidas.json"), "utf8"));
  if (!allowedUnknownWords || typeof allowedUnknownWords !== "object" || Array.isArray(allowedUnknownWords)) {
    errors.push("Excecoes/palavras_desconhecidas.json precisa ser um objeto JSON.");
  } else {
    for (const [word, config] of Object.entries(allowedUnknownWords)) {
      const prefix = `Excecoes/palavras_desconhecidas.json:${word}`;
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        errors.push(`${prefix}: entrada invalida.`);
        continue;
      }

      if (!["permitido", "bloquear_autocorrecao"].includes(config.status)) {
        errors.push(`${prefix}: campo 'status' invalido.`);
      }
    }
  }

  const syntaxPatterns = JSON.parse(await readFile(path.join(linguisticDir, "Sintaxe", "padroes_basicos.json"), "utf8"));
  if (!Array.isArray(syntaxPatterns.patterns)) {
    errors.push("Sintaxe/padroes_basicos.json precisa conter um array em 'patterns'.");
  }

  console.log(`Palavras em words_01.txt: ${words.length}`);
  console.log(`Palavras em custom_words.txt: ${customWords.length}`);
  console.log(`Palavras unicas totais: ${uniqueWords.size}`);
  console.log(`Regras em context_rules.json: ${rules.length}`);
  console.log(`Regras em phrase_rules.json: ${phraseRules.length}`);
  console.log(`Regras em phrase_rules_continuous.json: ${phraseRulesContinuous.length}`);
  console.log(`Arquivos lexicais estruturados: ${lexicalFiles.length}`);

  if (errors.length) {
    console.error("");
    console.error("Erros encontrados:");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("Dados linguísticos validados com sucesso.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
