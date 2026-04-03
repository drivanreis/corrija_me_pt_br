import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

async function findFreePort(startPort = 18081) {
  let port = startPort;

  while (true) {
    const available = await new Promise((resolve) => {
      const tester = createServer();
      tester.once("error", () => resolve(false));
      tester.once("listening", () => {
        tester.close(() => resolve(true));
      });
      tester.listen(port, "127.0.0.1");
    });

    if (available) {
      return String(port);
    }

    port += 1;
  }
}

const port = await findFreePort();

const server = spawn("node", ["build/node-app/backend/server.cjs"], {
  env: {
    ...process.env,
    CORRIJA_ME_PORT: port
  },
  stdio: ["ignore", "pipe", "pipe"]
});

server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});
server.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

async function main() {
  await delay(1000);

  const response = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "voce  nao viu o o servico ?"
    })
  });

  const payload = await response.json();
  console.log(JSON.stringify(payload, null, 2));

  if (!Array.isArray(payload.matches) || payload.matches.length === 0) {
    throw new Error("Smoke test falhou: nenhuma sugestao retornada.");
  }

  const phraseResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Vendo bicileta semi nova em Fortalesa Ceara"
    })
  });

  const phrasePayload = await phraseResponse.json();
  const phraseSuggestions = Array.isArray(phrasePayload.matches)
    ? phrasePayload.matches.flatMap((match) => Array.isArray(match.replacements) ? match.replacements.map((entry) => entry.value) : [])
    : [];

  if (!phraseSuggestions.includes("semi-nova") || !phraseSuggestions.includes("Fortaleza, Ceará")) {
    throw new Error("Smoke test falhou: regras frasais nao apareceram como esperado.");
  }

  const technicalResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Use os arquivos context_rules.json e phrase_rules.json para montar o prompt."
    })
  });

  const technicalPayload = await technicalResponse.json();
  const technicalMatches = Array.isArray(technicalPayload.matches) ? technicalPayload.matches : [];
  const hasJsonFalsePositive = technicalMatches.some((match) => (
    typeof match.offset === "number"
    && typeof match.length === "number"
    && ["context_rules.json", "phrase_rules.json", "json"].includes(
      "Use os arquivos context_rules.json e phrase_rules.json para montar o prompt.".slice(match.offset, match.offset + match.length)
    )
  ));

  if (hasJsonFalsePositive) {
    throw new Error("Smoke test falhou: nomes de arquivo tecnicos ainda estao gerando falso positivo.");
  }

  const agreementResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "A gente sempre falamos disso e vocês não segue o processo."
    })
  });

  const agreementPayload = await agreementResponse.json();
  const agreementSuggestions = Array.isArray(agreementPayload.matches)
    ? agreementPayload.matches.flatMap((match) => Array.isArray(match.replacements) ? match.replacements.map((entry) => entry.value) : [])
    : [];

  if (!agreementSuggestions.includes("fala") || !agreementSuggestions.includes("seguem")) {
    throw new Error("Smoke test falhou: concordancia verbal simples nao apareceu como esperado.");
  }

  const infinitiveResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Para eu realmente falar disso depois."
    })
  });

  const infinitivePayload = await infinitiveResponse.json();
  const infinitiveMatches = Array.isArray(infinitivePayload.matches) ? infinitivePayload.matches : [];
  const hasFalseAgreement = infinitiveMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_VERBAL_AGREEMENT");

  if (hasFalseAgreement) {
    throw new Error("Smoke test falhou: contexto de infinitivo gerou falsa concordancia verbal.");
  }

  const nominalResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Pode deixar que eu trago as fruta e as notas anexo."
    })
  });

  const nominalPayload = await nominalResponse.json();
  const nominalSuggestions = Array.isArray(nominalPayload.matches)
    ? nominalPayload.matches.flatMap((match) => Array.isArray(match.replacements) ? match.replacements.map((entry) => entry.value) : [])
    : [];

  if (!nominalSuggestions.includes("frutas") || !nominalSuggestions.includes("anexas")) {
    throw new Error("Smoke test falhou: concordancia nominal simples nao apareceu como esperado.");
  }

  const nominalExpandedResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Venha conferir nossas oferta e as bicicletas maduro."
    })
  });

  const nominalExpandedPayload = await nominalExpandedResponse.json();
  const nominalExpandedSuggestions = Array.isArray(nominalExpandedPayload.matches)
    ? nominalExpandedPayload.matches.flatMap((match) => Array.isArray(match.replacements) ? match.replacements.map((entry) => entry.value) : [])
    : [];

  if (!nominalExpandedSuggestions.includes("ofertas") || !nominalExpandedSuggestions.includes("maduras")) {
    throw new Error("Smoke test falhou: expansao da concordancia nominal nao apareceu como esperado.");
  }

  const nominalPredicateResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "As notas estão anexo e a fruta está maduro."
    })
  });

  const nominalPredicatePayload = await nominalPredicateResponse.json();
  const nominalPredicateSuggestions = Array.isArray(nominalPredicatePayload.matches)
    ? nominalPredicatePayload.matches.flatMap((match) => Array.isArray(match.replacements) ? match.replacements.map((entry) => entry.value) : [])
    : [];

  if (!nominalPredicateSuggestions.includes("anexas") || !nominalPredicateSuggestions.includes("madura")) {
    throw new Error("Smoke test falhou: predicativo nominal simples nao apareceu como esperado.");
  }

  const nominalAdvancedResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "As notas fiscais estão anexo. Segue anexo as notas."
    })
  });

  const nominalAdvancedPayload = await nominalAdvancedResponse.json();
  const nominalAdvancedSuggestions = Array.isArray(nominalAdvancedPayload.matches)
    ? nominalAdvancedPayload.matches.flatMap((match) => Array.isArray(match.replacements) ? match.replacements.map((entry) => entry.value) : [])
    : [];

  if (!nominalAdvancedSuggestions.includes("anexas")) {
    throw new Error("Smoke test falhou: expansao do predicativo nominal nao apareceu como esperado.");
  }

  const syntaxResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Eu bonito."
    })
  });

  const syntaxPayload = await syntaxResponse.json();
  const syntaxMatches = Array.isArray(syntaxPayload.matches) ? syntaxPayload.matches : [];
  const hasSyntaxSignal = syntaxMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_SYNTAX_PATTERN");

  if (hasSyntaxSignal) {
    throw new Error("Smoke test falhou: camada sintatica basica de baixa confianca voltou a vazar no fluxo normal.");
  }

  const syntaxSafeResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Você já enviou o relatório."
    })
  });

  const syntaxSafePayload = await syntaxSafeResponse.json();
  const syntaxSafeMatches = Array.isArray(syntaxSafePayload.matches) ? syntaxSafePayload.matches : [];
  const hasUnexpectedSyntaxSignal = syntaxSafeMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_SYNTAX_PATTERN");

  if (hasUnexpectedSyntaxSignal) {
    throw new Error("Smoke test falhou: camada sintatica sinalizou uma estrutura curta valida.");
  }

  const syntaxExpandedSafeResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Eu assino o documento agora."
    })
  });

  const syntaxExpandedSafePayload = await syntaxExpandedSafeResponse.json();
  const syntaxExpandedSafeMatches = Array.isArray(syntaxExpandedSafePayload.matches) ? syntaxExpandedSafePayload.matches : [];
  const hasExpandedUnexpectedSyntaxSignal = syntaxExpandedSafeMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_SYNTAX_PATTERN");

  if (hasExpandedUnexpectedSyntaxSignal) {
    throw new Error("Smoke test falhou: expansao sintatica sinalizou uma estrutura valida de sujeito, verbo e objeto.");
  }

  const syntaxLinkingSafeResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Ela é dedicada. O projeto precisa de uma revisão."
    })
  });

  const syntaxLinkingSafePayload = await syntaxLinkingSafeResponse.json();
  const syntaxLinkingSafeMatches = Array.isArray(syntaxLinkingSafePayload.matches) ? syntaxLinkingSafePayload.matches : [];
  const hasLinkingUnexpectedSyntaxSignal = syntaxLinkingSafeMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_SYNTAX_PATTERN");

  if (hasLinkingUnexpectedSyntaxSignal) {
    throw new Error("Smoke test falhou: novos padroes sintaticos sinalizaram estruturas validas com ligacao ou complemento nominal.");
  }

  const syntaxImperativeSafeResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Traga o relatório agora. Venha conferir as ofertas."
    })
  });

  const syntaxImperativeSafePayload = await syntaxImperativeSafeResponse.json();
  const syntaxImperativeSafeMatches = Array.isArray(syntaxImperativeSafePayload.matches) ? syntaxImperativeSafePayload.matches : [];
  const hasImperativeUnexpectedSyntaxSignal = syntaxImperativeSafeMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_SYNTAX_PATTERN");

  if (hasImperativeUnexpectedSyntaxSignal) {
    throw new Error("Smoke test falhou: expansao sintatica sinalizou estruturas validas com verbo inicial.");
  }

  const syntaxPrepositionSafeResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Você precisa de revisão. Traga o relatório para análise."
    })
  });

  const syntaxPrepositionSafePayload = await syntaxPrepositionSafeResponse.json();
  const syntaxPrepositionSafeMatches = Array.isArray(syntaxPrepositionSafePayload.matches) ? syntaxPrepositionSafePayload.matches : [];
  const hasPrepositionUnexpectedSyntaxSignal = syntaxPrepositionSafeMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_SYNTAX_PATTERN");

  if (hasPrepositionUnexpectedSyntaxSignal) {
    throw new Error("Smoke test falhou: expansao sintatica sinalizou estruturas validas com complemento preposicionado.");
  }

  const syntaxContractedPrepositionSafeResponse = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text: "Vou analisar a exceção no processo. A reunião foi ao lado da sala."
    })
  });

  const syntaxContractedPrepositionSafePayload = await syntaxContractedPrepositionSafeResponse.json();
  const syntaxContractedPrepositionSafeMatches = Array.isArray(syntaxContractedPrepositionSafePayload.matches) ? syntaxContractedPrepositionSafePayload.matches : [];
  const hasContractedUnexpectedSyntaxSignal = syntaxContractedPrepositionSafeMatches.some((match) => match.rule?.id === "PT_BR_SIMPLE_SYNTAX_PATTERN");

  if (hasContractedUnexpectedSyntaxSignal) {
    throw new Error("Smoke test falhou: expansao sintatica sinalizou estruturas validas com contracoes prepositivas curtas.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.kill("SIGTERM");
  });
