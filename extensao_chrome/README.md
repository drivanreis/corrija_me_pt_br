# Como instalar a extensao do Corrija-me PT-BR

Esta extensao funciona localmente no Google Chrome e depende do servidor do projeto rodando em `http://localhost:8081`.

## Passo a passo

1. Acesse o repositorio:
   `https://github.com/drivanreis/corrija_me_pt_br`

2. Faca o download do projeto.
   Voce pode baixar o arquivo `.zip` do GitHub ou clonar o repositorio pelo endereco HTTPS.

3. Extraia o arquivo `.zip` ou abra a pasta clonada no seu computador.

4. Abra um terminal na pasta raiz do projeto.

5. Inicie o servidor local do projeto com o comando:

```bash
./scripts/run-corrija-me-pt-br-server.sh
```

6. Aguarde o servidor iniciar completamente.
   A extensao precisa que o servico esteja disponivel em `http://localhost:8081`.

7. No Google Chrome, abra o endereco:
   `chrome://extensions`

8. Ative a opcao `Modo do desenvolvedor`.

9. Clique em `Carregar sem compactacao`.

10. Selecione a pasta `extensao_chrome` que esta dentro do projeto.

11. Depois de carregar a extensao, abra qualquer pagina com campo de texto para testar.

## Como usar

- Clique no botao `Corrigir` que aparece ao lado do campo de texto.
- Ou use o atalho `Alt + Shift + C`.
- A extensao envia o texto para `http://localhost:8081/v2/check` usando `language=pt-BR`.

## Observacoes importantes

- A extensao nao funciona sozinha: o servidor local precisa estar ligado.
- No Windows, depois da instalacao, o servidor passa a iniciar automaticamente no login do usuario.
- Se o Chrome nao aceitar a extensao, confirme se voce selecionou exatamente a pasta `extensao_chrome`.
- Se nada acontecer ao corrigir um texto, verifique se o servidor local continua em execucao.

## Empacotamento

Se quiser gerar um arquivo zip da extensao:

```bash
./scripts/package-corrija-me-pt-br-extension.sh
```
