#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TIMESTAMP="$(date '+%Y/%m/%d %H:%M:%S')"
COMMIT_MESSAGE="atualização ${TIMESTAMP}"
CURRENT_BRANCH="$(git branch --show-current)"

if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "Nao foi possivel detectar a branch atual."
  exit 1
fi

echo "Branch atual: ${CURRENT_BRANCH}"
echo "Mensagem de commit: ${COMMIT_MESSAGE}"
echo
echo "Gerando arquivos de instalacao..."
npm run release

echo
echo "Adicionando alteracoes ao git..."
git add -A

if git diff --cached --quiet; then
  echo "Nenhuma alteracao salva em disco para commitar."
  exit 0
fi

echo
echo "Criando commit..."
git commit -m "${COMMIT_MESSAGE}"

echo
echo "Enviando para origin/${CURRENT_BRANCH}..."
git push origin "${CURRENT_BRANCH}"

echo
echo "Publicacao concluida com sucesso."
