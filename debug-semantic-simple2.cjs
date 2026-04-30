// Debug simplificado do problema do pipeline
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');
const { createSemanticAnalysisMatches } = require(serverPath);

// Teste da função isolada
const testText = "Tem pão, fresco?";
const testDictionary = {};

console.log("=== DEBUG SIMPLIFICADO ===");
console.log("Texto de entrada:", testText);

// 1. Teste da função isolada
console.log("\n1. Teste da função createSemanticAnalysisMatches isolada:");
try {
  const directMatches = createSemanticAnalysisMatches(testText, testDictionary);
  console.log("Matches diretos:", directMatches.length);
  directMatches.forEach((match, i) => {
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"}`);
    console.log(`    Message: ${match.message || "no-message"}`);
    console.log(`    Original: "${testText.substring(match.offset, match.offset + match.length)}"`);
    console.log(`    Replacement: ${match.replacements[0]?.value || "no-replacement"}`);
    console.log(`    Confidence: ${match.confidence?.level || "no-confidence"}`);
  });
} catch (error) {
  console.error("Erro na função isolada:", error.message);
}

// 2. Teste com diferentes textos
const testCases = [
  "Tem pão, fresco?",
  "Vamos comer crianças!",
  "Não espere.",
  "Bora comer gente?",
  "Não quero sair com você."
];

console.log("\n2. Teste com múltiplos casos:");
testCases.forEach((testCase, i) => {
  try {
    const matches = createSemanticAnalysisMatches(testCase, testDictionary);
    console.log(`  Caso ${i + 1}: "${testCase}" -> ${matches.length} matches`);
    matches.forEach((match, j) => {
      console.log(`    Match ${j + 1}: ${match.rule?.id || "no-id"}`);
    });
  } catch (error) {
    console.error(`  Erro no caso ${i + 1}:`, error.message);
  }
});

console.log("\n=== FIM DO DEBUG ===");
