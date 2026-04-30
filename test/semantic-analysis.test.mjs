import fetch from 'node-fetch';

// Configuração do servidor
const SERVER_URL = 'http://127.0.0.1:18081';
const SERVER_PORT = 18081;

// Casos de teste de ambiguidade semântica
const semanticTestCases = [
  {
    input: "Tem pão, fresco?",
    expected: "Tem pão fresco?",
    description: "Vocativo 'fresco' (gíria pejorativa) vs adjetivo",
    shouldHaveExplanation: true
  },
  {
    input: "Vamos comer crianças!",
    expected: "Vamos comer, crianças!",
    description: "Canibalismo vs chamado para crianças comerem",
    shouldHaveExplanation: true
  },
  {
    input: "Não espere.",
    expected: "Não, espere.",
    description: "Ordem para não esperar vs pedido para esperar",
    shouldHaveExplanation: true
  },
  {
    input: "Se o homem soubesse o valor que tem a mulher, andaria de quatro à sua procura.",
    expected: "Se o homem soubesse o valor que tem, a mulher, andaria de quatro à sua procura.",
    description: "Valor do homem vs valor da mulher",
    shouldHaveExplanation: true
  },
  {
    input: "Esse juiz, corrupto, deve ser afastado.",
    expected: "Esse juiz corrupto deve ser afastado.",
    description: "Juiz específico corrupto vs juízes corruptos em geral",
    shouldHaveExplanation: true
  },
  {
    input: "Maria, não vá!",
    expected: "Maria não vá!",
    description: "Chamado direto vs ordem confusa",
    shouldHaveExplanation: true
  },
  {
    input: "Só ele resolveu o problema.",
    expected: "Só, ele resolveu o problema.",
    description: "Exclusividade vs estranheza com vírgula",
    shouldHaveExplanation: true
  },
  {
    input: "Quem trabalha, vence.",
    expected: "Quem trabalha vence.",
    description: "Regra geral vs afirmação direta",
    shouldHaveExplanation: true
  },
  // Casos adicionais dos exemplos do usuário
  {
    input: "Bora comer gente?",
    expected: "Bora comer, gente?",
    description: "Pedido suspeito vs chamado para comer",
    shouldHaveExplanation: true
  },
  {
    input: "Não quero sair com você.",
    expected: "Não, quero sair com você.",
    description: "Recusa direta vs sentido completamente alterado",
    shouldHaveExplanation: true
  },
  {
    input: "Pode esperar.",
    expected: "Pode, esperar.",
    description: "Permissão para esperar vs duas ideias quebradas",
    shouldHaveExplanation: true
  },
  {
    input: "Se quiser terminar comigo tudo bem.",
    expected: "Se quiser terminar comigo, tudo bem.",
    description: "Aceitação vs frase confusa",
    shouldHaveExplanation: true
  },
  {
    input: "Vamos produzir pessoal.",
    expected: "Vamos produzir, pessoal.",
    description: "Chamado estranho vs chamado para equipe",
    shouldHaveExplanation: true
  },
  {
    input: "Me vê um café, grande?",
    expected: "Me vê um café grande?",
    description: "Pedido com dúvida vs pedido direto",
    shouldHaveExplanation: true
  },
  {
    input: "Calma cara.",
    expected: "Calma, cara.",
    description: "Tom seco vs tom natural",
    shouldHaveExplanation: true
  },
  {
    input: "Você é incrível sério.",
    expected: "Você é incrível, sério.",
    description: "Elogio embolado vs reforço do elogio",
    shouldHaveExplanation: true
  },
  {
    input: "Vamos sair hoje?",
    expected: "Vamos sair, hoje?",
    description: "Normal vs pausa estranha sobre 'hoje'",
    shouldHaveExplanation: true
  },
  {
    input: "Já resolvi seu problema cliente.",
    expected: "Já resolvi seu problema, cliente.",
    description: "Robótico vs direto",
    shouldHaveExplanation: true
  },
  {
    input: "Não podemos atender seu pedido.",
    expected: "Não, podemos atender seu pedido.",
    description: "Recusa seca vs confirmação",
    shouldHaveExplanation: true
  },
  {
    input: "Resolva isso agora cliente.",
    expected: "Resolva isso agora, cliente.",
    description: "Mandão vs correto",
    shouldHaveExplanation: true
  },
  {
    input: "O erro foi do sistema interno.",
    expected: "O erro foi do sistema, interno.",
    description: "Assume responsabilidade vs frase estranha",
    shouldHaveExplanation: true
  },
  {
    input: "Se não pagar será negativado.",
    expected: "Se não pagar, será negativado.",
    description: "Ameaça direta vs correto formal",
    shouldHaveExplanation: true
  },
  {
    input: "Vamos cancelar o pedido do cliente inadimplente.",
    expected: "Vamos cancelar o pedido do cliente, inadimplente.",
    description: "Cliente específico vs chamando cliente de inadimplente",
    shouldHaveExplanation: true
  },
  {
    input: "Prezados clientes informamos que houve instabilidade.",
    expected: "Prezados clientes, informamos que houve instabilidade.",
    description: "Desorganizado vs padrão profissional",
    shouldHaveExplanation: true
  },
  {
    input: "Pode liberar o acesso não bloqueie.",
    expected: "Pode liberar o acesso, não bloqueie.",
    description: "Instrução confusa vs clara",
    shouldHaveExplanation: true
  },
  {
    input: "Entendo sua frustração senhor.",
    expected: "Entendo sua frustração, senhor.",
    description: "Frio/robotizado vs mais humano",
    shouldHaveExplanation: true
  },
  {
    input: "Vamos entregar hoje não amanhã.",
    expected: "Vamos entregar hoje, não amanhã.",
    description: "Confuso vs definição clara",
    shouldHaveExplanation: true
  },
  {
    input: "O cliente que não pagar será excluído.",
    expected: "O cliente, que não pagar, será excluído.",
    description: "Especifico vs sugere que todos serão excluídos",
    shouldHaveExplanation: true
  }
];

// Função para iniciar o servidor
async function startServer() {
  console.log('Iniciando servidor de teste...');
  
  try {
    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      const serverProcess = spawn('node', ['build/node-app/backend/server.cjs'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd()
      });
      
      let output = '';
      serverProcess.stdout.on('data', (data) => {
        output += data.toString();
        if (output.includes('Server running on port')) {
          console.log('Servidor iniciado com sucesso');
          resolve(serverProcess);
        }
      });
      
      serverProcess.stderr.on('data', (data) => {
        console.error('Erro no servidor:', data.toString());
      });
      
      serverProcess.on('error', (error) => {
        console.error('Falha ao iniciar servidor:', error);
        reject(error);
      });
      
      // Timeout de 10 segundos
      setTimeout(() => {
        console.log('Timeout ao iniciar servidor');
        serverProcess.kill();
        reject(new Error('Timeout ao iniciar servidor'));
      }, 10000);
    });
  } catch (error) {
    console.error('Erro ao importar spawn:', error);
    throw error;
  }
}

// Função para parar o servidor
function stopServer(serverProcess) {
  if (serverProcess) {
    serverProcess.kill();
    console.log('Servidor parado');
  }
}

// Função para enviar texto para correção
async function correctText(text) {
  try {
    const response = await fetch(`${SERVER_URL}/correct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Erro ao corrigir texto:', error);
    throw error;
  }
}

// Função para aplicar correções
function applyCorrections(originalText, matches) {
  if (!matches || matches.length === 0) return originalText;

  let correctedText = originalText;
  let offset = 0;

  // Ordenar matches por offset (do fim para o início para não deslocar índices)
  const sortedMatches = matches.sort((a, b) => b.offset - a.offset);

  for (const match of sortedMatches) {
    const start = match.offset + offset;
    const end = start + match.length;
    
    if (match.replacements && match.replacements.length > 0) {
      const replacement = match.replacements[0].value;
      correctedText = correctedText.substring(0, start) + replacement + correctedText.substring(end);
      offset += replacement.length - match.length;
    }
  }

  return correctedText;
}

// Função principal de teste
async function runSemanticTests() {
  let serverProcess = null;
  
  try {
    // Iniciar servidor
    serverProcess = await startServer();
    
    // Esperar um pouco para o servidor estabilizar
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n=== INICIANDO TESTES DE ANÁLISE SEMÂNTICA ===\n');
    
    let passedTests = 0;
    let totalTests = semanticTestCases.length;
    
    for (let i = 0; i < semanticTestCases.length; i++) {
      const testCase = semanticTestCases[i];
      
      console.log(`Teste ${i + 1}/${totalTests}: ${testCase.description}`);
      console.log(`Input: "${testCase.input}"`);
      
      try {
        const result = await correctText(testCase.input);
        const correctedText = applyCorrections(testCase.input, result.matches);
        
        console.log(`Output: "${correctedText}"`);
        console.log(`Expected: "${testCase.expected}"`);
        
        // Verificar se a correção foi aplicada
        const correctionApplied = correctedText !== testCase.input;
        const matchesCorrected = result.matches && result.matches.length > 0;
        
        // Verificar se há explicações para casos ambíguos
        const hasExplanations = matchesCorrected && result.matches.some(match => match.explanation);
        
        // Verificar se o resultado corresponde ao esperado
        const isCorrect = correctedText === testCase.expected;
        
        if (isCorrect && (testCase.shouldHaveExplanation ? hasExplanations : true)) {
          console.log('✅ PASSOU');
          passedTests++;
          
          if (hasExplanations) {
            const semanticMatch = result.matches.find(match => match.explanation);
            if (semanticMatch) {
              console.log(`   Explicação: ${semanticMatch.explanation.explanation}`);
              console.log(`   Contexto: ${semanticMatch.explanation.context}`);
              console.log(`   Ambiguidade: ${semanticMatch.explanation.ambiguity}`);
            }
          }
        } else {
          console.log('❌ FALHOU');
          if (!isCorrect) console.log(`   Resultado incorreto`);
          if (testCase.shouldHaveExplanation && !hasExplanations) console.log(`   Sem explicação para caso ambíguo`);
        }
        
      } catch (error) {
        console.log(`❌ ERRO: ${error.message}`);
      }
      
      console.log('---');
    }
    
    console.log(`\n=== RESULTADO FINAL ===`);
    console.log(`Testes passados: ${passedTests}/${totalTests}`);
    console.log(`Taxa de sucesso: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    if (passedTests === totalTests) {
      console.log('🎉 Todos os testes passaram!');
    } else {
      console.log('⚠️ Alguns testes falharam - revise a implementação');
    }
    
  } catch (error) {
    console.error('Erro durante os testes:', error);
  } finally {
    // Parar servidor
    stopServer(serverProcess);
  }
}

// Executar testes
runSemanticTests().catch(console.error);
