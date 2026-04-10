# Testes Oficiais

Esta pasta concentra os testes que fazem parte oficial do sistema.

## Arquivos

- `index.html`
  - bateria manual e visual da extensao no navegador
- `backend-external-regression.mjs`
  - bancada automatizada de regressao do backend
  - sobe o backend local em porta livre
  - roda frases erradas com saida esperada
  - roda frases corretas que nao devem ser alteradas

## Comandos

- `npm run test:backend`
  - roda o smoke test do backend
  - roda a bancada externa de regressao
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
