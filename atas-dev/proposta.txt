Proposta técnica de reestruturação da base linguística do `corrija_me_pt_br`

## 1. Diagnóstico direto

Sim, faz sentido dizer que parte importante dos problemas e limitações atuais nasce da forma como o projeto começou.

O início com um `word.txt` sem estrutura não foi um erro inútil. Pelo contrário: ele foi útil para validar a ideia, ganhar volume, acelerar o protótipo e permitir que o corretor começasse a existir de verdade.

Mas agora essa escolha inicial passou a cobrar um preço alto:

- dificuldade de manutenção
- mistura entre palavra válida, regra, exceção e heurística
- crescimento desorganizado
- dificuldade para reduzir falsos positivos e falsos negativos
- dificuldade para tratar concordância, flexão e contexto com mais inteligência
- risco de correções perigosas por falta de base semântica e morfológica

Resumo sincero: o modelo antigo foi bom para tração inicial, mas hoje limita a evolução de qualidade.

## 2. O que não devemos perder

Mesmo mudando a arquitetura da base linguística, não devemos abrir mão das grandes conquistas já obtidas:

1. Consumo da API do Gemini para enriquecer arquivos JSON com mais qualidade.
2. Ciclo de melhoria contínua orientado por teste, auditoria, ajuste do motor e nova medição.
3. Indexação e tokenização dos JSONs para manter boa performance.
4. Registro em atas de desenvolvimento para preservar contexto, decisões e evitar retrabalho.
5. Bateria automatizada que mede acerto real, erro restante, correção errada e erro novo.
6. Curadoria em camadas como `generated.json`, `curated.json` e `rejected.json`.

Conclusão importante: a mudança não deve ser um recomeço do zero. Ela deve ser uma migração com reaproveitamento máximo.

## 3. Minha opinião técnica sobre a proposta

Minha opinião é favorável à adoção do novo modelo.

A ideia central está correta: separar a base por responsabilidade linguística tende a melhorar manutenção, previsibilidade, auditoria e capacidade de evolução do motor.

Mas eu recomendo um ajuste importante:

O modelo não deve ser apenas uma separação por arquivos. Ele precisa ser também uma separação por camadas de decisão.

Ou seja:

- o léxico deve dizer o que a palavra é
- as regras devem dizer como ela varia
- a concordância deve dizer quando uma forma é compatível
- a sintaxe deve ajudar a validar estruturas simples
- as exceções devem bloquear comportamentos perigosos
- o motor deve decidir com conservadorismo quando corrigir e quando não corrigir

Se isso virar apenas uma reorganização de arquivos, sem mudança de lógica no motor, o ganho será limitado.

## 4. Estrutura proposta

Sugestão de organização:

```text
Dicionario/
├── Lexico/
│   ├── verbos.json
│   ├── substantivos.json
│   ├── pronomes.json
│   ├── artigos.json
│   ├── preposicoes.json
│   ├── conjuncoes.json
│   ├── adverbios.json
│   ├── interjeicoes.json
│   ├── adjetivos.json
│   └── palavras_multiclasse.json
├── Regras/
│   ├── conjugacao_verbal.json
│   ├── flexao_nominal.json
│   └── derivacao.json
├── Concordancia/
│   ├── verbal.json
│   └── nominal.json
├── Irregularidades/
│   ├── verbos_irregulares.json
│   └── plurais_irregulares.json
├── Sintaxe/
│   └── padroes_basicos.json
└── Excecoes/
    ├── locucoes.json
    └── palavras_desconhecidas.json
```

Essa estrutura faz sentido e eu manteria essa divisão lógica.

## 5. Ajuste arquitetural recomendado

Embora a divisão acima seja boa, eu não trataria cada palavra como pertencendo para sempre a apenas uma classe isolada.

No português real, várias palavras são ambíguas ou multiclasse. Portanto, o schema precisa aceitar isso desde o começo.

Em vez de pensar apenas assim:

```json
{
  "canto": ["verbo", "substantivo"]
}
```

Eu recomendo pensar em algo mais expansível, como:

```json
{
  "canto": {
    "classes": ["verbo", "substantivo"],
    "confianca_lexical": "alta",
    "observacoes": ["ambigua"]
  }
}
```

Ou seja: a estrutura pode continuar separada por categorias, mas o schema interno deve aceitar:

- múltiplas classes
- traços morfológicos
- traços de concordância
- irregularidades
- observações de uso
- bloqueios de correção automática quando houver ambiguidade alta

Esse ponto é importante para não engessar a evolução futura.

## 6. Avaliação de cada camada

### Lexico

Excelente ideia. É a camada mais necessária neste momento.

Ela deve responder perguntas como:

- esta palavra existe?
- qual a classe mais provável?
- ela varia em gênero?
- ela varia em número?
- ela é irregular?
- ela costuma aparecer em contexto técnico?

### Regras

Excelente e obrigatória.

Sem regras explícitas de flexão e conjugação, o motor fica dependente demais de aproximação ortográfica e passa a sugerir coisas absurdas.

Essa camada deve gerar formas possíveis e validar se uma forma suspeita está perto de uma forma legítima.

### Concordancia

Essencial para a próxima fase do projeto.

Hoje ela é uma das melhores oportunidades de ganho estrutural, porque boa parte dos erros restantes já não é apenas ortografia simples, mas ajuste entre sujeito, verbo, artigo, substantivo e adjetivo.

### Irregularidades

Obrigatória.

Português tem irregularidade demais para confiar só em regra geral.

### Sintaxe

Boa ideia, mas com limite.

Eu recomendo começar apenas com padrões simples e de alta confiança, por exemplo:

- pronome + verbo
- artigo + substantivo
- artigo + substantivo + adjetivo
- substantivo + verbo + complemento

Não tentaria transformar isso cedo demais em um parser sintático completo.

### Excecoes

Obrigatória.

Essa camada é vital para evitar comportamento destrutivo em:

- locuções fixas
- siglas
- estrangeirismos permitidos
- termos técnicos
- nomes próprios
- tokens mistos
- palavras que não devem ser corrigidas automaticamente

## 7. O maior ganho esperado

O maior ganho dessa reestruturação não será apenas “organização”.

O maior ganho será poder decidir melhor quando corrigir e quando não corrigir.

Hoje o risco é este:

- o sistema vê uma palavra estranha
- procura algo parecido
- escolhe uma sugestão por proximidade superficial
- produz uma troca perigosa

Com a nova base, a lógica pode ficar assim:

1. Verificar se a palavra já é válida no léxico ou nas exceções.
2. Verificar se o contexto sintático e morfológico sustenta aquela classe.
3. Verificar se a forma esperada existe pelas regras.
4. Verificar se há irregularidade específica.
5. Só então sugerir correção.
6. Se houver ambiguidade alta, não corrigir automaticamente.

Esse é o tipo de mudança que reduz erros como:

- `site` -> `sete`
- `fasso` -> `falso`
- `mobiliados` -> `mobiliários`

## 8. O que eu manteria do modelo atual

Eu manteria integralmente:

- a bateria automatizada
- a auditoria em JSON
- a curadoria por lotes
- o uso do Gemini como matéria-prima enriquecida
- o dicionário já conquistado como fonte de migração
- as regras frasais que já se mostraram seguras
- os `replacements` de alta confiança
- a indexação/tokenização

Em outras palavras: a base atual não deve ser descartada. Ela deve ser convertida, filtrada, classificada e reaproveitada.

## 9. O que eu não recomendo

Eu não recomendo:

- apagar a base antiga e começar do zero
- migrar tudo de uma vez
- tentar resolver sintaxe profunda cedo demais
- confiar que a nova organização, sozinha, resolverá a precisão
- colocar no mesmo peso palavras válidas, exceções, heurísticas e correções automáticas

O maior risco seria trocar uma desorganização antiga por uma complexidade nova ainda não validada.

## 10. Estratégia de migração recomendada

A migração precisa ser gradual e mensurável.

### Fase 1. Criar o schema base

Definir o formato mínimo dos arquivos novos:

- quais campos cada classe terá
- quais campos são obrigatórios
- quais campos são opcionais
- como representar ambiguidade
- como representar irregularidade
- como representar bloqueio de autocorreção

### Fase 2. Migrar o núcleo de maior retorno

Começar por:

- pronomes
- artigos
- verbos frequentes
- verbos irregulares
- substantivos frequentes
- adjetivos frequentes

Essa fase já entrega ganho prático em concordância verbal e nominal.

### Fase 3. Integrar o motor por pontos críticos

Sem reescrever tudo.

Fazer o motor consultar a nova base primeiro em situações onde ela gera valor imediato:

- validação de pronome + verbo
- detecção de forma verbal improvável
- bloqueio de sugestão semanticamente perigosa
- validação de plural e gênero em padrões simples

### Fase 4. Medir com a bateria automatizada

A cada etapa, medir:

- acerto real
- correções erradas
- erros novos
- falsos positivos
- categorias que mais melhoraram

Se a nova camada não melhorar os números, ela ainda não está pronta para substituir a antiga.

### Fase 5. Expandir cobertura com curadoria

Usar Gemini e curadoria humana para alimentar:

- novas entradas lexicais
- novas irregularidades
- novas exceções
- novos padrões simples de sintaxe

### Fase 6. Desativar gradualmente o legado

Só retirar dependências antigas quando a nova camada provar:

- ganho real
- estabilidade
- legibilidade
- facilidade de manutenção

## 11. Exemplo de raciocínio de motor

Frase:

```text
eu fala bonito
```

Fluxo esperado:

1. Tokenizar a frase.
2. Classificar `eu` como pronome de primeira pessoa singular.
3. Classificar `fala` como forma verbal possível, mas não compatível com o sujeito.
4. Detectar o padrão simples `pronome + verbo + adjetivo`.
5. Consultar a conjugação do verbo base.
6. Verificar que, para `eu`, a forma esperada é `falo`.
7. Sugerir `falo`.

Esse exemplo mostra bem por que uma base estruturada é superior a um simples conjunto de palavras soltas.

## 12. Minha conclusão final

Minha posição técnica é esta:

- sim, a base antiga sem estrutura hoje limita o projeto
- sim, a nova proposta é tecnicamente melhor
- sim, vale a pena adotar esse novo modelo
- não, isso não deve ser feito como recomeço total
- o caminho certo é migração progressiva, guiada por teste e auditoria

Se eu resumisse em uma frase:

O projeto começou certo para a fase de protótipo, mas agora precisa trocar volume desestruturado por inteligência estrutural sem perder o pipeline de melhoria contínua que já foi conquistado.

## 13. Próxima decisão prática

Se aprovamos esta direção, o próximo passo técnico ideal é criar um documento de schema inicial para a nova base, por exemplo:

- `verbos.schema.json`
- `substantivos.schema.json`
- `pronomes.schema.json`
- `verbos_irregulares.schema.json`
- `padroes_basicos.schema.json`

Depois disso, faz sentido criar um conversor inicial do material atual para essa nova estrutura, mesmo que a migração comece pequena.

## 14. Ajustes arquiteturais aprendidos na migracao

Depois da execucao pratica da migracao, alguns aprendizados ficaram claros e devem orientar a proxima fase.

### Sintaxe

A camada sintatica funciona melhor quando permanece pequena e conservadora.

O risco de crescer por lista manual de padroes continua real. Portanto, a proxima evolucao ideal nao deve ser apenas adicionar mais combinacoes, e sim introduzir:

- janela analisavel
- confianca por padrao
- agrupamento por papel simples, como sujeito, nucleo e complemento

### Concordancia nominal

O descarte do antigo arquivo declarativo de concordancia nominal foi correto porque ele nao participava da decisao real do motor.

Mas isso mostrou um ponto importante: o conceito continua sendo util, desde que reapareca em forma menor e realmente operacional.

Ou seja:

- nao restaurar estrutura morta
- reintroduzir apenas uma camada que o motor realmente consuma

### Regra versus heuristica

Outro aprendizado importante foi este:

Toda nova decisao do sistema deveria responder explicitamente:

- isto e regra?
- isto e heuristica?

A direcao recomendada e:

- empurrar regra para dados estruturados sempre que possivel
- manter heuristicas pequenas, auditaveis e justificadas

### Token classificado

Tambem ficou clara a falta de uma camada explicita de token classificado.

No futuro, o motor deve conseguir representar algo como:

```json
{
  "token": "fala",
  "candidatos": [
    { "classe": "verbo", "confianca": "alta" },
    { "classe": "substantivo", "confianca": "media" }
  ]
}
```

Isso sera importante para ambiguidade, sugestao conservadora e desambiguacao contextual.

### Camada de confianca

Por fim, a migracao mostrou que o sistema ja usa sinais indiretos de confianca, mas ainda precisa de uma camada explicita.

A recomendacao inicial e comecar simples:

- `alta`
- `media`
- `baixa`

Sem transformar tudo imediatamente em score numerico.

## 15. Ordem recomendada para a proxima fase

Depois do descarte do legado no runtime, a ordem mais promissora passa a ser:

1. introduzir camada explicita de confianca
2. introduzir conceito de token classificado
3. refatorar a sintaxe para janela analisavel com peso
4. reintroduzir concordancia nominal estruturada em forma realmente usada pelo motor
