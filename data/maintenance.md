# Manutenção dos dados linguísticos

## Objetivo

Padronizar a evolução do dicionário e das regras de contexto do `corrija_me_pt_br`.

## Onde os dados ficam

- Dicionário principal: `data/dictionary/words_01.txt`
- Palavras customizadas: `data/dictionary/custom_words.txt`
- Erros comuns: `data/dictionary/common_mistakes.json`
- Regras de contexto: `data/rules/context_rules.json`

## Processo recomendado

1. Adicionar novas palavras válidas no dicionário.
2. Adicionar novas regras contextuais somente quando forem claras e pouco ambíguas.
3. Evitar regras “intuitivas” demais sem teste real.
4. Rodar a validação de dados:

```bash
npm run data:validate
```

5. Rodar a checagem técnica:

```bash
npm run typecheck
npm run lint
npm run test:backend
```

6. Gerar nova release:

```bash
npm run release
```

## Critérios para novas palavras

- Devem ser palavras válidas no português do Brasil ou termos realmente aceitos no produto.
- Evitar lixo, tokens quebrados, URLs, emails e palavras acidentais.
- Preferir minúsculas no arquivo.

## Critérios para novas regras

- Devem corrigir erros frequentes.
- Devem ter baixo risco de falso positivo.
- Devem ser específicas o suficiente para não quebrar frases corretas.
- Se a regra for muito ampla, dividir em várias menores.

## Próxima evolução sugerida

- Criar `words_02.txt` quando a expansão do dicionário crescer bastante.
- Separar regras por categoria:
  - `agreement_rules.json`
  - `confusion_rules.json`
  - `crase_rules.json`
  - `context_rules.json`
