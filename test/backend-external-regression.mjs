import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const textsErro = [
  "Pra mim fazer isso vai ser dificil mais eu tento.",
  "Os problema que aconteceu ontem nao foi resolvido ainda.",
  "Ela falou pra mim ir na loja compra os negocio.",
  "A gente tava meio perdido mais conseguimos acha o caminho.",
  "Eles nao sabia que nois ia chega mais cedo.",
  "Fazem tres meses que ela nao vem aqui e ninguem sabe o porque.",
  "Eu vi ele saindo da sala mais nao falei nada pra ele.",
  "As pessoa que chegou atrasado nao pode entra na reuniao.",
  "Se eu fosse voce eu nao fazia isso porque pode dar problema depois.",
  "Nos vai precisar resolve isso rapido antes que de errado."
];

const textsRight = [
  "A gente foi ao mercado comprar pão.",
  "Os meninos brincavam na rua ontem.",
  "Ela foi à escola sem avisar ninguém.",
  "Os problemas foram resolvidos rápido.",
  "Ele não soube explicar por que estava tão nervoso ontem à noite.",
  "Eu assisti ao filme e gostei muito dele.",
  "Havia muitas pessoas na fila, mas ninguém reclamou.",
  "Faz dois anos que eu não os vejo pessoalmente.",
  "Nós vamos à praia toda segunda-feira.",
  "Ele trouxe os documentos para eu assinar."
];

const textsCorretas = [
  "Para eu fazer isso vai ser difícil, mas eu tento.",
  "Os problemas que aconteceram ontem não foram resolvidos ainda.",
  "Ela falou para eu ir à loja comprar os negócios.",
  "A gente estava meio perdido, mas conseguimos achar o caminho.",
  "Eles não sabiam que nós íamos chegar mais cedo.",
  "Faz três meses que ela não vem aqui e ninguém sabe o porquê.",
  "Eu o vi saindo da sala, mas não falei nada para ele.",
  "As pessoas que chegaram atrasadas não podem entrar na reunião.",
  "Se eu fosse você, eu não faria isso porque pode dar problema depois.",
  "Nós vamos precisar resolver isso rápido antes que dê errado."
];

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

function applyMatches(original, payload) {
  const matches = Array.isArray(payload?.matches) ? [...payload.matches] : [];
  if (!matches.length) {
    return original;
  }

  let text = original;
  matches.sort((left, right) => right.offset - left.offset);

  for (const match of matches) {
    const replacement = match?.replacements?.[0]?.value;
    if (!replacement && replacement !== "") {
      continue;
    }

    text = text.slice(0, match.offset) + replacement + text.slice(match.offset + match.length);
  }

  return text;
}

async function postCheck(port, text) {
  const response = await fetch(`http://127.0.0.1:${port}/v2/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: new URLSearchParams({
      language: "pt-BR",
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar o backend: HTTP ${response.status}`);
  }

  return response.json();
}

async function main() {
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

  try {
    await delay(1000);

    const failures = [];
    const startedAt = Date.now();

    for (let index = 0; index < textsErro.length; index += 1) {
      const original = textsErro[index];
      const expected = textsCorretas[index];
      const payload = await postCheck(port, original);
      const corrected = applyMatches(original, payload);

      if (corrected !== expected) {
        failures.push({ original, corrected, expected });
      }
    }

    for (let index = 0; index < textsRight.length; index += 1) {
      const original = textsRight[index];
      const expected = textsRight[index];
      const payload = await postCheck(port, original);
      const corrected = applyMatches(original, payload);

      if (corrected !== expected) {
        failures.push({ original, corrected, expected });
      }
    }

    const elapsedMs = Date.now() - startedAt;

    console.log("=== FALHAS ===");
    for (const failure of failures) {
      console.log("-----------------------------");
      console.log(`Frase original : ${failure.original}`);
      console.log(`Backend retornou: ${failure.corrected}`);
      console.log(`Esperado        : ${failure.expected}`);
    }

    console.log("-----------------------------");
    console.log(`Total de falhas: ${failures.length}`);
    console.log(`tempo_total_ms=${elapsedMs}`);

    if (failures.length > 0) {
      throw new Error(`Teste externo de regressao falhou com ${failures.length} caso(s).`);
    }
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
