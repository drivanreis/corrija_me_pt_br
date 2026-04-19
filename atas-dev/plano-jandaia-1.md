# Plano de implantacao - Jandaia-1

## Objetivo

Fazer a `Jandaia-1` nascer mais rapido como uma camada propria do produto, sem esperar uma LLM final perfeita desde o inicio.

A ideia central e:

- manter o `motor` como camada rapida, previsivel e barata
- usar a `Jandaia-1` como fallback qualificado
- usar `Tucano-2` e `QuillBot` como referencias de comportamento e conhecimento
- usar `Gemini` como arbitro externo, consultor tecnico e apoio de curadoria e, quando on-line e explicitamente habilitado, como etapa final opcional de correcao

## Restricoes de produto que passam a ser obrigatorias no plano

- o produto deve funcionar `quase off-line`
- o runtime principal nao pode depender de servidor backend pago da equipe
- o runtime principal nao pode exigir compartilhamento de chave de API do usuario
- `Gemini` fica por padrao restrito a desenvolvimento, auditoria, curadoria e apoio tecnico; quando on-line e habilitado, pode existir como trilha final opcional (sem ser requisito do runtime)
- internet continua permitida apenas para:
  - atualizacoes futuras
  - novas regras, palavras e recursos
  - distribuicao de novas versoes

## Duas trilhas em paralelo

O projeto passa a seguir em paralelo em duas frentes obrigatorias:

1. desenvolvimento da `Jandaia-1`
2. instalacao e distribuicao do produto

Regra de condução:

- discutir instalacao nao pode parar o desenvolvimento
- discutir desenvolvimento nao pode empurrar instalacao para depois

## Leitura honesta do problema

O risco de tentar construir uma LLM totalmente propria logo de cara e alto:

- leva tempo demais
- custa caro
- dificulta validacao
- atrasa a entrega do produto real

O caminho mais viavel e criar primeiro uma `Jandaia-1` como sistema hibrido:

- parte simbolica
- parte heuristica
- parte orquestradora
- parte local de IA

Depois disso, ela pode evoluir para algo cada vez mais proprio.

## Definicao operacional da Jandaia-1

Nesta fase, `Jandaia-1` nao significa apenas "um modelo".

Ela passa a significar:

1. uma politica de roteamento
2. um contrato de fallback do backend
3. um prompt e uma identidade de correcao
4. uma base especializada em portugues do Brasil
5. uma camada local de IA que recebe apenas os casos em que o `motor` nao fecha com seguranca

## Venn da ideia

Leitura pratica do diagrama:

- `motor`
  - camada externa operacional
  - prioriza velocidade, estabilidade e previsibilidade
- `Tucano-2`
  - referencia de base local
  - fonte para inspirar conhecimento, comportamento e especializacao
- `QuillBot`
  - referencia de qualidade de reescrita
  - ajuda a comparar naturalidade, fluidez e correcao final
- `Jandaia-1`
  - intersecao util entre essas referencias
  - nasce como camada propria do produto
- `Gemini`
  - consultor externo
  - arbitra duvidas
  - ajuda a decidir casos de impasse e enriquecer a base

## Estrategia de implantacao

## Status atual

- fase 1 concluida
  - arquitetura explicitada no backend
  - papeis de `motor`, `Jandaia-1`, `Tucano-2`, `QuillBot` e `Gemini` expostos
- fase 2 iniciada e implantada no primeiro ciclo
  - fallback da `Jandaia-1` endurecido
  - textos curtos ficam no `motor`
  - casos ambiguos e acoplados passam a sinalizar fallback de forma explicita
  - smoke test cobre arquitetura e roteamento
- fase 3 iniciada
  - bancada local para medir `motor` vs fluxo hibrido implantada
  - relatorio passa a mostrar taxa de acerto, latencia e motivos de roteamento
  - readiness oficial implantada para mostrar se falta modelo local, Ollama ou habilitacao do `llm_core`
  - ativacao local concluida com modelo `GGUF` e `Ollama` respondendo
  - novo entendimento operacional consolidado:
    - `motor` continua como resposta inicial obrigatoria
    - `Jandaia-1` nao pode prender a experiencia do usuario em hardware fraco
    - passa a valer um teto de `15s` por requisicao para o fluxo qualificado
    - acima disso, a resposta final volta automaticamente para o `motor`

## Nova politica de execucao

Leitura pratica da nova ideia:

- `motor` resolve e protege os casos simples
- `Jandaia-1` trabalha apenas nos casos complexos, em trilha separada e orcada
- o backend passa a operar com `timeout` duro
- o produto nao fica refem da LLM local

Regra inicial de produto:

- `0s` a `2s`
  - zona ideal
- `2s` a `15s`
  - zona aceitavel para caso dificil
- acima de `15s`
  - a `Jandaia-1` perde a vez naquela requisicao
  - o sistema entrega a saida do `motor`

## Decisao nova sobre base local

Leitura consolidada:

- modelos `7B` e `9B` deixam de ser alvo principal do runtime local
- eles podem existir como trilha de comparacao, mas nao como direcao central do produto
- `Tucano-2` sai da posicao de base local preferida
- `Tucano-2` fica mantido apenas como referencia historica e comparacao controlada
- `Qwen2.5-1.5B` entra como nova base candidata principal da `Jandaia-1`

Motivo:

- melhor alinhamento com maquinas modestas
- menor risco de latencia proibitiva
- mais coerencia com o objetivo de aplicacao gratuita e quase off-line

## Decisao nova sobre instalacao

- o `.zip` principal entrega primeiro o produto base
- o `motor` continua sendo a experiencia padrao
- a `Jandaia` nao e obrigatoria na instalacao inicial
- a ativacao da `Jandaia` passa a ser uma etapa opcional
- o pacote ja deve carregar os arquivos e scripts necessarios para essa etapa opcional

### Fase 1 - explicitar a arquitetura no backend

Objetivo:

- deixar o runtime autoexplicavel
- tornar os papeis das camadas visiveis
- preparar o contrato para crescimento sem improviso

Entregas:

- rota de arquitetura mais rica
- health com papeis declarados
- metadados de roteamento no fluxo smart

### Fase 2 - endurecer a politica de roteamento da Jandaia

Objetivo:

- mandar para `Jandaia-1` apenas os casos certos
- evitar custo e latencia desnecessarios

Criticos:

- homofonos
- porques
- multiplas edicoes acopladas
- baixa confianca do motor
- conflitos entre candidatos

Status:

- implantada no primeiro ciclo
- ainda pode ser refinada com novas familias de gatilho

### Fase 3 - transformar referencias em ativo proprio

Objetivo:

- converter observacoes de `Tucano-2`, `QuillBot` e `Gemini` em base do produto

Ativos:

- casos curados
- regras aprendidas
- regras proof
- rejeicoes explicitas
- historico de auditoria

### Fase 4 - criar perfil proprio de correcao

Objetivo:

- fazer a `Jandaia-1` ter assinatura propria

Assinatura desejada:

- corrige preservando sentido
- evita sofisticacao desnecessaria
- prefere menor correcao suficiente
- respeita portugues brasileiro real
- melhora frase inteira quando necessario

### Fase 5 - medir como produto, nao como experimento solto

Objetivo:

- comparar `motor`
- comparar `Jandaia-1`
- comparar `motor + Jandaia`
- usar `Gemini` como juiz quando houver duvida qualitativa

Ferramentas ja implantadas:

- `npm run benchmark:hybrid`
  - compara `POST /v2/check` com `POST /v2/check-smart`
  - mede acerto exato, latencia e motivos de roteamento
- `npm run benchmark:llm-arbiter`
  - bancada com arbitragem externa via `Gemini`
- `npm run check:jandaia`
  - mostra se a `Jandaia-1` esta pronta para ativacao local
  - verifica modelo configurado, arquivo local, acesso ao Ollama e estado do `llm_core`

## Proximo desenho tecnico

O backend deve operar assim:

1. `POST /v2/check`
   - motor puro
2. `POST /v2/check-smart`
   - motor primeiro
   - Jandaia como fallback orcado
   - teto de `15s`
   - fallback automatico para o `motor` quando a LLM nao entregar a tempo
   - metadados de decisao expostos
3. `GET /v2/architecture`
   - contrato do runtime
   - papeis
   - referencias
   - status de implantacao

## O que nao fazer agora

- nao tentar fundir modelos grandes de forma prematura
- nao eleger modelos `7B` e `9B` como alvo principal local
- nao tratar `Gemini` como dependencia de runtime principal
- nao substituir o `motor`
- nao transformar `QuillBot` em dependencia operacional

## O que fazer agora

1. Consolidar `Qwen2.5-1.5B` como nova base candidata principal da `Jandaia-1`.
2. Manter `Tucano-2` apenas como trilha de comparacao e legado.
3. Endurecer a `Jandaia-1` com prompt rigido, saida estruturada e especializacao real.
4. Implantar a instalacao opcional da `Jandaia` nos pacotes.
5. Continuar fortalecendo o `motor` como primeira defesa.

## Prioridade imediata apos esta rodada

O proximo gargalo real deixou de ser arquitetura.

Agora o gargalo e:

- manter a `Jandaia-1` util sem degradar a experiencia do usuario
- medir quando ela realmente muda a saida dentro do teto de tempo
- verificar se ela melhora ou piora frente ao `motor`
- validar se `Qwen2.5-1.5B` se comporta melhor do que a trilha antiga baseada em `Tucano-2`
- transformar o corpus proprio da `Jandaia` em ativo de especializacao de verdade
- finalizar a experiencia de instalacao base + ativacao opcional da LLM

Em termos praticos:

- a ativacao local ja existe
- o proximo passo util e transformar essa ativacao em ganho real sob SLA de `15s`
- para isso, o projeto passa a preparar a troca de base sem quebrar o runtime atual

## Marco de sucesso

Vamos considerar esta fase bem-sucedida quando:

- o backend estiver arquiteturalmente claro
- o `motor` continuar rapido e forte
- a `Jandaia-1` entrar apenas onde agrega
- a base local principal caber melhor em hardware modesto
- o produto melhorar sem depender de uma LLM final perfeita
- a base propria do projeto crescer de forma organizada
