#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="$ROOT_DIR/config/corrija-me-pt-br-local.properties"
cd "$ROOT_DIR"

echo "Empacotando o servidor local do corrija_me_pt_br..."
mvn -q -pl languagetool-server -am -Pfat-jar -DskipTests package -Dmaven.gitcommitid.skip=true

JAR_PATH="$(find "$ROOT_DIR/languagetool-server/target" -maxdepth 1 -type f -name '*.jar' ! -name 'original-*.jar' | head -n 1)"

if [[ -z "${JAR_PATH}" ]]; then
  echo "Nao foi possivel localizar o jar do servidor em languagetool-server/target."
  exit 1
fi

echo "Iniciando servidor em http://localhost:8081 ..."
exec java -jar "$JAR_PATH" --config "$CONFIG_PATH" --port 8081 --allow-origin
