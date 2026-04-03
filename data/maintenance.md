# Manutenção dos dados linguísticos

## Objetivo

Padronizar a evolução do dicionário e das regras de contexto do `corrija_me_pt_br`.

## Onde os dados ficam

- Runtime ativo: `data/linguistic/`, `data/replacements.json`, `data/rules/`
- Material legado historico: `data/dictionary/words_01.txt`
- Material legado historico: `data/dictionary/custom_words.txt`
- Material legado historico: `data/dictionary/common_mistakes.json`
- Regras de contexto: `data/rules/context_rules.json`
- Base estruturada nova: `data/linguistic/`

## Processo recomendado

1. Adicionar novo conhecimento primeiro na base estruturada ou em `data/replacements.json`.
2. Adicionar novas regras contextuais somente quando forem claras e pouco ambíguas.
3. Preferir colocar conhecimento estrutural novo em `data/linguistic/` quando ele representar léxico, concordância, irregularidade, sintaxe simples ou exceção.
4. Evitar regras “intuitivas” demais sem teste real.
5. Rodar a validação de dados:

```bash
npm run data:validate
```

6. Rodar a checagem técnica:

```bash
npm run typecheck
npm run lint
npm run test:backend
```

7. Gerar nova release:

```bash
npm run release
```

## Critérios para novas entradas lexicais

- Devem ser palavras válidas no português do Brasil ou termos realmente aceitos no produto.
- Evitar lixo, tokens quebrados, URLs, emails e palavras acidentais.
- Preferir minúsculas no arquivo.
- Não reabrir o legado como fonte operacional; usar o legado apenas como referência de auditoria.

## Critérios para novas regras

- Devem corrigir erros frequentes.
- Devem ter baixo risco de falso positivo.
- Devem ser específicas o suficiente para não quebrar frases corretas.
- Se a regra for muito ampla, dividir em várias menores.

## Critérios para a nova base estruturada

- Toda entrada lexical deve declarar ao menos `classes`.
- Entradas ambíguas devem preferir `autoCorrect: "review"` ou `autoCorrect: "blocked"`.
- Formas flexionadas podem ser registradas em `forms` quando isso trouxer ganho prático imediato.
- Palavras técnicas, marcas e estrangeirismos aceitos devem entrar em `Excecoes/palavras_desconhecidas.json` antes de virar correção automática.
- Padrões sintáticos devem começar pequenos e de alta confiança.

## Direção atual

- Expandir gradualmente `data/linguistic/` com curadoria forte.
- Usar `data/replacements.json` para substituições seguras e auditáveis.
- Tratar os arquivos legados como histórico de referência, não como base viva do runtime.
