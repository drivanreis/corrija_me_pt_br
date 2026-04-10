#!/usr/bin/env bash
# teste.sh
set -euo pipefail

SERVER_URL="${SERVER_URL:-http://127.0.0.1:18081}"

textsErro=(
  "A gente fomos no evento ontem onde assistimos uma palestra sobre tecnologia."
  "Faziam anos que eu não via ele, por isso não lhe reconheci de primeira."
  "As decisões que o governo toma, as vezes prejudica a população mais carente."
  "Eu cheguei na empresa as nove horas e não tinha ninguém na recepção esperando."
  "Houve muitos problemas na entrega e os cliente quer que devolve o dinheiro."
  "Se você ver o diretor avise ele que eu já terminei de fazer o relatório."
  "Eles preferem mais ficar em casa do que sair na chuva pra ir no cinema."
  "Me empresta esse livro pra mim ler ele enquanto eu tiver de férias?"
  "Tinha bastante pessoas na fila mas poucas conseguiram compra o ingresso."
  "Aonde você pensa que vai com essas mala tudo sem me dar uma explicação?"
)

textsExpected=(
  "A gente foi ao evento ontem, no qual assistimos a uma palestra sobre tecnologia."
  "Fazia anos que eu não o via, por isso não o reconheci de primeira."
  "As decisões que o governo toma às vezes prejudicam a população mais carente."
  "Eu cheguei à empresa às nove horas e não havia ninguém na recepção esperando."
  "Houve muitos problemas na entrega e os clientes querem que se devolva o dinheiro."
  "Se você vir o diretor, avise-o de que eu já terminei de fazer o relatório."
  "Eles preferem ficar em casa a sair na chuva para ir ao cinema."
  "Empresta-me este livro para eu o ler enquanto eu estiver de férias?"
  "Havia bastantes pessoas na fila, mas poucas conseguiram comprar o ingresso."
  "Aonde você pensa que vai com todas essas malas sem me dar uma explicação?"
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