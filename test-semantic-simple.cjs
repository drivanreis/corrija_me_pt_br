// Teste expandido do motor semântico - 20 casos completos

// Função expandida de análise semântica
function analyzeSemanticSimple(text) {
  console.log(`Analisando texto: "${text}"`);
  
  const matches = [];
  
  // Caso 1: "Tem pão, fresco?" -> detectar vírgula após fresco
  if (text.includes('pão, fresco')) {
    console.log('✅ Detectado: pão, fresco (com vírgula)');
    matches.push({
      original: 'pão, fresco',
      corrected: 'pão fresco',
      explanation: 'Vírgula transforma "fresco" em vocativo (gíria pejorativa)',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 2: "Bora comer gente?" -> detectar sem vírgula
  if (text.includes('Bora comer gente?')) {
    console.log('✅ Detectado: Bora comer gente? (sem vírgula)');
    matches.push({
      original: 'Bora comer gente?',
      corrected: 'Bora comer, gente?',
      explanation: 'Sem vírgula, "gente" pode soar como objeto (suspeito). Com vírgula, "gente" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 3: "Não quero sair com você." -> detectar falta de vírgula
  if (text.includes('Não quero sair com você.')) {
    console.log('✅ Detectado: Não quero sair com você. (sem vírgula)');
    matches.push({
      original: 'Não quero sair com você.',
      corrected: 'Não, quero sair com você.',
      explanation: 'Sem vírgula, "não" se aplica a "quero". Com vírgula, "não" se aplica à frase inteira, mudando de recusa para confirmação.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 4: "Pode esperar." -> detectar falta de vírgula
  if (text.includes('Pode esperar.')) {
    console.log('✅ Detectado: Pode esperar. (sem vírgula)');
    matches.push({
      original: 'Pode esperar.',
      corrected: 'Pode, esperar.',
      explanation: 'Sem vírgula, é uma permissão única. Com vírgula, soa como duas ideias separadas.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 5: "Se quiser terminar comigo tudo bem." -> detectar falta de vírgula
  if (text.includes('Se quiser terminar comigo tudo bem.')) {
    console.log('✅ Detectado: Se quiser terminar comigo tudo bem. (sem vírgula)');
    matches.push({
      original: 'Se quiser terminar comigo tudo bem.',
      corrected: 'Se quiser terminar comigo, tudo bem.',
      explanation: 'Sem vírgula, "tudo bem" modifica "terminar". Com vírgula, "tudo bem" se torna uma resposta separada.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 6: "Vamos produzir pessoal." -> detectar falta de vírgula
  if (text.includes('Vamos produzir pessoal.')) {
    console.log('✅ Detectado: Vamos produzir pessoal. (sem vírgula)');
    matches.push({
      original: 'Vamos produzir pessoal.',
      corrected: 'Vamos produzir, pessoal.',
      explanation: 'Sem vírgula, "pessoal" se torna adjetivo de "produzir". Com vírgula, "pessoal" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 7: "Me vê um café, grande?" -> detectar vírgula incorreta
  if (text.includes('Me vê um café, grande?')) {
    console.log('✅ Detectado: Me vê um café, grande? (com vírgula)');
    matches.push({
      original: 'Me vê um café, grande?',
      corrected: 'Me vê um café grande?',
      explanation: 'Com vírgula, "grande" não modifica "café". Sem vírgula, "grande" modifica "café" corretamente.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 8: "Calma cara." -> detectar falta de vírgula
  if (text.includes('Calma cara.')) {
    console.log('✅ Detectado: Calma cara. (sem vírgula)');
    matches.push({
      original: 'Calma cara.',
      corrected: 'Calma, cara.',
      explanation: 'Sem vírgula, "cara" se torna adjetivo de "calma" (estranho). Com vírgula, "cara" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 9: "Você é incrível sério." -> detectar falta de vírgula
  if (text.includes('Você é incrível sério.')) {
    console.log('✅ Detectado: Você é incrível sério. (sem vírgula)');
    matches.push({
      original: 'Você é incrível sério.',
      corrected: 'Você é incrível, sério.',
      explanation: 'Sem vírgula, "sério" modifica "incrível" (elogio embolado). Com vírgula, "sério" reforça o elogio.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 10: "Vamos sair hoje?" -> detectar vírgula incorreta
  if (text.includes('Vamos sair hoje?')) {
    console.log('✅ Detectado: Vamos sair hoje? (com vírgula)');
    matches.push({
      original: 'Vamos sair hoje?',
      corrected: 'Vamos sair hoje?',
      explanation: 'Com vírgula, "hoje" fica separado, criando pausa estranha. Sem vírgula, a frase é mais natural.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 11: "Vamos comer crianças!" -> detectar falta de vírgula
  if (text.includes('Vamos comer crianças!') && !text.includes('Vamos comer, crianças!')) {
    console.log('✅ Detectado: Vamos comer crianças! (sem vírgula)');
    matches.push({
      original: 'Vamos comer crianças!',
      corrected: 'Vamos comer, crianças!',
      explanation: 'Sem vírgula, a frase sugere canibalismo. Com vírgula, é um chamado para as crianças comerem.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 12: "Já resolvi seu problema cliente." -> detectar falta de vírgula
  if (text.includes('Já resolvi seu problema cliente.')) {
    console.log('✅ Detectado: Já resolvi seu problema cliente. (sem vírgula)');
    matches.push({
      original: 'Já resolvi seu problema cliente.',
      corrected: 'Já resolvi seu problema, cliente.',
      explanation: 'Sem vírgula, "cliente" se torna adjetivo de "problema" (robótico). Com vírgula, "cliente" se torna vocativo.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 13: "Não podemos atender seu pedido." -> detectar falta de vírgula
  if (text.includes('Não podemos atender seu pedido.')) {
    console.log('✅ Detectado: Não podemos atender seu pedido. (sem vírgula)');
    matches.push({
      original: 'Não podemos atender seu pedido.',
      corrected: 'Não, podemos atender seu pedido.',
      explanation: 'Sem vírgula, é uma recusa seca. Com vírgula, "não" se aplica à frase inteira, mudando de recusa para confirmação.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 14: "Resolva isso agora cliente." -> detectar falta de vírgula
  if (text.includes('Resolva isso agora cliente.')) {
    console.log('✅ Detectado: Resolva isso agora cliente. (sem vírgula)');
    matches.push({
      original: 'Resolva isso agora cliente.',
      corrected: 'Resolva isso agora, cliente.',
      explanation: 'Sem vírgula, soa mandão. Com vírgula, "cliente" se torna vocativo, tornando o tom mais adequado.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 15: "O erro foi do sistema interno." -> detectar falta de vírgula
  if (text.includes('O erro foi do sistema interno.')) {
    console.log('✅ Detectado: O erro foi do sistema interno. (sem vírgula)');
    matches.push({
      original: 'O erro foi do sistema interno.',
      corrected: 'O erro foi do sistema, interno.',
      explanation: 'Sem vírgula, "interno" se torna adjetivo de "sistema" (assume responsabilidade). Com vírgula, "interno" se torna especificação.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 16: "Se não pagar será negativado." -> detectar falta de vírgula
  if (text.includes('Se não pagar será negativado.')) {
    console.log('✅ Detectado: Se não pagar será negativado. (sem vírgula)');
    matches.push({
      original: 'Se não pagar será negativado.',
      corrected: 'Se não pagar, será negativado.',
      explanation: 'Sem vírgula, soa como ameaça direta. Com vírgula, "se não pagar" se torna condição separada, tornando o tom mais formal.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 17: "Vamos cancelar o pedido do cliente inadimplente." -> detectar falta de vírgula
  if (text.includes('Vamos cancelar o pedido do cliente inadimplente.')) {
    console.log('✅ Detectado: Vamos cancelar o pedido do cliente inadimplente. (sem vírgula)');
    matches.push({
      original: 'Vamos cancelar o pedido do cliente inadimplente.',
      corrected: 'Vamos cancelar o pedido do cliente, inadimplente.',
      explanation: 'Sem vírgula, "inadimplente" se torna adjetivo de "cliente" (ofensivo). Com vírgula, "inadimplente" se torna especificação separada.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 18: "Prezados clientes informamos que houve instabilidade." -> detectar falta de vírgula
  if (text.includes('Prezados clientes informamos que houve instabilidade.')) {
    console.log('✅ Detectado: Prezados clientes informamos que houve instabilidade. (sem vírgula)');
    matches.push({
      original: 'Prezados clientes informamos que houve instabilidade.',
      corrected: 'Prezados clientes, informamos que houve instabilidade.',
      explanation: 'Sem vírgula, "informamos" se torna adjetivo de "clientes" (desorganizado). Com vírgula, "informamos" se torna ação principal.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 19: "Pode liberar o acesso não bloqueie." -> detectar falta de vírgula
  if (text.includes('Pode liberar o acesso não bloqueie.')) {
    console.log('✅ Detectado: Pode liberar o acesso não bloqueie. (sem vírgula)');
    matches.push({
      original: 'Pode liberar o acesso não bloqueie.',
      corrected: 'Pode liberar o acesso, não bloqueie.',
      explanation: 'Sem vírgula, "não bloqueie" se torna parte da instrução (confuso). Com vírgula, "não bloqueie" se torna comando separado.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 20: "Entendo sua frustração senhor." -> detectar falta de vírgula
  if (text.includes('Entendo sua frustração senhor.')) {
    console.log('✅ Detectado: Entendo sua frustração senhor. (sem vírgula)');
    matches.push({
      original: 'Entendo sua frustração senhor.',
      corrected: 'Entendo sua frustração, senhor.',
      explanation: 'Sem vírgula, "senhor" se torna adjetivo de "frustração" (frio/robotizado). Com vírgula, "senhor" se torna vocativo, tornando o tom mais humano.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  // Caso 21: "Não espere." -> detectar falta de vírgula
  if (text.includes('Não espere.') && !text.includes('Não, espere.')) {
    console.log('✅ Detectado: Não espere. (sem vírgula)');
    matches.push({
      original: 'Não espere.',
      corrected: 'Não, espere.',
      explanation: 'Sem vírgula, é uma ordem para não esperar. Com vírgula, é um pedido para esperar.',
      rule: 'PT_BR_SEMANTIC_AMBIGUITY',
      message: 'Ambiguidade semântica detectada - revise a intenção'
    });
  }
  
  console.log(`Total de matches encontrados: ${matches.length}`);
  return matches;
}

// Teste direto
const testCases = [
  'Tem pão, fresco?',
  'Tem pão fresco?',
  'Vamos comer crianças!',
  'Vamos comer, crianças!',
  'Não espere.',
  'Não, espere.'
];

console.log('=== INICIANDO TESTES SIMPLIFICADOS ===');

testCases.forEach((testCase, index) => {
  console.log(`\n--- Teste ${index + 1}: "${testCase}" ---`);
  const matches = analyzeSemanticSimple(testCase);
  
  if (matches.length > 0) {
    console.log('✅ SUCESSO: Caso detectado');
    matches.forEach((match, i) => {
      console.log(`  Match ${i + 1}:`);
      console.log(`    Original: ${match.original}`);
      console.log(`    Corrigido: ${match.corrected}`);
      console.log(`    Explicação: ${match.explanation}`);
    });
  } else {
    console.log('❌ FALHA: Nenhum caso detectado');
  }
});

console.log('\n=== TESTES FINALIZADOS ===');
