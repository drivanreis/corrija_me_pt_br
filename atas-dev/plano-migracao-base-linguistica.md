# Plano de migracao da base linguistica

## Objetivo

Migrar o `corrija_me_pt_br` de uma base predominantemente lexical e heuristica para uma base estruturada por camadas, sem perder a bateria automatizada, a curadoria atual e o desempenho do produto.

## Principios

- migrar sem apagar o legado
- medir tudo com a bateria automatizada
- priorizar reducao de correcoes perigosas
- introduzir inteligencia estrutural antes de aumentar muito a complexidade
- reaproveitar o melhor do legado, e nao o maximo
- tratar cobertura contaminada como passivo, nao como ativo

## Etapa 1. Fundacao

- criar `data/linguistic/`
- definir `manifest.json`
- definir schemas iniciais
- criar loader dedicado no backend
- integrar a nova camada ao carregamento atual

Critero de saida:

- backend sobe com a nova base
- validacao de dados continua funcionando
- build continua empacotando os novos arquivos

## Etapa 2. Ganho seguro imediato

- migrar pronomes, artigos, verbos frequentes e excecoes tecnicas
- alimentar `words` com entradas estruturadas
- bloquear autocorrecao agressiva para itens sensiveis

Status atual:

- revisada com criterio de qualidade
- duplicacoes removidas e promocoes antigas reclassificadas

Resultado da auditoria final:

- descartado por baixo valor demonstrado:
  - `contrarregra`
- promovidos para base estavel:
  - `voo`
  - `domicilio`
  - `senhoria`
  - `taxar`
  - `cozer`
- mantidos em `review` por risco semantico real:
  - `cheque`
  - `xeque`
  - `tachar`

Critero de saida:

- queda de falso positivo em palavras tecnicas e ambiguas
- nenhuma regressao relevante no percentual geral

## Etapa 3. Concordancia verbal basica

- usar `Concordancia/verbal.json`
- usar `Regras/conjugacao_verbal.json`
- usar `Irregularidades/verbos_irregulares.json`
- implementar deteccao de padroes simples como `pronome + verbo`

Status atual:

- revisada com criterio de honestidade de cobertura
- mantida no recorte conservador de alta confianca

Resultado da auditoria inicial:

- preservado:
  - `eu + verbo`
  - `ele/ela + verbo`
  - `você + verbo`
  - `a gente + verbo`
  - `nós + verbo`
  - `vocês + verbo`
  - `eles/elas + verbo`
  - um adverbio curto ou clitico no caminho
  - bloqueio de falso positivo em contexto de infinitivo
- removido da declaracao de cobertura:
  - `tu + verbo`
  - motivo: o dado declarava suporte, mas a base atual nao entrega cobertura real suficiente para esse paradigma

Critero de saida:

- ganho mensuravel em erros de primeira e terceira pessoa
- reducao de correcoes perigosas em verbos proximos

## Etapa 4. Concordancia nominal basica

- usar `artigos.json`, `substantivos.json` e `adjetivos.json`
- usar `Concordancia/nominal.json`
- usar `flexao_nominal.json` e `plurais_irregulares.json`

Status atual:

- concluida no recorte basico e revisada com criterio de cobertura real
- integrada ao motor com validacao automatizada

Cobertura entregue:

- `determinante + substantivo`
- `substantivo + adjetivo`
- `determinante + substantivo + adjetivo`
- predicativo nominal simples com `ser/estar`
- construcoes frequentes como `segue anexo as notas`

Resultado da auditoria final:

- preservado:
  - o motor baseado em lexico, flexao nominal e padroes curtos reais
  - plural nominal simples
  - adjetivo variavel em grupo nominal
  - predicativo nominal simples
  - construcoes recorrentes como `segue anexo as notas`
- descartado como cobertura apenas declarativa:
  - `Concordancia/nominal.json`
  - motivo: a camada nao participava de fato da decisao do motor e so criava impressao de estrutura maior do que a cobertura real

Critero de saida:

- ganho em genero e numero em estruturas simples

Resultado observado:

- primeira camada nominal funcional ja esta ativa no backend
- smoke test cobre plural nominal, adjetivo variavel e predicativo nominal simples
- a etapa foi encerrada sem introduzir regressao no build, no typecheck ou no `test:backend`

## Etapa 5. Sintaxe simples de alta confianca

- ativar `Sintaxe/padroes_basicos.json`
- validar apenas estruturas curtas e repetidas na bateria
- evitar parser profundo

Status atual:

- em andamento com cobertura inicial funcional
- integrada ao motor com smoke test dedicado

Cobertura entregue ate agora:

- leitura de `Sintaxe/padroes_basicos.json`
- reconhecimento de padroes curtos validos como:
  - `pronome + verbo`
  - `pronome + adverbio + verbo`
  - `pronome + verbo + adverbio`
  - `pronome + verbo + substantivo`
  - `pronome + verbo + adjetivo`
  - `pronome + verbo + artigo + substantivo`
  - `artigo + substantivo`
  - `artigo + substantivo + adjetivo`
  - `artigo + substantivo + verbo`
  - `artigo + substantivo + verbo + adverbio`
  - `artigo + substantivo + verbo + artigo + substantivo`
  - `verbo + artigo + substantivo`
  - `verbo + artigo + substantivo + adverbio`
  - `verbo + adverbio`
  - `verbo + preposicao`
  - `verbo + preposicao + artigo + substantivo`
  - `pronome + verbo + preposicao + substantivo`
  - `pronome + verbo + preposicao + artigo + substantivo`
  - `artigo + substantivo + verbo + preposicao + substantivo`
  - `artigo + substantivo + verbo + preposicao + artigo + substantivo`
  - `preposicao + substantivo`
- sinalizacao conservadora de estruturas simples improvaveis
- preferencia por padroes maiores validos antes de sinalizar janelas curtas menores
- preferencia por padroes exatos do mesmo tamanho antes de sinalizar estruturas curtas como suspeitas
- bloqueio de analise sintatica ao cruzar fronteiras fortes de frase
- filtro para evitar ruido quando o entorno imediato ainda nao e legivel pela camada sintatica

Critero de saida:

- melhoria em contexto sem crescimento grande de falso positivo

Resultado observado:

- a camada sintatica basica ja esta ativa no backend
- o smoke test confirma que estruturas curtas improvaveis sao sinalizadas
- o smoke test tambem confirma que frases curtas validas como `Você já enviou o relatório.`, `Eu assino o documento agora.`, `Ela é dedicada.` e `O projeto precisa de uma revisão.` nao geram alerta sintatico indevido
- o smoke test tambem confirma que estruturas validas com verbo inicial como `Traga o relatório agora.` e `Venha conferir as ofertas.` nao geram alerta sintatico indevido
- o smoke test tambem confirma que estruturas validas com complemento preposicionado como `Você precisa de revisão.` e `Traga o relatório para análise.` nao geram alerta sintatico indevido
- o smoke test tambem confirma que estruturas validas com contracoes prepositivas e grupos curtos como `Vou analisar a exceção no processo.` e `A reunião foi ao lado da sala.` nao geram alerta sintatico indevido

Resultado da auditoria inicial:

- preservado:
  - nucleo de padroes efetivamente sustentado por smoke test e pelo comportamento atual do motor
  - recorte conservador voltado a sujeito, verbo, objeto simples e complemento preposicionado curto
- podado:
  - padroes que ampliavam a lista declarada sem prova suficiente de ganho real
  - o objetivo da poda foi reduzir superficie de ruido, nao ampliar cobertura no papel

## Etapa 6. Conversores e curadoria

- criar script para converter entradas do legado para a nova base
- usar Gemini como enriquecedor e nao como fonte final
- registrar rejeicoes e ambiguidades para revisao humana

Status atual:

- concluida com pipeline funcional e curadoria assistida
- conversor inicial ja gera lotes de migracao revisaveis

Cobertura entregue ate agora:

- script `scripts/migrate-legacy-language-data.mjs`
- geracao automatica de artefatos em `data/linguistic/migration/`
- separacao inicial entre:
  - candidatos lexicais
  - candidatos a excecao
  - candidatos de substituicao vindos de `common_mistakes.json`
  - itens pulados por ja estarem cobertos na base estruturada
- heuristicas iniciais para classificar:
  - termos tecnicos
  - verbos no infinitivo
  - formas verbais flexionadas frequentes
  - pronomes e formas de tratamento recorrentes do legado
  - adjetivos recorrentes como a familia `seminovo`
- filtro para nao recandidatar:
  - itens ja cobertos por `forms` no lexico estruturado
  - substituicoes ja promovidas para `data/replacements.json`

Resultado observado:

- a Etapa 6 ja produz um lote concreto de curadoria a partir de `custom_words.txt` e `common_mistakes.json`
- o primeiro passe do conversor mostrou onde a heuristica era bruta demais, e ja foi refinado para reduzir classificacoes erradas de pronome e verbo como substantivo
- os artefatos gerados permitem revisar promocao de dados sem editar diretamente o legado
- a etapa ainda nao promove itens automaticamente para a base final; ela prepara revisao humana assistida
- na rodada atual, o pipeline gerou `18` candidatos lexicais, `1` candidato de excecao, `10` candidatos de substituicao e pulou `22` itens ja cobertos
- o primeiro lote seguro ja foi promovido manualmente para a base estruturada com pronomes, substantivos estaveis e uma locucao de tratamento formal
- a segunda leva da etapa promoveu um lote pequeno de substituicoes ortograficas seguras para `data/replacements.json`, mantendo de fora casos mais dependentes de contexto
- a terceira leva promoveu verbos claros do legado e refinou o conversor para nao sugerir novamente itens ja cobertos por `forms` no lexico estruturado
- no fechamento da etapa, `através` foi absorvido pela base estruturada e o conversor passou a deixar no lote apenas pendencias realmente contextuais

Critero de saida:

- pipeline claro de entrada, revisao e promocao de novos dados

## Etapa 7. Desativacao gradual do legado

- manter coexistencia entre o modelo antigo e o novo
- desligar dependencias antigas somente onde o novo provar vantagem
- preservar compatibilidade com o build e com o pacote portatil

Status atual:

- concluida no runtime
- `custom_words.txt` ja foi desligado do carregamento padrao
- `common_mistakes` legado ja foi desligado do carregamento runtime
- `words_01.txt` ja foi desligado do carregamento runtime

Cobertura entregue ate agora:

- controle separado para:
  - `wordFiles` do legado
  - `custom_words.txt`
  - `common_mistakes.json`
- exposicao dessas chaves no `/health` do backend para acompanhamento operacional
- desligamento efetivo das tres chaves no manifesto do dicionario

Resultado observado:

- a primeira desativacao ocorreu sobre a parte mais segura do legado, porque a Etapa 6 deixou `custom_words.txt` totalmente coberto pela base estruturada
- o backend continua funcional com coexistencia entre a base nova e os blocos legados ainda necessarios
- `common_mistakes.json` passou a conviver so como camada residual, porque tudo que ja foi promovido para `data/replacements.json` deixa de ser recarregado pelo backend legado
- nesta rodada, `reconhe-se` tambem foi promovido para a camada principal, reduzindo ainda mais a dependencia do legado
- o legado funcional de erros comuns foi reduzido a um arquivo residual com uma unica entrada supervisionada, `calsado`, mantendo o risco semantico sob controle ate decisao final
- depois da revisao de qualidade das Etapas 2 a 5, o runtime passou a operar sem carregar `common_mistakes` legado
- `calsado` permanece apenas como resíduo documentado e nao como cobertura ativa do backend
- por decisao de qualidade, `words_01.txt` deixou de participar do runtime porque sua cobertura ampla era considerada desorganizada e pouco confiavel
- o enriquecimento futuro passa a ocorrer apenas pelo novo modelo, com curadoria e criterios explicitos de confiabilidade
- o runtime atual opera sem dependencia ativa de arquivos legados
- o legado restante passa a existir apenas como material historico, de referencia ou auditoria

Critero de saida:

- o novo modelo participa das decisoes principais do motor
- a manutencao dos dados fica mais previsivel do que antes

## Consolidacao antes do descarte final

Objetivo:

- repassar todas as etapas com criterio de qualidade
- manter apenas o que trouxe ganho real e confiavel
- descartar definitivamente o legado so depois dessa revisao

Regra central:

- aproveitar o melhor do legado e das migracoes
- nao perseguir reaproveitamento maximo se isso carregar ruido antigo, heuristicas ruins ou correcoes perigosas

Checklist de revisao:

- Etapa 1:
  - confirmar se o schema atual continua simples, expansivel e sem rigidez desnecessaria
- Etapa 2:
  - revisar itens sensiveis com `autoCorrect: review` e `blocked`
  - remover entradas promovidas que nao estejam trazendo valor real
  - eliminar duplicacoes entre lexico tecnico e excecoes quando a cobertura ja estiver garantida por uma camada so
  - podar itens migrados do legado que nao tenham apoio em uso real, regra ativa ou ganho mensuravel
  - promover para base estavel os itens que deixaram de ser duvida real, removendo a marca de legado quando ela nao agrega mais criterio
  - manter em `review` apenas pares realmente confusiveis ou semanticamente perigosos
- Etapa 3:
  - revisar verbos e sujeitos com foco em falso positivo
  - manter apenas padroes de alta confianca
- Etapa 4:
  - revisar concordancia nominal em estruturas de uso real
  - retirar coberturas artificiais ou raras que aumentem risco
- Etapa 5:
  - reavaliar cada padrao sintatico curto
  - manter so os que comprovadamente reduzem erro sem ruido relevante
- Etapa 6:
  - auditar tudo que foi promovido do legado
  - marcar como residual ou remover o que estiver contaminado por decisoes antigas
- Etapa 7:
  - desligar as chaves remanescentes do legado somente depois da auditoria acima

Critero de descarte definitivo do legado:

- `custom_words.txt` totalmente dispensavel
- `common_mistakes` legado zerado ou reduzido a zero por decisao consciente
- dependencias de `wordFiles` antigas avaliadas contra a base estruturada e mantidas apenas se ainda forem realmente necessarias
- nenhuma cobertura importante depender de arquivo legado sem justificativa explicita

Decisao operacional:

- antes do descarte final, a pergunta nao sera "o que ainda da para aproveitar?"
- a pergunta sera "o que merece sobreviver porque melhora qualidade sem reintroduzir problemas antigos?"

## Ajustes arquiteturais recomendados

Estes pontos surgem como aprendizado da migracao e devem orientar a proxima fase do projeto.

### 1. Sintaxe com janela analisavel

Risco identificado:

- a camada sintatica pode voltar a crescer por enumeracao manual de padroes
- isso tende a aumentar manutencao, ruido e dificuldade de escala

Direcao recomendada:

- substituir crescimento por lista por uma ideia de `janela analisavel`
- introduzir `confianca` por padrao
- permitir agrupamento por papel simples, como:
  - sujeito
  - nucleo
  - complemento

Decisao tecnica:

- manter o nucleo atual de alta confianca
- evitar nova explosao combinatoria de `padroes_basicos.json`

### 2. Concordancia nominal em forma operacional

Aprendizado:

- o antigo `Concordancia/nominal.json` foi descartado corretamente porque nao participava da decisao do motor
- isso nao elimina a utilidade do conceito de concordancia nominal estruturada

Direcao recomendada:

- reintroduzir o conceito em forma menor e realmente operacional
- exemplo desejado:
  - grupos nominais ou papeis simples que o motor consiga consumir

Decisao tecnica:

- nao restaurar arquivo declarativo morto
- recriar apenas se a estrutura entrar de fato no fluxo do motor

### 3. Separacao explicita entre regra e heuristica

Risco identificado:

- o sistema ainda usa heuristicas necessarias, mas elas podem se espalhar e tornar a arquitetura hibrida demais

Direcao recomendada:

- toda nova decisao deve responder:
  - isto e regra?
  - isto e heuristica?

Decisao tecnica:

- regra deve ser empurrada para dados estruturados sempre que possivel
- heuristica deve ser pequena, explicita, auditavel e justificada

### 4. Camada de token classificado

Lacuna identificada:

- ainda falta uma camada explicita de token observado com multiplas possibilidades de classe

Direcao recomendada:

- introduzir estrutura como:
  - token observado
  - candidatos de classe
  - contexto local

Exemplo conceitual:

```json
{
  "token": "fala",
  "candidatos": [
    { "classe": "verbo", "confianca": "alta" },
    { "classe": "substantivo", "confianca": "media" }
  ]
}
```

Decisao tecnica:

- essa camada deve entrar antes de qualquer ambicao maior de analise sintatica

### 5. Camada explicita de confianca

Lacuna identificada:

- o sistema ainda depende demais de decisoes binarias, mesmo ja tendo sinais como `allow`, `review` e `blocked`

Direcao recomendada:

- adicionar confianca explicita para classificacao, sugestao e aplicacao de correcoes

Forma inicial sugerida:

- `alta`
- `media`
- `baixa`

Decisao tecnica:

- nao comecar por score numerico em tudo
- primeiro estabilizar uma escala simples e auditavel

## Prioridade da proxima fase

Ordem recomendada:

1. introduzir camada explicita de confianca
2. introduzir conceito de token classificado
3. refatorar a sintaxe para janela analisavel com peso
4. reintroduzir concordancia nominal estruturada em forma realmente usada pelo motor
