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

## Limite Intencional

O arquivo raiz `teste.sh` nao faz parte desta pasta nem do sistema oficial.
Ele e tratado como bancada pessoal e independente do usuario.
