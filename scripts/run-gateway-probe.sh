#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/.tmp-probe-gateway.mjs"
trap 'rm -f "$OUT"' EXIT
"$ROOT/node_modules/.bin/esbuild" scripts/probe-gateway.mjs \
  --bundle --platform=node --format=esm --packages=external \
  --alias:vscode=./scripts/vscode-mock.mjs --outfile="$OUT"
node "$OUT"
