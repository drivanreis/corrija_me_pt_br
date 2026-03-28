# Corrija-me PT-BR

Corretor de texto em portugues do Brasil, com funcionamento local no computador e integracao com o Google Chrome.

## Baixar agora

- [Windows x64](https://raw.githubusercontent.com/drivanreis/corrija_me_pt_br/main/releases/corrija_me_pt_br_windows_x64.zip)
- [Linux x64](https://raw.githubusercontent.com/drivanreis/corrija_me_pt_br/main/releases/corrija_me_pt_br_linux_x64.zip)

Depois de baixar, faca assim:

- Windows: extraia o `.zip` e execute `install.bat`
- Linux: extraia o `.zip`, abra o terminal na pasta e execute `sudo ./install.sh`

## O que a aplicacao faz

- corrige textos em pt-BR
- funciona localmente no proprio computador
- envia os textos somente para o backend local em `127.0.0.1`
- sugere correcoes diretamente no navegador
- funciona sem Java
- possui pacote portatil para Windows e Linux
- escolhe automaticamente uma porta livre a partir de `18081`

## Instalacao rapida

### Windows

1. Baixe `corrija_me_pt_br_windows_x64.zip`.
2. Extraia o arquivo.
3. Execute `install.bat`.
4. Aguarde a instalacao.
5. O Chrome sera aberto em `chrome://extensions`.
6. Ative o `Modo do desenvolvedor`.
7. Clique em `Carregar sem compactacao`.
8. Selecione a pasta:
   `%LOCALAPPDATA%\corrija_me_pt_br\chrome-extension`

Depois disso, o backend local sera iniciado automaticamente quando o usuario entrar no Windows.
O instalador escolhe automaticamente uma porta livre.

Para desinstalar:

1. Abra a pasta extraida do pacote.
2. Execute `uninstall.bat`.
3. Se a extensao ainda estiver carregada no Chrome, remova-a manualmente em `chrome://extensions`.

### Linux

1. Baixe `corrija_me_pt_br_linux_x64.zip`.
2. Extraia o arquivo.
3. Abra um terminal na pasta extraida.
4. Execute:

```bash
sudo ./install.sh
```

5. Abra o Chrome em `chrome://extensions`.
6. Ative o `Modo do desenvolvedor`.
7. Clique em `Carregar sem compactacao`.
8. Selecione a pasta:
   `/opt/corrija_me_pt_br/chrome-extension`

Depois disso, o backend local sera iniciado automaticamente com o sistema.
O instalador escolhe automaticamente uma porta livre.

Para desinstalar:

```bash
sudo ./uninstall.sh
```

Se a extensao ainda estiver carregada no Chrome, remova-a manualmente em `chrome://extensions`.

## Como usar

- clique no botao `Corrigir` ao lado de um campo de texto
- ou use o atalho `Alt + Shift + C`
- a verificacao acontece no backend local configurado pelo instalador

## O que vem no pacote

- backend local
- extensao pronta para carregar no Chrome
- instalador
- desinstalador

## Para desenvolvimento

### Requisitos

- Node.js 22 ou superior
- npm
- Google Chrome
- `zip`

### Instalar dependencias

```bash
npm install
```

### Gerar a aplicacao

```bash
npm run build
```

### Rodar o backend local

```bash
npm run start:backend
```

### Testar o backend

```bash
npm run test:backend
```

### Gerar executaveis

```bash
npm run package:backend
```

### Gerar pacotes portateis

```bash
npm run package:portable
```

## Estrutura do projeto

- `src/core`: motor de correcoes em TypeScript
- `src/backend`: backend HTTP local
- `src/extension`: codigo da extensao em TypeScript
- `data/replacements.json`: base inicial de substituicoes e sugestoes
- `build/node-app/extension`: extensao compilada para carregar no Chrome
- `build/node-app/pkg`: executaveis gerados
- `releases`: pacotes finais prontos para distribuicao

## Observacoes

- a extensao depende do backend local em execucao
- o backend usa a primeira porta livre encontrada a partir de `18081`
- a desinstalacao remove o backend local e os arquivos instalados
- a extensao do Chrome precisa ser removida manualmente em `chrome://extensions`
- os arquivos temporarios de build ficam em `build/`
- os pacotes finais para distribuir ficam em `releases/`
- o foco atual do projeto e a base nova em TypeScript

## Licenca

Salvo indicacao em contrario, este projeto segue a LGPL 2.1 ou superior. Consulte `COPYING.txt`.
