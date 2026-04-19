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
FAILURES_JSON="${FAILURES_JSON:-}" # caminho para salvar relatório JSON de falhas (opcional)
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

tmp_failures=""
if [[ -n "$FAILURES_JSON" ]]; then
  tmp_failures="$(mktemp)"
  trap 'rm -f "$tmp_failures"' EXIT
fi

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
    if [[ -n "$tmp_failures" ]]; then
      printf '%s\t%s\t%s\t%s\n' \
        "$(printf '%s' "$challenge" | base64 -w0)" \
        "$(printf '%s' "$original" | base64 -w0)" \
        "$(printf '%s' "$corrected" | base64 -w0)" \
        "$(printf '%s' "$expected" | base64 -w0)" \
        >>"$tmp_failures"
    fi
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

if [[ -n "$tmp_failures" ]]; then
  TMP_FAILURES="$tmp_failures" \
  FAILURES_JSON="$FAILURES_JSON" \
  MODE="$MODE" \
  MOTOR_TRANSPORT="$MOTOR_TRANSPORT" \
  CASE_FILE="$CASE_FILE" \
  TOTAL_CASES="$total_count" \
  FAIL_COUNT="$fail_count" \
  SUCCESS_COUNT="$success_count" \
  SUCCESS_RATE="$success_rate" \
  ELAPSED_MS="$elapsed_ms" \
  node - <<'NODE'
const fs = require("node:fs");

function b64(s) {
  return Buffer.from(String(s || ""), "base64").toString("utf8");
}

const tmp = String(process.env.TMP_FAILURES || "");
const outPath = String(process.env.FAILURES_JSON || "");
if (!tmp || !outPath) process.exit(0);

const lines = fs.readFileSync(tmp, "utf8").trim().split("\n").filter(Boolean);
const failures = lines.map((line) => {
  const [challengeB64, originalB64, correctedB64, expectedB64] = line.split("\t");
  return {
    challenge: b64(challengeB64),
    errado: b64(originalB64),
    obtido: b64(correctedB64),
    esperado: b64(expectedB64),
  };
});

const payload = {
  meta: {
    generated_at: new Date().toISOString(),
    mode: process.env.MODE || "",
    motor_transport: process.env.MOTOR_TRANSPORT || "",
    case_file: process.env.CASE_FILE || "",
    total_cases: Number(process.env.TOTAL_CASES || 0),
    success_count: Number(process.env.SUCCESS_COUNT || 0),
    fail_count: Number(process.env.FAIL_COUNT || 0),
    success_rate_percent: Number(process.env.SUCCESS_RATE || 0),
    elapsed_ms: Number(process.env.ELAPSED_MS || 0),
  },
  failures,
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
NODE
  echo "failures_json=$FAILURES_JSON"
fi
