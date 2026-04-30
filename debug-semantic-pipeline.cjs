// Debug do pipeline de inferência para entender por que os matches não estão aparecendo
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');
const { createSemanticAnalysisMatches, runInferencePipeline, createInferenceStages } = require(serverPath);

// Teste da função isolada
const testText = "Tem pão, fresco?";
const testDictionary = {};

console.log("=== DEBUG DO PIPELINE DE INFERÊNCIA ===");
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

// 2. Teste dos estágios do pipeline
console.log("\n2. Teste dos estágios do pipeline:");
try {
  const stages = createInferenceStages([], testDictionary);
  console.log("Estados encontrados:", stages.length);
  
  stages.forEach((stage, i) => {
    console.log(`  Estágio ${i + 1}: ${stage.id} - ${stage.description}`);
    const stageMatches = stage.collectMatches(testText);
    console.log(`    Matches: ${stageMatches.length}`);
    if (stage.id === "semantic_analysis") {
      stageMatches.forEach((match, j) => {
        console.log(`      Match ${j + 1}: ${match.rule?.id || "no-id"} - ${match.message || "no-message"}`);
      });
    }
  });
} catch (error) {
  console.error("Erro nos estágios:", error.message);
}

// 3. Teste do pipeline completo
console.log("\n3. Teste do pipeline completo:");
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
