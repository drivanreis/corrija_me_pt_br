#!/usr/bin/env bash
# teste.sh
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:18081}"

textsErro=(
  "Pra mim fazer isso vai ser dificil mais eu tento."
  "Os problema que aconteceu ontem nao foi resolvido ainda."
  "Ela falou pra mim ir na loja compra os negocio."
  "A gente tava meio perdido mais conseguimos acha o caminho."
  "Eles nao sabia que nois ia chega mais cedo."
  "Fazem tres meses que ela nao vem aqui e ninguem sabe o porque."
  "Eu vi ele saindo da sala mais nao falei nada pra ele."
  "As pessoa que chegou atrasado nao pode entra na reuniao."
  "Se eu fosse voce eu nao fazia isso porque pode dar problema depois."
  "Nos vai precisar resolve isso rapido antes que de errado."
)

textsExpected=(
  "Para eu fazer isso vai ser difícil, mas eu tento."
  "Os problemas que aconteceram ontem não foram resolvidos ainda."
  "Ela falou para eu ir à loja comprar os negócios."
  "A gente estava meio perdido, mas conseguimos achar o caminho."
  "Eles não sabiam que nós íamos chegar mais cedo."
  "Faz três meses que ela não vem aqui e ninguém sabe o porquê."
  "Eu o vi saindo da sala, mas não falei nada para ele."
  "As pessoas que chegaram atrasadas não podem entrar na reunião."
  "Se eu fosse você, eu não faria isso porque pode dar problema depois."
  "Nós vamos precisar resolver isso rápido antes que dê errado."
)

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

for text in "${textsErro[@]}"; do
  responses+=("$(
    curl -sS -X POST "${SERVER_URL}/v2/check" \
      -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' \
      --data-urlencode 'language=pt-BR' \
      --data-urlencode "text=${text}"
  )")
done

end_ms="$(date +%s%3N)"
elapsed_ms="$((end_ms - start_ms))"

echo "=== FALHAS ==="

fail_count=0

for i in "${!responses[@]}"; do
  original="${textsErro[$i]}"
  expected="${textsExpected[$i]}"

  corrected="$(get_corrected_text "${responses[$i]}" "${original}")"

  if [[ "$corrected" != "$expected" ]]; then
    fail_count=$((fail_count + 1))
    echo "-----------------------------"
    echo "Frase original : $original"
    echo "Backend retornou: $corrected"
    echo "Esperado        : $expected"
    echo "Diferença:"
    diff <(echo "$expected") <(echo "$corrected") || true
  fi
done

echo "-----------------------------"
echo "Total de falhas: $fail_count"
echo "tempo_total_ms=$elapsed_ms"