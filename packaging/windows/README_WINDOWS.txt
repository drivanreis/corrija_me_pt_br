corrija_me_pt_br para Windows
==============================

Este pacote e portatil. Ele nao instala a extensao automaticamente no Chrome.

Requisitos:
1. Java 17 instalado no Windows
2. Google Chrome instalado

Como usar:
1. Extraia todo o arquivo ZIP para uma pasta.
2. Execute IniciarServidor.bat
3. Aguarde a mensagem de servidor iniciado
4. Abra chrome://extensions
5. Ative "Modo do desenvolvedor"
6. Clique em "Carregar sem compactacao"
7. Selecione a pasta chrome-extension

Arquivos uteis:
- IniciarServidor.bat
- PararServidor.bat
- StatusServidor.bat
- AbrirPastaDaExtensao.bat
- AbrirChromeExtensions.bat
- AbrirExtensaoEChrome.bat

Observacao:
- Este pacote e para uso local.
- O servidor responde em http://localhost:8081
- A extensao conversa apenas com esse servidor local.
