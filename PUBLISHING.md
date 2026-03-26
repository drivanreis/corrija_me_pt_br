# Publicacao do corrija_me_pt_br

## O que ja esta pronto

- servidor local focado em `pt-BR`
- extensao Chrome carregavel manualmente
- pacote zip da extensao
- pacote `.deb` para Ubuntu com servico em segundo plano
- pacote portatil `.zip` para Windows com scripts de inicializacao
- politica de privacidade base
- texto base para a Chrome Web Store

## Antes de publicar

1. Atualize `homepage_url` em [manifest.json](/home/eu/Documentos/GitHub/corrija_me_pt_br/extensao_chrome/manifest.json).
2. Publique a politica de privacidade em uma URL publica.
3. Revise nome do desenvolvedor, email e links finais.
4. Teste manualmente em:
   - Gmail
   - Google Docs textarea simples nao cobre todo editor rico
   - formulários comuns
   - WhatsApp Web
   - Notion
5. Gere o zip final:

```bash
bash scripts/package-corrija-me-pt-br-extension.sh
```

## Publicar na Chrome Web Store

1. Acesse o Chrome Web Store Developer Dashboard.
2. Envie o arquivo [extensao_chrome.zip](/home/eu/Documentos/GitHub/corrija_me_pt_br/dist/extensao_chrome.zip).
3. Use [STORE_LISTING_pt_BR.md](/home/eu/Documentos/GitHub/corrija_me_pt_br/extensao_chrome/STORE_LISTING_pt_BR.md) como base.
4. Informe a URL publica da politica de privacidade.
5. Complete icones, screenshots e categoria.

## Observacao importante

Como a extensao depende de um servidor local, a listagem da loja precisa deixar isso claro.
Ela esta pronta para publicacao tecnica, mas a aprovacao final depende da qualidade da sua pagina publica, da politica de privacidade publicada e dos testes manuais em sites reais.

## Distribuicao local

- Ubuntu: gere ou distribua [corrija_me_pt_br_v1.deb](/home/eu/Documentos/GitHub/corrija_me_pt_br/dist/corrija_me_pt_br_v1.deb)
- Windows: gere ou distribua `corrija_me_pt_br_windows_portable_v1.zip` com:

```bash
bash scripts/build-corrija-me-pt-br-windows-portable.sh
```

No Windows, o usuario ainda precisa carregar a extensao manualmente no `chrome://extensions`.
O pacote atual simplifica o servidor local, mas ainda nao e um instalador `.exe` ou `.msi`.
