#!/usr/bin/env bash
# Build the explorer on the Mac and ship dist/ to the host. Never builds on the box.
#   deploy/deploy-explorer.sh [user@host]   (default ubuntu@43.134.86.221)
set -euo pipefail
HOST="${1:-ubuntu@43.134.86.221}"
cd "$(dirname "$0")/.."

pnpm --dir apps/explorer build
# Assets first (hashed names), the shell last, so no visitor gets a shell
# that points at chunks not uploaded yet.
rsync -az apps/explorer/dist/assets/ "$HOST:/var/www/sdiqt/assets/"
rsync -az --delete --exclude index.html --exclude counts.json apps/explorer/dist/ "$HOST:/var/www/sdiqt/"
# PROOF.md numbers (scripts/proof.mjs) for the landing's median proof time.
rsync -az docs/counts.json "$HOST:/var/www/sdiqt/counts.json"
rsync -az apps/explorer/dist/index.html "$HOST:/var/www/sdiqt/index.html"
curl -fsS -o /dev/null -w "https://sdiqt.xyz/ %{http_code} %{time_total}s\n" https://sdiqt.xyz/
