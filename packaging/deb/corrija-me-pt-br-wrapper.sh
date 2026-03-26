#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="corrija-me-pt-br.service"
EXTENSION_DIR="/opt/corrija_me_pt_br/chrome-extension"
DOC_FILE="/opt/corrija_me_pt_br/COMO_INSTALAR_EXTENSAO.txt"

print_help() {
  cat <<'EOF'
Uso: corrija-me-pt-br <comando>

Comandos:
  start           inicia o servidor local
  stop            para o servidor local
  restart         reinicia o servidor local
  status          mostra o status do servidor
  logs            mostra logs do servidor
  extension-path  mostra o caminho da extensao Chrome
  open-folder     abre a pasta da extensao
  open-chrome     abre chrome://extensions
  open-both       abre a pasta da extensao e chrome://extensions
  instructions    mostra as instrucoes de instalacao da extensao
EOF
}

require_systemctl() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl nao encontrado neste sistema."
    exit 1
  fi
}

run_systemctl() {
  require_systemctl
  if [[ "${EUID}" -eq 0 ]]; then
    systemctl "$@"
  else
    sudo systemctl "$@"
  fi
}

case "${1:-help}" in
  start)
    run_systemctl start "$SERVICE_NAME"
    ;;
  stop)
    run_systemctl stop "$SERVICE_NAME"
    ;;
  restart)
    run_systemctl restart "$SERVICE_NAME"
    ;;
  status)
    run_systemctl status "$SERVICE_NAME"
    ;;
  logs)
    if [[ "${EUID}" -eq 0 ]]; then
      journalctl -u "$SERVICE_NAME" -f
    else
      sudo journalctl -u "$SERVICE_NAME" -f
    fi
    ;;
  extension-path)
    echo "$EXTENSION_DIR"
    ;;
  open-folder)
    /usr/bin/corrija-me-pt-br-open-extension-folder
    ;;
  open-chrome)
    /usr/bin/corrija-me-pt-br-open-chrome-extensions
    ;;
  open-both)
    /usr/bin/corrija-me-pt-br-open-extension-and-chrome
    ;;
  instructions)
    cat "$DOC_FILE"
    ;;
  help|-h|--help)
    print_help
    ;;
  *)
    echo "Comando invalido: $1"
    echo
    print_help
    exit 1
    ;;
esac
