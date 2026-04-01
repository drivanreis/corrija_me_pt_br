#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="/opt/corrija_me_pt_br"
SERVICE_PATH="/etc/systemd/system/corrija-me-pt-br-node.service"
PORT_FILE="$INSTALL_ROOT/server-port.txt"

find_free_port() {
  local port=18081
  while true; do
    if ! ss -ltnH "( sport = :$port )" 2>/dev/null | grep -q .; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
  done
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Execute este instalador com sudo."
  exit 1
fi

SELECTED_PORT="$(find_free_port)"
SERVER_URL="http://127.0.0.1:$SELECTED_PORT"

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop corrija-me-pt-br-node.service || true
fi

rm -rf "$INSTALL_ROOT"
mkdir -p "$INSTALL_ROOT"
cp -R "$ROOT_DIR/server" "$INSTALL_ROOT/"
cp -R "$ROOT_DIR/chrome-extension" "$INSTALL_ROOT/"
chmod +x "$INSTALL_ROOT/server/corrija-me-pt-br-server"
printf '%s
' "$SELECTED_PORT" > "$PORT_FILE"
cat > "$ROOT_DIR/chrome-extension/server-config.json" <<EOF
{
  "serverUrl": "$SERVER_URL"
}
EOF
cat > "$INSTALL_ROOT/chrome-extension/server-config.json" <<EOF
{
  "serverUrl": "$SERVER_URL"
}
EOF

cat > "$SERVICE_PATH" <<'EOF'
[Unit]
Description=corrija_me_pt_br backend local em Node.js
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/corrija_me_pt_br
Environment=CORRIJA_ME_PORT=__CORRIJA_ME_PORT__
ExecStart=/opt/corrija_me_pt_br/server/corrija-me-pt-br-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sed -i "s/__CORRIJA_ME_PORT__/$SELECTED_PORT/" "$SERVICE_PATH"

systemctl daemon-reload
systemctl enable corrija-me-pt-br-node.service
systemctl restart corrija-me-pt-br-node.service

echo
echo "Instalacao concluida."
echo "Servidor local configurado em $SERVER_URL"
echo "No Chrome, abra chrome://extensions"
echo "Ative o modo do desenvolvedor e selecione:"
echo "  /opt/corrija_me_pt_br/chrome-extension"
