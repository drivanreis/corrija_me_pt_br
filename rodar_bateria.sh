#!/usr/bin/env bash
set -euo pipefail

ROUNDS="${1:-1}"
shift || true

npm run automate:battery -- --rounds "$ROUNDS" --publish "$@"
