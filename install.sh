#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEB_PATH="$ROOT_DIR/dist/corrija_me_pt_br_v1.deb"
EXTENSION_DIR="/opt/corrija_me_pt_br/chrome-extension"
APT_UPDATED=0

require_cmd() {
  local cmd="$1"
  local package_name="$2"

  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi

  echo "Instalando dependencia: $package_name"
  if [[ "$APT_UPDATED" -eq 0 ]]; then
    sudo apt-get update
    APT_UPDATED=1
  fi
  sudo apt-get install -y "$package_name"
}

get_java_major_version() {
  local java_cmd="${1:-java}"
  local version_line=""

  version_line="$("$java_cmd" -version 2>&1 | head -n 1 || true)"
  if [[ "$version_line" =~ \"1\.([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "$version_line" =~ \"([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

ensure_java17_jdk() {
  if command -v java >/dev/null 2>&1; then
    local major_version=""
    major_version="$(get_java_major_version java || true)"
    if [[ -n "$major_version" && "$major_version" -ge 17 ]] && command -v javac >/dev/null 2>&1; then
      return 0
    fi
  fi

  echo "Instalando dependencia: openjdk-17-jdk"
  if [[ "$APT_UPDATED" -eq 0 ]]; then
    sudo apt-get update
    APT_UPDATED=1
  fi
  sudo apt-get install -y openjdk-17-jdk
}

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

open_helper_linux() {
  if command -v corrija-me-pt-br-open-extension-and-chrome >/dev/null 2>&1; then
    nohup corrija-me-pt-br-open-extension-and-chrome >/dev/null 2>&1 &
    return 0
  fi

  local chrome_cmd=""
  chrome_cmd="$(find_browser_cmd || true)"

  if [[ -n "$chrome_cmd" ]]; then
    nohup "$chrome_cmd" "chrome://extensions" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "chrome://extensions" >/dev/null 2>&1 &
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "$EXTENSION_DIR" >/dev/null 2>&1 &
  fi
}

wait_for_server() {
  local tries=15
  local response=""

  for ((i=1; i<=tries; i++)); do
    response="$(curl -s --max-time 5 http://localhost:8081/v2/languages || true)"
    if [[ "$response" == *'"longCode":"pt-BR"'* ]]; then
      return 0
    fi
    sleep 1
  done

  return 1
}

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Este instalador e para Ubuntu/Linux. No Windows, use install.bat."
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Este instalador foi feito para Ubuntu e derivados com apt."
  exit 1
fi

ensure_java17_jdk
require_cmd mvn maven
require_cmd zip zip
require_cmd curl curl

cd "$ROOT_DIR"

echo "Gerando pacote local do corrija_me_pt_br..."
bash scripts/build-corrija-me-pt-br-deb.sh

echo "Instalando pacote no sistema..."
sudo dpkg -i "$DEB_PATH"

echo "Reiniciando servidor local..."
sudo systemctl restart corrija-me-pt-br.service || true

echo "Validando servidor local..."
if wait_for_server; then
  echo "Servidor local respondeu corretamente em http://localhost:8081"
else
  echo "Aviso: o servidor foi instalado, mas ainda nao respondeu na porta 8081."
fi

open_helper_linux

echo
echo "Instalacao concluida."
echo "O Chrome vai abrir em chrome://extensions e a pasta da extensao tambem sera aberta."
echo "No Chrome, clique em 'Carregar sem compactacao' e selecione:"
echo "  $EXTENSION_DIR"
echo
echo "Atalhos criados para facilitar:"
echo "  corrija-me-pt-br open-folder"
echo "  corrija-me-pt-br open-chrome"
echo "  corrija-me-pt-br open-both"
