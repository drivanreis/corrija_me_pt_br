# Matriz de Compatibilidade por Site

## Objetivo

Organizar, por tipo de ambiente, como o `corrija_me_pt_br` deve detectar o campo certo, ler o texto certo, marcar erros e aplicar correções.

Essa matriz evita correções improvisadas e ajuda a tratar cada site com estratégia própria.

## Categorias

### 1. Página simples controlada

Exemplos:

- `https://drivanreis.github.io/corrija_me_pt_br/`
- páginas próprias de teste
- formulários simples

Características:

- `input`
- `textarea`
- `contenteditable` simples
- DOM previsível

Status atual:

- bom

Riscos:

- overlay visual em `input` e `textarea` ainda pode exigir refinamento fino

Estratégia:

- manter como laboratório oficial
- validar primeiro aqui antes de qualquer site externo

### 2. Editores ricos comuns

Exemplos:

- WhatsApp Web
- Telegram Web
- ChatGPT
- Gemini
- Grok
- campos modernos em SPAs

Características:

- `contenteditable`
- mutações frequentes de DOM
- foco pode mudar sem evento tradicional
- mensagens e interface convivem no mesmo DOM

Status atual:

- parcial

Problema típico:

- a extensão pode capturar o texto errado da interface
- ou achar um editor visível que não é o campo real de digitação

Estratégia:

- detectar seletor do editor real por site
- restringir leitura ao container correto
- separar leitura do texto digitado da leitura da conversa inteira
- registrar heurísticas específicas por site

### 3. Editores complexos

Exemplos:

- Google Docs
- Notion
- editores com iframes
- editores com múltiplas camadas visuais

Características:

- editor virtualizado
- múltiplos frames ou superfícies
- offsets difíceis
- texto renderizado não corresponde diretamente ao DOM visível

Status atual:

- inicial

Problema típico:

- difícil encontrar o texto real
- difícil aplicar correção no ponto certo
- difícil marcar visualmente sem interferir no editor

Estratégia:

- abordagem dedicada por produto
- compatibilidade por camadas
- estudar a arquitetura interna antes de codar

### 4. Ambientes hostis ou muito dinâmicos

Exemplos:

- apps web que re-renderizam constantemente
- componentes com shadow DOM pesado
- interfaces que desmontam e remontam o editor

Características:

- perda de referência do campo ativo
- mutação constante
- possível quebra do estado da extensão

Status atual:

- baixo

Estratégia:

- observar mutações
- reanexar comportamento com segurança
- evitar assumir que o elemento anterior continua vivo

## Sites prioritários

### Página de teste oficial

URL:

- `https://drivanreis.github.io/corrija_me_pt_br/`

Prioridade:

- máxima

Objetivo:

- ambiente controlado de validação

Critério de sucesso:

- detectar o campo certo
- sublinhar
- clicar na palavra
- mostrar sugestões
- aplicar substituição

### WhatsApp Web

URL:

- `https://web.whatsapp.com/`

Prioridade:

- alta

Problema observado:

- extensão encontrou texto errado da interface
- não analisou a mensagem digitada corretamente

Hipótese:

- seletor do editor ativo está amplo demais
- o content script está lendo um `contenteditable` errado

Próximo passo:

- mapear o editor real
- limitar a leitura ao composer correto

### Google Docs

URL:

- `https://docs.google.com/`

Prioridade:

- altíssima

Problema esperado:

- editor especial
- texto e renderização não seguem o fluxo comum

Próximo passo:

- investigação dedicada
- compatibilidade própria

### ChatGPT / Gemini / Grok

Prioridade:

- alta

Objetivo:

- garantir boa experiência em prompts

Problema esperado:

- SPAs com `textarea` ou `contenteditable`
- re-render frequente

Próximo passo:

- mapear campo por produto
- validar foco, overlay e aplicação

## Critério de decisão daqui para frente

Antes de mexer no código para um site específico, responder:

1. Qual é a categoria do site?
2. O campo é `input`, `textarea`, `contenteditable`, iframe ou editor virtualizado?
3. O texto capturado é realmente o texto digitado?
4. O problema está em:
   - foco
   - leitura do texto
   - offsets
   - sublinhado
   - aplicação da correção
5. A solução deve ser:
   - genérica
   - ou específica para aquele site?

## Ordem recomendada de trabalho

1. Consolidar a página de teste oficial
2. Estudar WhatsApp Web
3. Estudar chats de IA
4. Estudar Google Docs com investigação própria

## Conclusão

O projeto não deve mais evoluir no modo “corrigir bug isolado no escuro”.

A partir daqui, cada integração deve ser tratada como:

- um tipo de editor
- uma categoria de ambiente
- uma estratégia de compatibilidade

Isso reduz retrabalho e aumenta muito a chance de o `corrija_me_pt_br` evoluir com consistência.
