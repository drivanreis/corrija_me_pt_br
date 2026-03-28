# Corrija-me PT-BR

Aplicacao de correcao de texto em portugues do Brasil, com backend local e extensao para Google Chrome.

## Baixar agora

- [Windows x64](/home/eu/Documentos/GitHub/corrija_me_pt_br/releases/corrija_me_pt_br_windows_x64.zip)
- [Linux x64](/home/eu/Documentos/GitHub/corrija_me_pt_br/releases/corrija_me_pt_br_linux_x64.zip)

Depois de baixar:

- Windows: extraia o `.zip` e execute `install.bat`
- Linux: extraia o `.zip` e execute `sudo ./install.sh`

## O que a aplicacao faz

- executa um backend local em `127.0.0.1:8081`
- analisa textos em pt-BR
- sugere correcoes diretamente no navegador
- funciona sem Java
- gera pacotes portateis para Windows e Linux

## Para quem so quer usar

Os pacotes prontos ficam em:

- [`releases/corrija_me_pt_br_windows_x64.zip`](/home/eu/Documentos/GitHub/corrija_me_pt_br/releases/corrija_me_pt_br_windows_x64.zip)
- [`releases/corrija_me_pt_br_linux_x64.zip`](/home/eu/Documentos/GitHub/corrija_me_pt_br/releases/corrija_me_pt_br_linux_x64.zip)

Esses pacotes ja incluem:

- o backend local
- a extensao pronta para carregar
- instaladores simples

## Instalacao no Windows

1. Extraia o arquivo `corrija_me_pt_br_windows_x64.zip`.
2. Execute `install.bat`.
3. Aguarde a instalacao.
4. O Chrome sera aberto em `chrome://extensions`.
5. Ative o `Modo do desenvolvedor`.
6. Clique em `Carregar sem compactacao`.
7. Selecione a pasta:
   `%LOCALAPPDATA%\corrija_me_pt_br\chrome-extension`

Depois disso, o backend local sera iniciado automaticamente quando o usuario entrar no Windows.

## Instalacao no Linux

1. Extraia o arquivo `corrija_me_pt_br_linux_x64.zip`.
2. Abra um terminal na pasta extraida.
3. Execute:

```bash
sudo ./install.sh
```

4. Abra o Chrome em `chrome://extensions`.
5. Ative o `Modo do desenvolvedor`.
6. Clique em `Carregar sem compactacao`.
7. Selecione a pasta:
   `/opt/corrija_me_pt_br/chrome-extension`

Depois disso, o backend local sera iniciado automaticamente com o sistema.

## Como usar

- clique no botao `Corrigir` ao lado de um campo de texto
- ou use o atalho `Alt + Shift + C`
- a extensao envia o texto para `http://127.0.0.1:8081/v2/check`

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

- `src/core`
  Motor de correcoes em TypeScript.
- `src/backend`
  Backend HTTP local.
- `src/extension`
  Codigo da extensao em TypeScript.
- `data/replacements.json`
  Base inicial de substituicoes e sugestoes.
- `build/node-app/extension`
  Extensao compilada para carregar no Chrome.
- `build/node-app/pkg`
  Executaveis gerados.
- `releases`
  Pacotes finais prontos para distribuicao.

## Observacoes

- a extensao depende do backend local em execucao
- o backend responde em `127.0.0.1:8081`
- os arquivos temporarios de build ficam em `build/`
- os pacotes finais para distribuir ficam em `releases/`
- o foco atual do projeto e a base nova em TypeScript

## Licenca

Salvo indicacao em contrario, este projeto segue a LGPL 2.1 ou superior. Consulte `COPYING.txt`.
