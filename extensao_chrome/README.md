# corrija_me_pt_br Chrome Extension

Extensao Chrome local para o projeto `corrija_me_pt_br`.
Ela funciona apenas com o servidor local em `http://localhost:8081`.

## Fluxo local

1. Suba o servidor local:

```bash
./scripts/run-corrija-me-pt-br-server.sh
```

2. No Chrome, abra `chrome://extensions`.
3. Ative `Modo do desenvolvedor`.
4. Clique em `Carregar sem compactacao`.
5. Selecione a pasta `extensao_chrome`.

## Como usar

- Foque em um campo de texto.
- Clique no botao `Corrigir` que aparece ao lado do campo.
- Ou use o atalho `Alt + Shift + C`.
- A extensao envia o texto para `http://localhost:8081/v2/check` com `language=pt-BR`.
- A unica preferencia salva localmente e se a verificacao automatica fica ligada.

## Empacotamento

Para gerar um zip da extensao:

```bash
./scripts/package-corrija-me-pt-br-extension.sh
```
