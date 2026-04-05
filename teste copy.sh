#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:18081}"

texts=(
  'Conforme conversamos, segue anexo as notas fiscais.'
  'Eles quizeram analizar os documentos ontem.'
  'Vou fazer uma janta pra nois.'
  'Eles estavam a beira de um colapso, mas a solucao veio atraves de uma nova analise.'
  'O recem nascido dormia enquanto ela estudava para a pos graduação.'
  'Voce ja enviou o relatorio de sabado?'
  'O nivel de agua do reservatorio esta baixo.'
  'Vendo notebook usado com 8gb de ram e ssd 240gb.'
)

responses=()

extract_suggestions() {
  local response_json="$1"
  RESPONSE_JSON="$response_json" node - <<'NODE'
const raw = process.env.RESPONSE_JSON ?? "";
try {
  const parsed = JSON.parse(raw);
  const suggestions = Array.isArray(parsed.matches)
    ? parsed.matches.flatMap((match) =>
        Array.isArray(match.replacements)
          ? match.replacements.map((replacement) => replacement?.value).filter(Boolean)
          : []
      )
    : [];
  process.stdout.write(JSON.stringify(suggestions));
} catch {
  process.stdout.write("[]");
}
NODE
}

start_ms="$(date +%s%3N)"

for text in "${texts[@]}"; do
  responses+=("$(
    curl -sS -X POST "${SERVER_URL}/v2/check" \
      -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' \
      --data-urlencode 'language=pt-BR' \
      --data-urlencode "text=${text}"
  )")
done

end_ms="$(date +%s%3N)"
elapsed_ms="$((end_ms - start_ms))"

for index in "${!responses[@]}"; do
  printf 'sugestoes_%s=%s\n' "$((index + 1))" "$(extract_suggestions "${responses[index]}")"
done

printf 'timestamp_inicial_ms=%s\n' "$start_ms"
printf 'timestamp_final_ms=%s\n' "$end_ms"
printf 'tempo_total_ms=%s\n' "$elapsed_ms"
