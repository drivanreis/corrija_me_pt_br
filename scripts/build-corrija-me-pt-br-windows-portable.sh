#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_VERSION="1.0.0"
BUILD_ROOT="$ROOT_DIR/build/windows-portable"
PACKAGE_ROOT="$BUILD_ROOT/corrija_me_pt_br_windows_portable_v${PACKAGE_VERSION}"
DIST_DIR="$ROOT_DIR/dist"
OUTPUT_ZIP="$DIST_DIR/corrija_me_pt_br_windows_portable_v1.zip"
JAR_PATH="$ROOT_DIR/languagetool-server/target/languagetool-server-6.8-SNAPSHOT.jar"

cd "$ROOT_DIR"

echo "Empacotando servidor fat jar..."
mvn -q -pl languagetool-server -am -Pfat-jar -DskipTests package -Dmaven.gitcommitid.skip=true

if [[ ! -f "$JAR_PATH" ]]; then
  echo "Jar nao encontrado em: $JAR_PATH"
  exit 1
fi

rm -rf "$BUILD_ROOT"
mkdir -p \
  "$PACKAGE_ROOT/server" \
  "$PACKAGE_ROOT/chrome-extension" \
  "$DIST_DIR"

install -m 0644 "$JAR_PATH" "$PACKAGE_ROOT/server/languagetool-server.jar"
install -m 0644 "$ROOT_DIR/config/corrija-me-pt-br-local.properties" "$PACKAGE_ROOT/server/corrija-me-pt-br-local.properties"
cp -R "$ROOT_DIR/extensao_chrome/." "$PACKAGE_ROOT/chrome-extension/"
install -m 0644 "$ROOT_DIR/packaging/windows/IniciarServidor.ps1" "$PACKAGE_ROOT/IniciarServidor.ps1"
install -m 0644 "$ROOT_DIR/packaging/windows/PararServidor.ps1" "$PACKAGE_ROOT/PararServidor.ps1"
install -m 0644 "$ROOT_DIR/packaging/windows/StatusServidor.ps1" "$PACKAGE_ROOT/StatusServidor.ps1"
install -m 0644 "$ROOT_DIR/packaging/windows/IniciarServidor.bat" "$PACKAGE_ROOT/IniciarServidor.bat"
install -m 0644 "$ROOT_DIR/packaging/windows/PararServidor.bat" "$PACKAGE_ROOT/PararServidor.bat"
install -m 0644 "$ROOT_DIR/packaging/windows/StatusServidor.bat" "$PACKAGE_ROOT/StatusServidor.bat"
install -m 0644 "$ROOT_DIR/packaging/windows/README_WINDOWS.txt" "$PACKAGE_ROOT/README_WINDOWS.txt"

rm -f "$OUTPUT_ZIP"
(
  cd "$BUILD_ROOT"
  zip -qr "$OUTPUT_ZIP" "$(basename "$PACKAGE_ROOT")"
)

echo "Pacote gerado em: $OUTPUT_ZIP"
