#!/usr/bin/env bash
# Deploy Cloudflare Worker (OG preview for bot crawlers on /pay/*, /claim/*, /g/*, /app/send)
#
# Token can be supplied via:
#   1. CLOUDFLARE_API_TOKEN env var
#   2. ~/.cloudflare_token file (preferred for local runs)
#
# Token needs: Account → Workers Scripts:Edit, Zone → Workers Routes:Edit (iusd-pay.xyz)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKER_DIR="$REPO_ROOT/cf-worker"

if [ ! -f "$WORKER_DIR/wrangler.toml" ]; then
  echo "❌ No wrangler.toml at $WORKER_DIR"
  exit 1
fi

# Resolve token
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$HOME/.cloudflare_token" ]; then
  CLOUDFLARE_API_TOKEN="$(cat "$HOME/.cloudflare_token")"
  export CLOUDFLARE_API_TOKEN
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ CLOUDFLARE_API_TOKEN not set."
  echo "   Set env var or save token to ~/.cloudflare_token (chmod 600)."
  exit 1
fi

echo "▶ Deploying Cloudflare Worker (ipay-claim-og)"
cd "$WORKER_DIR"
npx --yes wrangler@4 deploy

echo "✅ Cloudflare Worker deployed"
