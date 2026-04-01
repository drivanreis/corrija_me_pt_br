#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="/opt/corrija_me_pt_br"
SERVICE_PATH="/etc/systemd/system/corrija-me-pt-br-node.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este desinstalador com sudo."
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop corrija-me-pt-br-node.service || true
  systemctl disable corrija-me-pt-br-node.service || true
fi

rm -f "$SERVICE_PATH"
rm -rf "$INSTALL_ROOT"

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi

echo
echo "Desinstalacao concluida."
echo "Arquivos removidos de $INSTALL_ROOT"
echo "Servico local removido."
echo "Se a extensao ainda estiver carregada no Chrome, remova-a manualmente em chrome://extensions."
