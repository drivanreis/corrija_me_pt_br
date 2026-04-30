// Script para corrigir o problema do createConsolidatedInferenceMatches
const fs = require('fs');
const path = require('path');

const serverPath = path.join(process.cwd(), 'build/node-app/backend/server.cjs');

console.log("=== CORRIGINDO PROBLEMA DO PIPELINE SEMÂNTICO ===");

// 1. Ler o arquivo atual
let serverContent = fs.readFileSync(serverPath, 'utf8');

// 2. Encontrar a função createConsolidatedInferenceMatches
const functionStart = serverContent.indexOf('function createConsolidatedInferenceMatches(originalText, finalText)');
if (functionStart === -1) {
  console.error("Função createConsolidatedInferenceMatches não encontrada!");
  process.exit(1);
}

// 3. Encontrar o final da função
const functionEnd = serverContent.indexOf('function applyVisibleMatches', functionStart);
if (functionEnd === -1) {
  console.error("Final da função createConsolidatedInferenceMatches não encontrado!");
  process.exit(1);
}

// 4. Extrair a função original
const originalFunction = serverContent.substring(functionStart, functionEnd);
console.log("Função original encontrada, tamanho:", originalFunction.length);

// 5. Criar a versão corrigida que preserva matches semânticos
const correctedFunction = `function createConsolidatedInferenceMatches(originalText, finalText) {
  const sanitizedFinalText = sanitizeInvalidWeekdayHyphenForms(finalText);
  if (originalText === sanitizedFinalText) {
    return [];
  }
  if (originalText === finalText) {
    return [];
  }
  
  // Verificar se temos matches semânticos que foram aplicados
  // Se sim, preservar os matches originais em vez de criar PT_BR_MULTI_PASS
  try {
    // Tentar obter os matches semânticos originais
    const semanticMatches = createSemanticAnalysisMatches(originalText, {});
    const appliedText = applyVisibleMatches(originalText, semanticMatches);
    
    // Se o texto aplicado corresponde ao texto final, preservar os matches semânticos
    if (appliedText === sanitizedFinalText && semanticMatches.length > 0) {
      console.log("Preservando matches semânticos originais");
      return semanticMatches;
    }
  } catch (error) {
    // Se falhar, continuar com o comportamento original
    console.log("Erro ao preservar matches semânticos, usando comportamento original:", error.message);
  }
  
  // Comportamento original para outros casos
  const diffMatches = createIterativeDiffMatches(originalText, sanitizedFinalText);
  if (!diffMatches.length) {
    return [createWholeTextInferenceMatch(originalText, sanitizedFinalText)];
  }
  const reconstructedText = applyVisibleMatches(originalText, diffMatches);
  if (reconstructedText !== sanitizedFinalText) {
    return [createWholeTextInferenceMatch(originalText, sanitizedFinalText)];
  }
  return diffMatches;
}`;

// 6. Substituir a função no arquivo
const newServerContent = serverContent.replace(originalFunction, correctedFunction);

// 7. Salvar o arquivo corrigido
fs.writeFileSync(serverPath, newServerContent, 'utf8');

console.log("✅ Função createConsolidatedInferenceMatches corrigida com sucesso!");
console.log("✅ Matches semânticos agora serão preservados em vez de transformados em PT_BR_MULTI_PASS");

console.log("\n=== FIM DA CORREÇÃO ===");
