# Testes Oficiais

Esta pasta concentra os testes que fazem parte oficial do sistema.

## Camadas de teste

- Unitario
  - valida funcoes puras do motor em `test/unit/`
- Integracao
  - valida backend compilado, contrato HTTP e regressao externa
- Cobertura
  - mede cobertura dos testes unitarios com `c8`
- Continuo
  - valida o ciclo de aprendizado continuo sem alterar arquivos versionados

## Arquivos principais

- `index.html`
  - bateria manual e visual da extensao no navegador
- `backend-external-regression.mjs`
  - bancada automatizada de regressao do backend
  - sobe o backend local em porta livre
  - roda frases erradas com saida esperada
  - roda frases corretas que nao devem ser alteradas
- `unit/text.test.ts`
  - suite unitaria da camada `src/core/text.ts`

## Comandos

- `npm run test:unit`
  - executa testes unitarios com `node:test` em TypeScript
- `npm run test:integration`
  - executa smoke test do backend e regressao externa
- `npm run test:coverage`
  - executa cobertura dos testes unitarios com `c8`
- `npm run test:continuous`
  - valida o pipeline de aprendizado continuo (geracao e merge de regras)
- `npm test`
  - executa unitario + integracao
- `npm run test:backend`
  - alias legado para `npm run test:integration`
- `npm run test:external-regression`
  - roda apenas a bancada externa de regressao

## Observacao operacional

- Comandos que fazem `npm run build` e usam `build/node-app` devem ser executados em serie.
- Evite rodar em paralelo, por exemplo:
  - `npm run test:backend`
  - `npm run test:external-regression`
  - `npm run check:jandaia`
  - `npm run benchmark:hybrid`

## Limite Intencional

O arquivo raiz `teste.sh` nao faz parte desta pasta nem do sistema oficial.
Ele e tratado como bancada pessoal e independente do usuario.
