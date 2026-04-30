const fs = require('fs');
const path = require('path');

// Ler o arquivo compilado
const serverPath = path.join(process.cwd(), 'build/node-app/backend/server.cjs');
const content = fs.readFileSync(serverPath, 'utf8');

// Extrair a função createSemanticAnalysisMatches
const funcStart = content.indexOf('function createSemanticAnalysisMatches');
const funcEnd = content.indexOf('return matches;', funcStart);

if (funcStart !== -1 && funcEnd !== -1) {
  const funcContent = content.substring(funcStart, funcEnd + 'return matches;'.length);
  console.log('=== FUNÇÃO createSemanticAnalysisMatches ENCONTRADA ===');
  
  // Criar arquivo temporário para testar
  const tempFile = path.join(process.cwd(), 'debug-semantic-test.js');
  const tempContent = funcContent + '\n\n// Teste\nconst text = "Tem pão, fresco?";\nconst dictionary = {};\n\nconsole.log("=== TESTE DIRETO DA FUNÇÃO ===");\nconsole.log("Texto de entrada:", text);\n\ntry {\n  const matches = createSemanticAnalysisMatches(text, dictionary);\n  console.log("Matches encontrados:", matches.length);\n  \n  matches.forEach((match, i) => {\n    console.log("Match " + (i + 1) + ":");\n    console.log("  Rule:", match.rule.id);\n    console.log("  Message:", match.message);\n    console.log("  Original:", text.substring(match.offset, match.offset + match.length));\n    console.log("  Replacement:", match.replacements[0]?.value);\n    console.log("  Confidence:", match.confidence.level);\n    console.log("");\n  });\n} catch (error) {\n  console.error("Erro na função:", error.message);\n}\n';
  
  fs.writeFileSync(tempFile, tempContent);
  console.log('Arquivo temporário criado:', tempFile);
  
  // Executar o teste
  const { spawn } = require('child_process');
  const testProcess = spawn('node', [tempFile], { stdio: 'inherit' });
  
  testProcess.on('close', (code) => {
    fs.unlinkSync(tempFile);
    console.log('Teste finalizado com código:', code);
  });
} else {
  console.log('Função não encontrada');
}
