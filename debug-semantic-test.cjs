// Teste da função createSemanticAnalysisMatches
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');
const { createSemanticAnalysisMatches } = require(serverPath);

// Teste da função
const testText = "Tem pão, fresco?";
const testDictionary = {};

console.log("=== TESTE DA FUNÇÃO createSemanticAnalysisMatches ===");
console.log("Texto de entrada:", testText);

try {
  const testMatches = createSemanticAnalysisMatches(testText, testDictionary);
  console.log("Matches encontrados:", testMatches.length);
  
  testMatches.forEach((match, i) => {
    console.log(`Match ${i + 1}:`);
    console.log(`  Rule: ${match.rule?.id || "no-id"}`);
    console.log(`  Message: ${match.message || "no-message"}`);
    console.log(`  Original: "${testText.substring(match.offset, match.offset + match.length)}"`);
    console.log(`  Replacement: ${match.replacements[0]?.value || "no-replacement"}`);
    console.log(`  Confidence: ${match.confidence?.level || "no-confidence"}`);
    console.log("");
  });
} catch (error) {
  console.error("Erro na função:", error.message);
  console.error("Stack:", error.stack);
}
