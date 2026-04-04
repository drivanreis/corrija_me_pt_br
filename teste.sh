#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:18081}"
TEXT='Conforme conversamos, segue anexo as notas fiscais.'

start_ms="$(date +%s%3N)"

response="$(
  curl -sS -X POST "${SERVER_URL}/v2/check" \
    -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' \
    --data-urlencode 'language=pt-BR' \
    --data-urlencode "text=${TEXT}"
)"

end_ms="$(date +%s%3N)"
elapsed_ms="$((end_ms - start_ms))"

printf 'timestamp_inicial_ms=%s\n' "$start_ms"
printf 'timestamp_final_ms=%s\n' "$end_ms"
printf 'tempo_total_ms=%s\n' "$elapsed_ms"
printf 'resposta=%s\n' "$response"
