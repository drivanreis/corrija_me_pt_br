#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_NAME="corrija-me-pt-br"
PACKAGE_VERSION="1.0.0"
BUILD_ROOT="$ROOT_DIR/build/deb"
PACKAGE_ROOT="$BUILD_ROOT/${PACKAGE_NAME}_${PACKAGE_VERSION}"
DIST_DIR="$ROOT_DIR/dist"
OUTPUT_DEB="$DIST_DIR/corrija_me_pt_br_v1.deb"
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
  "$PACKAGE_ROOT/DEBIAN" \
  "$PACKAGE_ROOT/opt/corrija_me_pt_br/chrome-extension" \
  "$PACKAGE_ROOT/opt/corrija_me_pt_br/config" \
  "$PACKAGE_ROOT/usr/bin" \
  "$PACKAGE_ROOT/etc/systemd/system" \
  "$PACKAGE_ROOT/usr/share/doc/${PACKAGE_NAME}"

cat > "$PACKAGE_ROOT/DEBIAN/control" <<EOF
Package: ${PACKAGE_NAME}
Version: ${PACKAGE_VERSION}
Section: utils
Priority: optional
Architecture: all
Maintainer: corrija_me_pt_br
Depends: bash, openjdk-17-jre | default-jre
Description: corretor local em pt-BR para uso com a extensao corriga_me_pt_br
 Instala o servidor local do corrija_me_pt_br, registra um servico em segundo plano
 e inclui os arquivos da extensao Chrome para carregamento manual.
EOF

install -m 0755 "$ROOT_DIR/packaging/deb/postinst" "$PACKAGE_ROOT/DEBIAN/postinst"
install -m 0755 "$ROOT_DIR/packaging/deb/prerm" "$PACKAGE_ROOT/DEBIAN/prerm"
install -m 0755 "$ROOT_DIR/packaging/deb/postrm" "$PACKAGE_ROOT/DEBIAN/postrm"
install -m 0644 "$ROOT_DIR/packaging/deb/corrija-me-pt-br.service" "$PACKAGE_ROOT/etc/systemd/system/corrija-me-pt-br.service"
install -m 0755 "$ROOT_DIR/packaging/deb/corrija-me-pt-br-wrapper.sh" "$PACKAGE_ROOT/usr/bin/corrija-me-pt-br"
install -m 0755 "$ROOT_DIR/packaging/deb/corrija-me-pt-br-open-extension-folder.sh" "$PACKAGE_ROOT/usr/bin/corrija-me-pt-br-open-extension-folder"
install -m 0755 "$ROOT_DIR/packaging/deb/corrija-me-pt-br-open-chrome-extensions.sh" "$PACKAGE_ROOT/usr/bin/corrija-me-pt-br-open-chrome-extensions"
install -m 0755 "$ROOT_DIR/packaging/deb/corrija-me-pt-br-open-extension-and-chrome.sh" "$PACKAGE_ROOT/usr/bin/corrija-me-pt-br-open-extension-and-chrome"
install -m 0644 "$JAR_PATH" "$PACKAGE_ROOT/opt/corrija_me_pt_br/languagetool-server.jar"
install -m 0644 "$ROOT_DIR/config/corrija-me-pt-br-local.properties" "$PACKAGE_ROOT/opt/corrija_me_pt_br/config/corrija-me-pt-br-local.properties"
cp -R "$ROOT_DIR/extensao_chrome/." "$PACKAGE_ROOT/opt/corrija_me_pt_br/chrome-extension/"

cat > "$PACKAGE_ROOT/opt/corrija_me_pt_br/COMO_INSTALAR_EXTENSAO.txt" <<'EOF'
corrija_me_pt_br
================

O servidor local ja foi instalado por este pacote.

Comandos uteis:
  corrija-me-pt-br status
  corrija-me-pt-br restart
  corrija-me-pt-br logs
  corrija-me-pt-br extension-path
  corrija-me-pt-br open-folder
  corrija-me-pt-br open-chrome
  corrija-me-pt-br open-both

Para carregar a extensao no Chrome:
  1. Abra chrome://extensions
  2. Ative "Modo do desenvolvedor"
  3. Clique em "Carregar sem compactacao"
  4. Selecione a pasta:
     /opt/corrija_me_pt_br/chrome-extension
EOF

install -m 0644 "$ROOT_DIR/PUBLISHING.md" "$PACKAGE_ROOT/usr/share/doc/${PACKAGE_NAME}/PUBLISHING.md"

mkdir -p "$DIST_DIR"
dpkg-deb --root-owner-group --build "$PACKAGE_ROOT" "$OUTPUT_DEB" >/dev/null

echo "Pacote gerado em: $OUTPUT_DEB"
