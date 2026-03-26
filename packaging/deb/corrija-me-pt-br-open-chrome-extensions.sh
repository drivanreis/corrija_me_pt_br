#!/usr/bin/env bash
set -euo pipefail

find_browser_cmd() {
  local candidate=""

  for candidate in \
    google-chrome \
    google-chrome-stable \
    chromium-browser \
    chromium \
    brave-browser
  do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

browser_cmd="$(find_browser_cmd || true)"

if [[ -n "$browser_cmd" ]]; then
  "$browser_cmd" "chrome://extensions" >/dev/null 2>&1 &
  exit 0
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "chrome://extensions" >/dev/null 2>&1 &
  exit 0
fi

echo "Nao foi possivel abrir o navegador automaticamente."
echo "Abra manualmente: chrome://extensions"
