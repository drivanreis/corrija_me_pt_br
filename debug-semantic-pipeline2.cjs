// Debug completo do pipeline de inferência passo a passo
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');
const { 
  createSemanticAnalysisMatches, 
  createInferenceStages, 
  runInferencePipeline,
  shouldExposeMatch,
  deriveMatchConfidence,
  finalizeMatches,
  collectVisibleStageMatches
} = require(serverPath);

// Teste da função isolada
const testText = "Tem pão, fresco?";
const testDictionary = {};

console.log("=== DEBUG COMPLETO DO PIPELINE ===");
console.log("Texto de entrada:", testText);

// 1. Teste da função isolada
console.log("\n1. Teste da função createSemanticAnalysisMatches isolada:");
try {
  const directMatches = createSemanticAnalysisMatches(testText, testDictionary);
  console.log("Matches diretos:", directMatches.length);
  directMatches.forEach((match, i) => {
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"}`);
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
    console.log(`\n  Estágio ${i + 1}: ${stage.id}`);
    console.log(`    Descrição: ${stage.description}`);
    
    try {
      const stageMatches = stage.collectMatches(testText);
      console.log(`    Matches brutos: ${stageMatches.length}`);
      
      // Testar shouldExposeMatch
      const exposedMatches = stageMatches.filter(match => shouldExposeMatch(match));
      console.log(`    Matches expostos: ${exposedMatches.length}`);
      
      // Testar collectVisibleStageMatches
      const visibleMatches = collectVisibleStageMatches(testText, testDictionary, stageMatches);
      console.log(`    Matches visíveis: ${visibleMatches.length}`);
      
      if (stage.id === "semantic_analysis") {
        console.log("    Detalhes dos matches semânticos:");
        stageMatches.forEach((match, j) => {
          console.log(`      Match ${j + 1}: ${match.rule?.id || "no-id"}`);
          console.log(`        shouldExpose: ${shouldExposeMatch(match)}`);
          console.log(`        replacements: ${match.replacements.length}`);
          console.log(`        confidence: ${JSON.stringify(match.confidence)}`);
        });
      }
    } catch (error) {
      console.error(`    Erro no estágio ${stage.id}:`, error.message);
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
    console.log(`  Match ${i + 1}: ${match.rule?.id || "no-id"}`);
  });
} catch (error) {
  console.error("Erro no pipeline:", error.message);
}

console.log("\n=== FIM DO DEBUG ===");
