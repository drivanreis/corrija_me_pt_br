#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CUTOFF_HHMM="${1:-2200}"
shift || true

while true; do
  NOW_HHMM="$(date +%H%M)"
  if [[ "$NOW_HHMM" -ge "$CUTOFF_HHMM" ]]; then
    echo "Encerrando por cutoff horario: ${NOW_HHMM} >= ${CUTOFF_HHMM}"
    break
  fi

  echo "Rodando fill-test-case-targets em $(date '+%Y-%m-%d %H:%M:%S %z')"
  if ! node scripts/fill-test-case-targets.mjs "$@"; then
    echo "Execucao falhou em $(date '+%Y-%m-%d %H:%M:%S %z'); tentando novamente em 5 segundos."
    sleep 5
  fi

  COUNTS_JSON="$(node - <<'NODE'
const fs = require('fs');
const curated = JSON.parse(fs.readFileSync('data/test-cases/curated.json', 'utf8'));
const counts = {1:0,2:0,3:0,4:0,5:0,6:0};
for (const item of curated) {
  const d = Number(item.difficulty);
  if (counts[d] !== undefined) counts[d] += 1;
}
process.stdout.write(JSON.stringify(counts));
NODE
)"

  D2="$(node -e "const c=${COUNTS_JSON}; console.log(c[2])")"
  D3="$(node -e "const c=${COUNTS_JSON}; console.log(c[3])")"
  D4="$(node -e "const c=${COUNTS_JSON}; console.log(c[4])")"
  D5="$(node -e "const c=${COUNTS_JSON}; console.log(c[5])")"
  D6="$(node -e "const c=${COUNTS_JSON}; console.log(c[6])")"

  echo "Contagens atuais: D2=${D2} D3=${D3} D4=${D4} D5=${D5} D6=${D6}"

  if [[ "$D2" -ge 400 && "$D3" -ge 1200 && "$D4" -ge 1600 && "$D5" -ge 2000 && "$D6" -ge 4000 ]]; then
    echo "Metas atingidas. Encerrando em $(date '+%Y-%m-%d %H:%M:%S %z')."
    break
  fi
done
