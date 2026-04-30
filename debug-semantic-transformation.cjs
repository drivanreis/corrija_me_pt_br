// Debug da transformação dos matches semânticos para entender onde viram PT_BR_MULTI_PASS
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');
const { 
  createSemanticAnalysisMatches, 
  runInferencePipeline,
  createConsolidatedInferenceMatches,
  applyVisibleMatches
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

console.log("=== DEBUG DA TRANSFORMAÇÃO DE MATCHES ===");
console.log("Texto de entrada:", testText);

// 1. Teste da função isolada
console.log("\n1. Teste da função createSemanticAnalysisMatches isolada:");
try {
  const directMatches = createSemanticAnalysisMatches(testText, testDictionary);
  console.log("Matches diretos:", directMatches.length);
  directMatches.forEach((match, i) => {
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"} - ${match.message || "no-message"}`);
    console.log(`    Original: "${testText.substring(match.offset, match.offset + match.length)}"`);
    console.log(`    Replacement: "${match.replacements[0]?.value || "no-replacement"}"`);
  });
} catch (error) {
  console.error("Erro na função isolada:", error.message);
}

// 2. Teste do applyVisibleMatches
console.log("\n2. Teste do applyVisibleMatches:");
try {
  const semanticMatches = createSemanticAnalysisMatches(testText, testDictionary);
  console.log("Matches semânticos:", semanticMatches.length);
  
  if (semanticMatches.length > 0) {
    const appliedText = applyVisibleMatches(testText, semanticMatches);
    console.log("Texto original:", testText);
    console.log("Texto após aplicar matches:", appliedText);
    console.log("Texto mudou?", testText !== appliedText);
    
    // 3. Teste do createConsolidatedInferenceMatches
    console.log("\n3. Teste do createConsolidatedInferenceMatches:");
    const consolidatedMatches = createConsolidatedInferenceMatches(testText, appliedText);
    console.log("Matches consolidados:", consolidatedMatches.length);
    consolidatedMatches.forEach((match, i) => {
      console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"} - ${match.message || "no-message"}`);
      console.log(`    Original: "${testText.substring(match.offset, match.offset + match.length)}"`);
      console.log(`    Replacement: "${match.replacements[0]?.value || "no-replacement"}"`);
    });
  }
} catch (error) {
  console.error("Erro no applyVisibleMatches:", error.message);
}

// 4. Teste completo do pipeline com logging
console.log("\n4. Teste completo do pipeline:");
try {
  const pipelineResult = runInferencePipeline(testText, [], testDictionary);
  console.log("Matches do pipeline:", pipelineResult.matches.length);
  pipelineResult.matches.forEach((match, i) => {
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"} - ${match.message || "no-message"}`);
  });
} catch (error) {
  console.error("Erro no pipeline:", error.message);
}

console.log("\n=== FIM DO DEBUG ===");
