#!/usr/bin/env bash
set -euo pipefail

EXTENSION_DIR="/opt/corrija_me_pt_br/chrome-extension"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$EXTENSION_DIR" >/dev/null 2>&1 &
  exit 0
fi

echo "xdg-open nao encontrado. Abra manualmente:"
echo "  $EXTENSION_DIR"
