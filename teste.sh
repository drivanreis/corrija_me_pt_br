#!/usr/bin/env bash
# teste.sh
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:18081}"
MODE="${MODE:-motor}" # motor | jandaia
MOTOR_TRANSPORT="${MOTOR_TRANSPORT:-http}" # http | ipc
LLM_CORE_URL="${LLM_CORE_URL:-http://127.0.0.1:11434}"
LLM_CORE_MODEL="${LLM_CORE_MODEL:-jandaia-1}"
LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-15000}"
QUIET="${QUIET:-0}" # 1 para suprimir diffs por frase
CASE_FILE="${CASE_FILE:-test/bravo-cases.json}"

textsErro=()
textsExpected=()
textsChallenge=()

cases_output="$(CASE_FILE="$CASE_FILE" node - <<'NODE'
const fs = require("node:fs");

const filePath = String(process.env.CASE_FILE || "test/bravo-cases.json");
const raw = fs.readFileSync(filePath, "utf8");
const parsed = JSON.parse(raw);

if (!Array.isArray(parsed)) {
  throw new Error("CASE_FILE deve ser um array JSON.");
}

for (const item of parsed) {
  const challenge = String(item?.challenge || "").trim();
  const errado = String(item?.errado || "").trim();
  const esperado = String(item?.esperado || "").trim();

  if (!challenge || !errado || !esperado) {
    throw new Error("Cada caso precisa ter: challenge, errado, esperado.");
  }

  process.stdout.write(`${challenge}\t${errado}\t${esperado}\n`);
}
NODE
)"

while IFS=$'\t' read -r challenge errado esperado; do
  textsChallenge+=("$challenge")
  textsErro+=("$errado")
  textsExpected+=("$esperado")
done <<<"$cases_output"

# Proteção contra erro humano
if [[ ${#textsErro[@]} -ne ${#textsExpected[@]} ]]; then
  echo "Erro: quantidade de entradas diferente das saídas esperadas"
  exit 1
fi

get_corrected_text() {
  local response_json="$1"
  local original_text="$2"

  RESPONSE_JSON="$response_json" ORIGINAL_TEXT="$original_text" node - <<'NODE'
const raw = process.env.RESPONSE_JSON ?? "";
const original = process.env.ORIGINAL_TEXT ?? "";

try {
  const parsed = JSON.parse(raw);

  if (!parsed.matches || !parsed.matches.length) {
    process.stdout.write(original);
    process.exit(0);
  }

  let text = original;

  // aplica substituições da direita pra esquerda
  const matches = [...parsed.matches].sort((a, b) => b.offset - a.offset);

  for (const m of matches) {
    if (!m.replacements || !m.replacements.length) continue;

    const replacement = m.replacements[0].value;
    text =
      text.slice(0, m.offset) +
      replacement +
      text.slice(m.offset + m.length);
  }

  process.stdout.write(text);
} catch {
  process.stdout.write(original);
}
NODE
}

responses=()

start_ms="$(date +%s%3N)"

case "$MODE" in
  motor)
    case "$MOTOR_TRANSPORT" in
      http)
        for text in "${textsErro[@]}"; do
          responses+=("$(
            curl -sS -X POST "${SERVER_URL}/v2/check" \
              -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' \
              --data-urlencode 'language=pt-BR' \
              --data-urlencode "text=${text}"
          )")
        done
        ;;
      ipc)
        motor_output="$(printf '%s\n' "${textsErro[@]}" | node test/run-motor-ipc.mjs)"
        mapfile -t responses <<<"$motor_output"
        ;;
      *)
        echo "Erro: MOTOR_TRANSPORT inválido: $MOTOR_TRANSPORT (use http|ipc)" >&2
        exit 2
        ;;
    esac
    ;;
  jandaia)
    jandaia_output="$(printf '%s\n' "${textsErro[@]}" | LLM_CORE_URL="$LLM_CORE_URL" LLM_CORE_MODEL="$LLM_CORE_MODEL" LLM_TIMEOUT_MS="$LLM_TIMEOUT_MS" node test/run-jandaia-ollama.mjs)"
    mapfile -t responses <<<"$jandaia_output"
    ;;
  *)
    echo "Erro: MODE inválido: $MODE (use motor|jandaia)" >&2
    exit 2
    ;;
esac

end_ms="$(date +%s%3N)"
elapsed_ms="$((end_ms - start_ms))"

echo "=== FALHAS ==="

fail_count=0

for i in "${!responses[@]}"; do
  original="${textsErro[$i]}"
  expected="${textsExpected[$i]}"
  challenge="${textsChallenge[$i]:-unknown}"

  corrected="${responses[$i]}"
  if [[ "$MODE" == "motor" && "$MOTOR_TRANSPORT" == "http" ]]; then
    corrected="$(get_corrected_text "${responses[$i]}" "${original}")"
  fi

  if [[ "$corrected" != "$expected" ]]; then
    fail_count=$((fail_count + 1))
    if [[ "$QUIET" != "1" ]]; then
      echo "-----------------------------"
      echo "Desafio        : $challenge"
      echo "Frase original : $original"
      echo "Backend retornou: $corrected"
      echo "Esperado        : $expected"
      echo "Diferença:"
      diff <(echo "$expected") <(echo "$corrected") || true
    fi
  fi
done

echo "-----------------------------"
echo "Total de falhas: $fail_count"
total_count="${#textsErro[@]}"
success_count="$((total_count - fail_count))"
success_rate="$(TOTAL="$total_count" SUCCESS="$success_count" node - <<'NODE'
const total = Number(process.env.TOTAL || 0);
const success = Number(process.env.SUCCESS || 0);
if (!total) {
  process.stdout.write("0.00");
} else {
  process.stdout.write(((success / total) * 100).toFixed(2));
}
NODE
)"
echo "total_casos=$total_count"
echo "sucessos=$success_count"
echo "taxa_sucesso_percent=$success_rate"
echo "tempo_total_ms=$elapsed_ms"
