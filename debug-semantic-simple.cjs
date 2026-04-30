// Teste simplificado da função createSemanticAnalysisMatches
const fs = require('fs');
const path = require('path');

// Ler o arquivo compilado do servidor
const serverPath = path.join(process.cwd(), 'build/node-app/backend/server.cjs');
const content = fs.readFileSync(serverPath, 'utf8');

// Extrair apenas a função createSemanticAnalysisMatches
const funcStart = content.indexOf('function createSemanticAnalysisMatches');
const funcEnd = content.indexOf('return matches;', funcStart);

if (funcStart !== -1 && funcEnd !== -1) {
  const funcContent = content.substring(funcStart, funcEnd + 'return matches;'.length);
  
  // Criar arquivo de teste isolado
  const testFile = path.join(process.cwd(), 'debug-semantic-simple-test.cjs');
  const testContent = funcContent + '\n\n// Teste da função\nconst testText = "Tem pão, fresco?";\nconst testDictionary = {};\n\nconsole.log("=== TESTE DA FUNÇÃO createSemanticAnalysisMatches ===");\nconsole.log("Texto de entrada:", testText);\n\ntry {\n  const testMatches = createSemanticAnalysisMatches(testText, testDictionary);\n  console.log("Matches encontrados:", testMatches.length);\n  \n  testMatches.forEach((match, i) => {\n    console.log("Match " + (i + 1) + ":");\n    console.log("  Rule: " + (match.rule?.id || "no-id"));\n    console.log("  Message: " + (match.message || "no-message"));\n    console.log("  Original: \\"" + testText.substring(match.offset, match.offset + match.length) + "\\"");\n    console.log("  Replacement: " + (match.replacements[0]?.value || "no-replacement"));\n    console.log("  Confidence: " + (match.confidence?.level || "no-confidence"));\n    console.log("");\n  });\n} catch (error) {\n  console.error("Erro na função:", error.message);\n  console.error("Stack:", error.stack);\n}\n';
  
  fs.writeFileSync(testFile, testContent);
  console.log('Arquivo de teste criado:', testFile);
  
  // Executar o teste
  const { spawn } = require('child_process');
  const testProcess = spawn('node', [testFile], { stdio: 'inherit' });
  
  testProcess.on('close', (code) => {
    fs.unlinkSync(testFile);
    console.log('Teste finalizado com código:', code);
  });
} else {
  console.log('Função createSemanticAnalysisMatches não encontrada');
}
