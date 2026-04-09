# Base De Dados E Pipeline De Testes

## Objetivo deste documento

Este documento explica, de forma simples e técnica ao mesmo tempo:

- de onde vêm os dados do projeto
- como esses dados são gerados
- como eles são filtrados
- como eles são divididos em arquivos
- como eles alimentam o corretor
- como eles são usados para medir o corretor sem contaminar a prova

Em resumo: este é o mapa da base de dados do `corrija_me_pt_br`.

## Ideia central

O projeto não funciona com um único arquivo “mágico” de frases.

Ele funciona com um pipeline em camadas:

1. primeiro geramos casos
2. depois curamos esses casos
3. depois dividimos a base em conhecimento e prova
4. depois aprendemos regras a partir da base de conhecimento
5. por fim, usamos a base de prova para medir se o motor realmente generaliza

Essa separação existe para evitar um problema clássico: o corretor decorar a resposta e depois parecer melhor do que realmente é.

## O que é o motor

O motor da aplicação é o núcleo linguístico que recebe uma frase, identifica erros e decide como corrigi-los.

Ele não é um único arquivo e também não é apenas uma base de dados.

Na prática, o motor é um sistema híbrido. Ele nasce da união entre lógica e conhecimento:

- `*.ts`
  - é a parte que pensa
  - organiza a ordem das correções
  - aplica heurísticas
  - combina regras
  - reprocessa a frase em múltiplas passagens
- `*.json`
  - é a parte que sabe
  - guarda conhecimento linguístico estruturado
  - define substituições, regras declarativas e casos aprendidos

Forma curta de explicar:

- `TypeScript` decide como corrigir
- `JSON` informa o que corrigir

Ou, em linguagem ainda mais simples:

- `*.ts` é o cérebro operacional
- `*.json` é a memória do corretor

Essa distinção é útil, mas a definição mais honesta é esta:

- `TS` sem `JSON` vira cérebro sem memória
- `JSON` sem `TS` vira memória sem ação
- o motor real é a união dos dois

O centro desse motor hoje está em [`src/core/engine.ts`](/home/eu/Documentos/GitHub/corrija_me_pt_br/src/core/engine.ts), que orquestra os módulos de correção e chama as camadas de conhecimento e heurística do projeto.

### Para onde o motor está evoluindo

O projeto está deixando de ser apenas um corretor por regras soltas e está evoluindo para um núcleo simbólico-heurístico especializado em português do Brasil.

Isso significa que o motor passa a trabalhar como um pipeline de especialistas em sequência, e não como um conjunto de correções concorrentes.

A ideia prática é esta:

1. ler a frase inteira
2. tentar correções holísticas primeiro, quando existir um padrão forte para a frase completa
3. aplicar especialistas por etapa
4. reprocessar a frase após cada melhoria
5. arbitrar o resultado final

No desenho atual, isso se traduz em estágios como:

- leitura holística da frase
- contexto simbólico
- normalização
- concordância e sintaxe curta
- refinamento final

Essa arquitetura importa porque:

- reduz conflito entre correções
- melhora a previsibilidade
- facilita depuração
- aproxima o projeto de uma mini IA especializada, mas ainda controlável

Em termos simples:

- não queremos várias “IAs” brigando entre si
- queremos um único núcleo inteligente, com especialistas cooperando em ordem

## Resumo dos arquivos principais

### Arquivos de dados

- `data/test-cases/generated.json`
  - estoque bruto de casos gerados, hoje principalmente via Gemini
- `data/test-cases/curated.json`
  - base curada que passou pelos filtros do projeto
- `data/test-cases/rejected.json`
  - base rejeitada, com os motivos da rejeição
- `data/test-cases/curated-know.json`
  - base de conhecimento que pode ensinar o corretor
- `data/test-cases/curated-proof.json`
  - base de prova usada para medir generalização
- `data/test-cases/curated-partitions-report.json`
  - relatório da divisão `know/proof`
- `data/test-cases/curated-proof-rebalance-report.json`
  - relatório de reforço da prova com movimentos reais de `know -> proof`
- `data/test-cases/latest-audit.json`
  - auditoria oficial mais recente da bateria automatizada

### Arquivos de regras aprendidas

- `data/replacements_learned.json`
  - trocas lexicais aprendidas a partir de `curated-know`
- `data/rules/phrase_rules_learned.json`
  - regras frasais aprendidas a partir de `curated-know`
- `data/rules/context_rules_learned.json`
  - regras contextuais aprendidas a partir de `curated-know`

### Scripts centrais do pipeline

- `scripts/generate-test-cases.mjs`
- `scripts/curate-test-cases.mjs`
- `scripts/build-curated-partitions.mjs`
- `scripts/rebalance-proof-from-know.mjs`
- `scripts/generate-know-learned-rules.mjs`
- `scripts/run-automated-battery.mjs`
- `scripts/fill-test-case-targets.mjs`
- `scripts/proof-driven-improvement-loop.mjs`

## Estado atual da base

No momento em que este documento foi escrito, os volumes eram:

- `generated.json`: `8570`
- `curated.json`: `5622`
- `curated-know.json`: `4796`
- `curated-proof.json`: `826`
- `rejected.json`: `6067`

Esses números mudam com o tempo. O importante não é decorar o valor exato, e sim entender o papel de cada arquivo.

## Como os dados são obtidos

### 1. Geração com Gemini

O script [`scripts/generate-test-cases.mjs`](/home/eu/Documentos/GitHub/corrija_me_pt_br/scripts/generate-test-cases.mjs) usa a API do Gemini para criar lotes de casos de teste.

O fluxo é este:

- o script monta um prompt com:
  - categoria
  - dificuldade
  - quantidade
  - formato obrigatório do JSON
- o Gemini responde com um array JSON de casos
- o script normaliza esses casos
- os casos são anexados em `data/test-cases/generated.json`
- duplicatas por par `errado/correto` são removidas

Cada caso gerado segue este formato conceitual:

```json
{
  "id": "slug-curto",
  "category": "contexto",
  "difficulty": 3,
  "errado": "texto com erro",
  "correto": "texto corrigido",
  "error_count": 2,
  "tags": ["tag1", "tag2"]
}
```

### 2. De onde vem a chave do Gemini

O script procura a chave nesta ordem:

1. variável de ambiente `GEMINI_API_KEY`
2. arquivo `.env`

Se a chave não existir, a geração falha com erro explícito.

### 3. O Gemini não entra direto no motor

Isso é importante.

Os casos gerados pelo Gemini não viram “verdade oficial” automaticamente.

Eles entram primeiro em `generated.json`, que é uma área de estoque bruto.

Ou seja:

- `generated.json` é matéria-prima
- `curated.json` é material aprovado

## Como os dados são tratados

### Curadoria automática

O script [`scripts/curate-test-cases.mjs`](/home/eu/Documentos/GitHub/corrija_me_pt_br/scripts/curate-test-cases.mjs) pega `generated.json` e decide o que entra em `curated.json` e o que vai para `rejected.json`.

Ele faz vários filtros. Entre os principais:

- rejeita item sem `errado` ou sem `correto`
- rejeita item em que `errado` e `correto` são iguais
- rejeita `difficulty` fora da faixa permitida
- rejeita `error_count` incoerente
- rejeita frase curta demais
- rejeita salto exagerado de tokens entre `errado` e `correto`
- rejeita mudança suspeita de números, moeda e certos formatos
- rejeita conteúdo fora do escopo da bateria

Também há normalização de rótulos. Por exemplo:

- `acentuacao` vira `acentuação`
- `homofonos` vira `homófonos`
- `texto_tecnico` vira `texto técnico`

### O que vai para rejeição

Quando um caso não passa, ele vai para `rejected.json` com os motivos.

Isso é importante porque:

- evita perder rastreabilidade
- permite revisar padrões de geração ruim
- ajuda a ajustar o prompt e o pipeline no futuro

## Como os dados são divididos

### O grande problema que essa divisão resolve

Se a mesma base servisse ao mesmo tempo para:

- ensinar o corretor
- e provar que ele é bom

então a medição ficaria contaminada.

Por isso o projeto separa a base em dois papéis:

- `curated-know.json`
- `curated-proof.json`

### O que é `curated-know`

`curated-know.json` é a base que pode ensinar o corretor.

Ela é usada para gerar:

- `replacements_learned.json`
- `phrase_rules_learned.json`
- `context_rules_learned.json`

Ou seja: essa base pode influenciar o comportamento do motor.

### O que é `curated-proof`

`curated-proof.json` é a base usada para medir se o motor generaliza.

Ela não deve alimentar:

- `replacements`
- regras aprendidas
- sincronização exata
- aprendizado automático do backend

Em outras palavras:

- `know` ensina
- `proof` cobra

### Como o particionamento funciona

O script [`scripts/build-curated-partitions.mjs`](/home/eu/Documentos/GitHub/corrija_me_pt_br/scripts/build-curated-partitions.mjs) pega `curated.json` e enriquece cada caso com metadados de partição.

Ele infere:

- famílias de erro
- fenômenos linguísticos
- pares específicos de transformação
- chaves de cobertura como:
  - `difficulty:3`
  - `error_count:2`
  - `phenomenon:acentuacao`
  - `diff:descriminar=>discriminar`

Depois ele escolhe o menor conjunto possível de casos para cobrir todas as famílias relevantes no `proof`.

O raciocínio é:

- um caso cobre várias famílias
- o algoritmo prioriza casos com maior cobertura
- no final ele poda casos redundantes

Resultado:

- `curated-proof.json` vira um conjunto pequeno, mas representativo
- `curated-know.json` fica com o resto

### Regra metodológica mais importante

O `proof` não é uma cópia do `know`.

A ideia não é “dividir pela metade”.

A ideia é:

- `proof` ter cobertura de fenômenos
- `know` ter volume para ensinar

## Como a prova é reforçada

### Rebalanceamento `know -> proof`

Às vezes a prova fica fraca em alguma direção:

- categoria pouco representada
- dificuldade pouco representada
- casos com múltiplos erros abaixo do desejado

Para resolver isso existe o script [`scripts/rebalance-proof-from-know.mjs`](/home/eu/Documentos/GitHub/corrija_me_pt_br/scripts/rebalance-proof-from-know.mjs).

Ele move registros reais de `curated-know.json` para `curated-proof.json`.

Ponto importante:

- isso é movimento real
- não é cópia
- depois do movimento, o item deixa de estar em `know`

Esse script também valida que não ficou sobreposição entre os dois arquivos.

## Como o motor aprende com a base

O script [`scripts/generate-know-learned-rules.mjs`](/home/eu/Documentos/GitHub/corrija_me_pt_br/scripts/generate-know-learned-rules.mjs) lê `curated-know.json` e tenta transformar pares `errado -> correto` em três tipos de ativo:

- substituições lexicais
- regras frasais
- regras contextuais

### 1. Substituições lexicais

São trocas curtas e seguras, como:

- `anciosos -> ansiosos`
- `discusão -> discussão`

Essas correções são boas quando o fenômeno é altamente previsível e pouco ambíguo.

### 2. Regras frasais

Servem para padrões pequenos de várias palavras, como:

- locuções fixas
- expressões muito recorrentes
- construções de alta confiança

### 3. Regras contextuais

Tentam corrigir uma palavra com base nos vizinhos.

Exemplo conceitual:

- se aparecer `seguem anexo os`, sugerir `seguem anexos os`

Esse tipo de regra é poderoso, mas também é o mais perigoso. Por isso precisa de revisão constante para não gerar supercorreção.

## Como o projeto evita autoengano

### O papel do `proof-pardau`

Internamente, o projeto usa o conceito de `proof-pardau`.

Esse nome resume uma regra metodológica:

- a prova só pode ser montada com `curated-proof.json`
- se `curated-proof.json` não existir, a bateria falha
- se não houver casos elegíveis, a bateria falha
- não é permitido fallback para `curated.json`
- não é permitido fallback para `generated.json`

Essa trava aparece na bateria automática em [`scripts/run-automated-battery.mjs`](/home/eu/Documentos/GitHub/corrija_me_pt_br/scripts/run-automated-battery.mjs).

Ou seja: quando a prova falta, o sistema não improvisa. Ele aborta.

Isso é uma escolha de honestidade metodológica.

## Como a bateria mede o motor

O script [`scripts/run-automated-battery.mjs`](/home/eu/Documentos/GitHub/corrija_me_pt_br/scripts/run-automated-battery.mjs) executa o backend local e compara:

- texto original com erro
- resultado produzido pela extensão/backend
- texto esperado

Ele calcula:

- `existing_errors`
  - quantos erros existiam no texto original
- `corrected_errors`
  - quantos erros foram realmente corrigidos
- `remaining_errors`
  - quantos erros sobraram
- `corrected_wrong_errors`
  - quantas correções erradas o motor introduziu
- `new_errors`
  - quantos erros novos apareceram
- `global_score`
  - percentual de acerto real sobre os erros existentes

Ele também organiza o resultado por:

- dificuldade
- categoria
- visibilidade de sugestões

O relatório final é salvo em JSON.

## Como o enriquecimento da base conversa com a melhoria do motor

Essas duas coisas são diferentes, mas se alimentam.

### Enriquecer a base

É aumentar cobertura e variedade.

Exemplos:

- gerar novos casos com Gemini
- melhorar `D5` e `D6`
- trazer famílias pouco representadas
- adicionar variantes do mesmo erro

### Melhorar o motor

É transformar o que a base revela em capacidade de correção.

Exemplos:

- endurecer heurísticas perigosas
- remover regras aprendidas ruins
- adicionar regras seguras e reaproveitáveis
- ajustar o ranking das sugestões

Em termos simples:

- base rica mostra onde o motor falha
- motor melhor transforma esse conhecimento em correção real

## O que é fonte de verdade e o que não é

### Fontes de verdade do pipeline

- `generated.json` para estoque bruto
- `curated.json` para base aprovada
- `curated-know.json` para aprendizagem
- `curated-proof.json` para prova
- relatórios JSON para auditoria e rastreabilidade

### O que não é fonte de verdade principal

- arquivos em `build/`
  - eles são artefatos gerados
- resultados temporários em `/tmp`
  - servem para ciclos de validação, não para versionamento da base

## Como um caso percorre o pipeline

Vamos seguir um caso do início ao fim:

1. o Gemini gera um item e grava em `generated.json`
2. a curadoria analisa o item
3. se ele passar, entra em `curated.json`
4. o particionador decide se ele vai para:
   - `curated-know.json`
   - `curated-proof.json`
5. se ele cair em `know`, pode virar regra aprendida
6. se ele cair em `proof`, ele passa a ser usado para medir o corretor
7. se o corretor falhar nesse caso, a falha aparece no audit
8. a partir do audit, ajustamos o motor

Esse desenho é deliberado. Ele existe para impedir que a frase da prova vire gabarito decorado.

## O que o usuário precisa guardar de tudo isso

Se você esquecer os detalhes técnicos e lembrar só do essencial, guarde estas ideias:

- `generated.json` é matéria-prima
- `curated.json` é a base aprovada
- `curated-know.json` ensina o corretor
- `curated-proof.json` testa o corretor
- `rejected.json` guarda o que foi recusado
- Gemini ajuda a gerar volume, mas não decide sozinho o que vira verdade
- a bateria oficial só aceita `curated-proof`
- a meta do projeto não é decorar frases
- a meta do projeto é generalizar correções com honestidade

## Conclusão técnica

O pipeline atual foi desenhado para equilibrar quatro coisas ao mesmo tempo:

- volume de dados
- curadoria
- aprendizagem útil
- medição honesta

Isso faz o projeto parecer mais complexo do que um corretor baseado só em dicionário ou só em regex, mas essa complexidade existe por um motivo:

- reduzir correções perigosas
- evitar autoengano metodológico
- permitir evolução incremental com rastreabilidade

Em uma frase:

o projeto trata a base de dados não como “um monte de frases”, mas como uma infraestrutura de aprendizagem, prova e auditoria.
