# Base linguistica estruturada

Esta pasta representa a nova camada estrutural da base do `corrija_me_pt_br`.

Objetivos desta camada:

- separar lexico, regras, concordancia, irregularidades, sintaxe e excecoes
- permitir migracao gradual sem descartar o dicionario atual
- reduzir correcoes perigosas por falta de contexto
- abrir caminho para evolucao de concordancia e validacao morfologica

## Estado atual

Nesta primeira etapa, a camada estruturada ja esta integrada ao carregamento do backend e entrega dois ganhos imediatos:

- adiciona novas entradas lexicais validas ao conjunto de palavras conhecidas
- permite marcar palavras e expressoes que nao devem disparar autocorrecao agressiva

O motor ainda nao usa toda a riqueza desta pasta. Isso sera feito por etapas.

## Ordem de uso planejada

1. Lexico e excecoes
2. Concordancia verbal e nominal basica
3. Flexao e conjugacao com validacao de forma esperada
4. Padroes sintaticos simples de alta confianca
5. Regras mais sofisticadas apenas quando forem mensuraveis na bateria automatizada

## Arquivos de schema

Os schemas iniciais ficam em `data/linguistic/schemas/` e documentam o formato minimo esperado para os JSONs desta base.
