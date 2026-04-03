# Curadoria de migracao do legado

Esta pasta guarda a saida dos conversores da Etapa 6.

## Objetivo

Transformar dados do legado em candidatos revisaveis para a base estruturada, sem promover entradas automaticamente para o lexico final.

## Arquivos gerados

- `summary.json`: resumo da rodada de conversao
- `lexical_candidates.json`: candidatos para arquivos de `Lexico/`
- `exception_candidates.json`: candidatos para `Excecoes/`
- `replacement_candidates.json`: candidatos derivados de `common_mistakes.json`
- `skipped_custom_words.json`: itens pulados por ja estarem cobertos

## Fluxo recomendado

1. Rodar o conversor.
2. Revisar os candidatos por arquivo de destino.
3. Promover apenas entradas claras para a base estruturada.
4. Manter entradas duvidosas com `review` ou em excecoes.

## Regra importante

O conversor sugere; ele nao aprova sozinho.
