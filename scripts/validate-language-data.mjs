import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dictionaryDir = path.join(rootDir, "data", "dictionary");
const rulesDir = path.join(rootDir, "data", "rules");

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

  const words = await readWordsFile(wordsPath);
  const customWords = await readWordsFile(customWordsPath);
  const uniqueWords = new Set([...words, ...customWords]);

  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  if (!Array.isArray(rules)) {
    throw new Error("context_rules.json precisa ser um array JSON.");
  }

  const errors = [];
  const ids = new Set();

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

  console.log(`Palavras em words_01.txt: ${words.length}`);
  console.log(`Palavras em custom_words.txt: ${customWords.length}`);
  console.log(`Palavras unicas totais: ${uniqueWords.size}`);
  console.log(`Regras em context_rules.json: ${rules.length}`);

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
