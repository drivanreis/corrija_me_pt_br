#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/extensao_chrome"
DIST_DIR="$ROOT_DIR/dist"
ZIP_PATH="$DIST_DIR/extensao_chrome.zip"

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

cd "$EXT_DIR"
zip -qr "$ZIP_PATH" .

echo "Pacote criado em: $ZIP_PATH"
