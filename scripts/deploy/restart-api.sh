#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/common.sh"

RUNTIME_REPO_DIR="${1:-${DEPLOY_BASE_DIR_DEFAULT}/repo}"
API_CWD="${2:-$RUNTIME_REPO_DIR/packages/api}"
API_SCRIPT="${3:-dist/index.js}"

echo "▶ Syncing API runtime repo to $RUNTIME_REPO_DIR"
mkdir -p "$RUNTIME_REPO_DIR"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.env.*' \
  "$REPO_ROOT/" "$RUNTIME_REPO_DIR/"

echo "▶ Installing runtime dependencies..."
cd "$RUNTIME_REPO_DIR"
pnpm install --prod --no-frozen-lockfile

cd "$API_CWD"
PORT="$API_PORT_DEFAULT" ensure_pm2_node_process "ipay-api" "$API_SCRIPT" "$API_CWD"

# Also restart the relayer worker process if pm2 knows about it. The
# relayer process runs the same codebase (same API_CWD, same dist/),
# just a different entry script (relayer-main.js). Without this, new
# worker logic (e.g. giftClaimWorker ECIES fallback, recoverStuckProcessing,
# sponsorClaim rawChainKey override) never gets picked up by bash
# deploy-local.sh api and stays stuck on old code until a manual
# `pm2 restart ipay-relayer`.
if pm2 jlist 2>/dev/null | grep -q '"name":"ipay-relayer"'; then
  echo "▶ Restarting ipay-relayer to pick up new dist/"
  pm2 restart ipay-relayer --update-env >/dev/null 2>&1 || {
    echo "   (pm2 restart ipay-relayer failed — try: pm2 restart ipay-relayer manually)" >&2
  }
fi

pm2 save

echo "✅ API restarted (ipay-api + ipay-relayer if present)"
