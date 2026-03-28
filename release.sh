#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "Validando TypeScript..."
npm run typecheck

echo "Validando lint..."
npm run lint

echo "Validando backend..."
npm run test:backend

echo "Gerando pacotes de instalacao..."
npm run package:portable

echo
echo "Release pronta:"
echo "  releases/corrija_me_pt_br_linux_x64.zip"
echo "  releases/corrija_me_pt_br_windows_x64.zip"
