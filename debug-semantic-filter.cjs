// Debug do filtro shouldExposeMatch para entender por que os matches estão sendo filtrados
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');
const { createSemanticAnalysisMatches, shouldExposeMatch, deriveMatchConfidence } = require(serverPath);

// Teste da função isolada
const testText = "Tem pão, fresco?";
const testDictionary = {};

console.log("=== DEBUG DO FILTRO shouldExposeMatch ===");
console.log("Texto de entrada:", testText);

// 1. Obter matches brutos
console.log("\n1. Matches brutos da função createSemanticAnalysisMatches:");
try {
  const rawMatches = createSemanticAnalysisMatches(testText, testDictionary);
  console.log("Matches brutos:", rawMatches.length);
  
  rawMatches.forEach((match, i) => {
    console.log(`\n  Match ${i + 1}:`);
    console.log(`    Rule: ${match.rule?.id || "no-id"}`);
    console.log(`    Message: ${match.message || "no-message"}`);
    console.log(`    Original: "${testText.substring(match.offset, match.offset + match.length)}"`);
    console.log(`    Replacement: ${match.replacements[0]?.value || "no-replacement"}`);
    console.log(`    Replacements length: ${match.replacements.length}`);
    console.log(`    Confidence: ${JSON.stringify(match.confidence)}`);
    
    // Testar shouldExposeMatch
    const shouldExpose = shouldExposeMatch(match);
    console.log(`    shouldExposeMatch: ${shouldExpose}`);
    
    // Testar deriveMatchConfidence
    const derivedConfidence = deriveMatchConfidence(match, testText, testDictionary);
    console.log(`    derivedConfidence: ${JSON.stringify(derivedConfidence)}`);
  });
} catch (error) {
  console.error("Erro ao obter matches brutos:", error.message);
}

// 2. Testar shouldExposeMatch diretamente
console.log("\n2. Teste do filtro shouldExposeMatch:");
try {
  const matches = createSemanticAnalysisMatches(testText, testDictionary);
  const filteredMatches = matches.filter((match) => shouldExposeMatch(match));
  console.log(`Matches antes do filtro: ${matches.length}`);
  console.log(`Matches depois do filtro: ${filteredMatches.length}`);
  
  if (filteredMatches.length === 0 && matches.length > 0) {
    console.log("\n🚨 PROBLEMA IDENTIFICADO: shouldExposeMatch está filtrando todos os matches!");
    matches.forEach((match, i) => {
      console.log(`  Match ${i + 1} foi filtrado:`);
      console.log(`    Replacements: ${match.replacements.length}`);
      console.log(`    Confidence level: ${match.confidence?.level || "no-level"}`);
      console.log(`    Confidence score: ${match.confidence?.score || "no-score"}`);
    });
  }
} catch (error) {
  console.error("Erro no teste do filtro:", error.message);
}

console.log("\n=== FIM DO DEBUG ===");
