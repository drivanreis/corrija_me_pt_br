# Corrija-me PT-BR

Projeto para correcao de texto em portugues do Brasil, com uso local e integracao com uma extensao para Google Chrome.

## O que este projeto faz

- executa um servidor local de correcao em `http://localhost:8081`
- fornece uma extensao do Chrome para enviar textos ao servidor local
- permite instalar, testar e empacotar a solucao a partir deste repositorio

## Como instalar a extensao

1. Acesse o repositorio:
   `https://github.com/drivanreis/corrija_me_pt_br`

2. Faca o download do projeto.
   Voce pode baixar o arquivo `.zip` do GitHub ou clonar o repositorio pelo endereco HTTPS.

3. Extraia o arquivo `.zip` ou abra a pasta clonada no seu computador.

4. Siga o passo a passo do seu sistema operacional.

### Linux

1. Abra um terminal na pasta raiz do projeto.

2. Execute:

```bash
./install.sh
```

3. Aguarde a instalacao e a inicializacao do servidor local.

4. Quando o Chrome abrir em `chrome://extensions`, ative o `Modo do desenvolvedor`.

5. Clique em `Carregar sem compactacao`.

6. Selecione a pasta da extensao instalada em:
   `/opt/corrija_me_pt_br/chrome-extension`

7. Abra qualquer pagina com campo de texto para testar a extensao.

### Windows

1. Abra a pasta do projeto baixado.

2. Execute o arquivo:

```bat
install.bat
```

3. Aguarde a preparacao do ambiente no Windows.

4. Se necessario, confirme a execucao do PowerShell.

5. O instalador vai copiar os arquivos para a pasta local da aplicacao, iniciar o servidor e abrir a pasta da extensao.
   Ele tambem configura a inicializacao automatica do servidor no login do Windows.

6. Abra o Google Chrome em:
   `chrome://extensions`

7. Ative o `Modo do desenvolvedor`.

8. Clique em `Carregar sem compactacao`.

9. Selecione a pasta `chrome-extension` do pacote Windows, ou a pasta `extensao_chrome` do projeto quando estiver usando os arquivos diretamente do repositorio.

10. Abra qualquer pagina com campo de texto para testar a extensao.

## Como usar

- Clique no botao `Corrigir` exibido ao lado de um campo de texto.
- Ou use o atalho `Alt + Shift + C`.
- A extensao envia o texto para `http://localhost:8081/v2/check` usando `language=pt-BR`.

## Requisitos

- Java 17
- Maven
- Google Chrome

## Comandos uteis

Iniciar o servidor local:

```bash
./scripts/run-corrija-me-pt-br-server.sh
```

Executar os testes:

```bash
mvn -Dmaven.gitcommitid.skip=true test
```

Gerar os pacotes sem rodar testes:

```bash
mvn -Dmaven.gitcommitid.skip=true -DskipTests package
```

Empacotar a extensao do Chrome:

```bash
./scripts/package-corrija-me-pt-br-extension.sh
```

## Observacoes importantes

- A extensao depende do servidor local em execucao.
- No Windows, os arquivos instalados ficam em `%LOCALAPPDATA%\corrija_me_pt_br`.
- No Windows, o projeto inclui arquivos auxiliares como `IniciarServidor.bat`, `PararServidor.bat` e `StatusServidor.bat`.
- No Windows, apos a instalacao, o servidor e iniciado automaticamente quando o usuario entra no sistema.
- No primeiro build de um repositorio novo, pode ser necessario usar `-Dmaven.gitcommitid.skip=true` ate existir um commit local.
- A documentacao especifica da extensao esta em `extensao_chrome/README.md`.

## Licenca

Salvo indicacao em contrario, este projeto segue a LGPL 2.1 ou superior. Consulte `COPYING.txt`.
