// Debug completo da API para entender por que os matches não chegam
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');
const { 
  createSemanticAnalysisMatches, 
  runInferencePipeline,
  checkText
} = require(serverPath);

// Teste da função isolada
const testText = "Tem pão, fresco?";
const testDictionary = {
  phraseRules: [],
  contextRules: [],
  linguisticData: {
    lexicalEntries: new Map(),
    blockedAutoCorrections: new Set(),
    allowedUnknownWords: new Set(),
    locutions: new Map(),
    verbConjugationRules: {},
    nominalInflection: null,
    derivation: null,
    verbalAgreement: {},
    irregularVerbs: {},
    irregularPlurals: {},
    syntaxPatterns: []
  },
  words: new Set()
};

console.log("=== DEBUG COMPLETO DA API ===");
console.log("Texto de entrada:", testText);

// 1. Teste da função isolada
console.log("\n1. Teste da função createSemanticAnalysisMatches isolada:");
try {
  const directMatches = createSemanticAnalysisMatches(testText, testDictionary);
  console.log("Matches diretos:", directMatches.length);
  directMatches.forEach((match, i) => {
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"} - ${match.message || "no-message"}`);
  });
} catch (error) {
  console.error("Erro na função isolada:", error.message);
}

// 2. Teste do pipeline completo
console.log("\n2. Teste do pipeline completo:");
try {
  const pipelineResult = runInferencePipeline(testText, [], testDictionary);
  console.log("Matches do pipeline:", pipelineResult.matches.length);
  pipelineResult.matches.forEach((match, i) => {
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"} - ${match.message || "no-message"}`);
  });
} catch (error) {
  console.error("Erro no pipeline:", error.message);
}

// 3. Teste da função checkText (usada pela API)
console.log("\n3. Teste da função checkText:");
try {
  const checkResult = checkText(testText, [], testDictionary);
  console.log("Matches do checkText:", checkResult.matches.length);
  checkResult.matches.forEach((match, i) => {
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"} - ${match.message || "no-message"}`);
  });
} catch (error) {
  console.error("Erro em checkText:", error.message);
}

console.log("\n=== FIM DO DEBUG ===");
