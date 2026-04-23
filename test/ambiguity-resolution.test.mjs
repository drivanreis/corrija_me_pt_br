import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fetch } from "undici";

// Casos de teste para validação das melhorias de ambiguidade
const ambiguityTestCases = [
  // Casos meio/meia
  {
    description: "A gente estava meio triste (advérbio)",
    input: "A gente estava meio triste.",
    expected: "A gente estava meio triste.",
    shouldNotChange: true
  },
  {
    description: "A garota estava meia confusa (advérbio - erro)",
    input: "A garota estava meia confusa.",
    expected: "A garota estava meio confusa.",
    shouldChange: true
  },
  {
    description: "Comeu meia pizza (numeral)",
    input: "Ele comeu meio pizza.",
    expected: "Ele comeu meia pizza.",
    shouldChange: true
  },
  {
    description: "Meia hora (numeral)",
    input: "Esperei meio hora.",
    expected: "Esperei meia hora.",
    shouldChange: true
  },
  
  // Casos bastante/bastantes
  {
    description: "Bastante pessoas (concordância)",
    input: "Havia bastante pessoas na festa.",
    expected: "Havia bastantes pessoas na festa.",
    shouldChange: true
  },
  {
    description: "Bastante feliz (advérbio)",
    input: "Ela estava bastante feliz.",
    expected: "Ela estava bastante feliz.",
    shouldNotChange: true
  },
  
  // Casos muito/muitos
  {
    description: "Muitos livros (concordância)",
    input: "Comprei muito livros.",
    expected: "Comprei muitos livros.",
    shouldChange: true
  },
  {
    description: "Muito obrigado (advérbio)",
    input: "Muito obrigado pela ajuda.",
    expected: "Muito obrigado pela ajuda.",
    shouldNotChange: true
  },
  
  // Casos a gente
  {
    description: "A gente vamos (concordância)",
    input: "A gente vamos ao cinema.",
    expected: "A gente vai ao cinema.",
    shouldChange: true
  },
  {
    description: "A gente vai (correto)",
    input: "A gente vai viajar amanhã.",
    expected: "A gente vai viajar amanhã.",
    shouldNotChange: true
  },
  
  // Casos mais/mas
  {
    description: "Mais para oposição (erro)",
    input: "Estudei muito, mais não passei.",
    expected: "Estudei muito, mas não passei.",
    shouldChange: true
  },
  {
    description: "Mas correto",
    input: "Ela é inteligente, mas preguiçosa.",
    expected: "Ela é inteligente, mas preguiçosa.",
    shouldNotChange: true
  },
  
  // Casos aonde/onde
  {
    description: "Onde com movimento (erro)",
    input: "Onde você vai agora?",
    expected: "Aonde você vai agora?",
    shouldChange: true
  },
  {
    description: "Aonde correto",
    input: "Aonde você foi ontem?",
    expected: "Aonde você foi ontem?",
    shouldNotChange: true
  },
  
  // Casos afim/a fim
  {
    description: "Afim de (erro)",
    input: "Estou afim de ajudar.",
    expected: "Estou a fim de ajudar.",
    shouldChange: true
  },
  {
    description: "A fim correto",
    input: "Ele veio a fim de conversar.",
    expected: "Ele veio a fim de conversar.",
    shouldNotChange: true
  }
];

async function startServer() {
  console.log("🚀 Iniciando servidor de teste...");
  
  const serverProcess = spawn("node", ["build/node-app/server.js"], {
    stdio: "pipe",
    cwd: process.cwd()
  });
  
  // Esperar o servidor iniciar
  await delay(3000);
  
  return serverProcess;
}

async function checkText(text) {
  const response = await fetch("http://127.0.0.1:18081/v2/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });
  
  if (!response.ok) {
    throw new Error(`Erro HTTP: ${response.status}`);
  }
  
  return response.json();
}

async function runAmbiguityTests() {
  console.log("🧪 Executando testes de ambiguidade morfológica...\n");
  
  let passed = 0;
  let failed = 0;
  let total = ambiguityTestCases.length;
  
  for (const testCase of ambiguityTestCases) {
    try {
      const result = await checkText(testCase.input);
      const corrected = result.matches.length > 0 
        ? applyCorrections(testCase.input, result.matches)
        : testCase.input;
      
      let testPassed = false;
      
      if (testCase.shouldChange) {
        testPassed = corrected === testCase.expected;
      } else if (testCase.shouldNotChange) {
        testPassed = corrected === testCase.input;
      }
      
      if (testPassed) {
        console.log(`✅ ${testCase.description}`);
        console.log(`   Entrada: "${testCase.input}"`);
        console.log(`   Saída: "${corrected}"`);
        passed++;
      } else {
        console.log(`❌ ${testCase.description}`);
        console.log(`   Entrada: "${testCase.input}"`);
        console.log(`   Esperado: "${testCase.expected}"`);
        console.log(`   Obtido: "${corrected}"`);
        failed++;
      }
      
      console.log("");
      
    } catch (error) {
      console.log(`💥 Erro no teste "${testCase.description}": ${error.message}`);
      failed++;
    }
  }
  
  console.log(`📊 Resultado: ${passed}/${total} testes passaram (${Math.round(passed/total*100)}%)`);
  console.log(`✅ Passaram: ${passed}`);
  console.log(`❌ Falharam: ${failed}`);
  
  return { passed, failed, total };
}

function applyCorrections(text, matches) {
  let corrected = text;
  
  // Aplicar correções em ordem reversa para não afetar os offsets
  const sortedMatches = matches.sort((a, b) => b.offset - a.offset);
  
  for (const match of sortedMatches) {
    if (match.replacements.length > 0) {
      const replacement = match.replacements[0].value;
      corrected = corrected.slice(0, match.offset) + replacement + corrected.slice(match.offset + match.length);
    }
  }
  
  return corrected;
}

async function main() {
  let serverProcess;
  
  try {
    // Build do projeto
    console.log("🔨 Build do projeto...");
    const { execSync } = await import("node:child_process");
    execSync("npm run build", { stdio: "inherit" });
    
    // Iniciar servidor
    serverProcess = await startServer();
    
    // Executar testes
    const results = await runAmbiguityTests();
    
    // Encerrar servidor
    if (serverProcess) {
      serverProcess.kill();
    }
    
    // Saída com código de status
    process.exit(results.failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error("💥 Erro durante execução dos testes:", error);
    
    if (serverProcess) {
      serverProcess.kill();
    }
    
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
