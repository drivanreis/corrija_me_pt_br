#!/usr/bin/env bash
set -euo pipefail

npm run generate:test-cases:batch
npm run curate:test-cases
