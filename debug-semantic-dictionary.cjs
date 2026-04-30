// Debug do dictionary para entender por que está indefinido
const serverPath = require('path').join(process.cwd(), 'build/node-app/backend/server.cjs');

// Testar se o dicionário está sendo carregado corretamente
console.log("=== DEBUG DO DICTIONARY ===");

// 1. Verificar se podemos carregar o servidor
try {
  const server = require(serverPath);
  console.log("Servidor carregado com sucesso");
  
  // 2. Tentar acessar funções que usam dictionary
  console.log("\n2. Testando funções que dependem de dictionary:");
  
  // Criar um dictionary mínimo para teste
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
  
  console.log("Dictionary de teste criado:", Object.keys(testDictionary));
  
  // 3. Testar createPhraseRuleMatches com dictionary vazio
  try {
    const { createPhraseRuleMatches } = server;
    const phraseMatches = createPhraseRuleMatches("Teste", testDictionary.phraseRules);
    console.log("createPhraseRuleMatches funcionou:", phraseMatches.length, "matches");
  } catch (error) {
    console.error("Erro em createPhraseRuleMatches:", error.message);
  }
  
  // 4. Testar createSimpleVerbalAgreementMatches com dictionary vazio
  try {
    const { createSimpleVerbalAgreementMatches } = server;
    const verbalMatches = createSimpleVerbalAgreementMatches("Teste", testDictionary);
    console.log("createSimpleVerbalAgreementMatches funcionou:", verbalMatches.length, "matches");
  } catch (error) {
    console.error("Erro em createSimpleVerbalAgreementMatches:", error.message);
  }
  
  // 5. Testar createInferenceStages com dictionary vazio
  try {
    const { createInferenceStages } = server;
    const stages = createInferenceStages([], testDictionary);
    console.log("createInferenceStages funcionou:", stages.length, "estágios");
    
    // Testar cada estágio
    stages.forEach((stage, i) => {
      try {
        const matches = stage.collectMatches("Teste");
        console.log(`  Estágio ${i + 1} (${stage.id}): ${matches.length} matches`);
      } catch (error) {
        console.error(`  Erro no estágio ${stage.id}:`, error.message);
      }
    });
  } catch (error) {
    console.error("Erro em createInferenceStages:", error.message);
  }
  
} catch (error) {
  console.error("Erro ao carregar servidor:", error.message);
}

console.log("\n=== FIM DO DEBUG ===");
