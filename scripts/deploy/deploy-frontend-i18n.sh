#!/usr/bin/env bash
# Deploy the i18n preview frontend.
#
# Mirrors deploy-frontend-static.sh but writes to a separate directory and
# spawns a separate PM2 process so it can run side-by-side with the prod
# `ipay-app` process without touching it.
#
#   Process name:  ipay-app-i18n
#   Port:          3204
#   Runtime dir:   /home/jack_initia_xyz/ipay-deploy/frontend-i18n
#
# Cloudflare Tunnel routes i18n.iusd-pay.xyz → http://localhost:3204.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/common.sh"

SRC_DIR="${1:-$REPO_ROOT/packages/app/dist}"
DEPLOY_DIR="${2:-${DEPLOY_BASE_DIR_DEFAULT}/frontend-i18n}"
TIMESTAMP="${3:-$(date +%s)}"
PORT="${4:-3204}"
PM2_NAME="${5:-ipay-app-i18n}"

echo "▶ Deploying i18n preview frontend to $DEPLOY_DIR (port $PORT, pm2: $PM2_NAME)"
mkdir -p "$DEPLOY_DIR"
sync_static_dist "$SRC_DIR" "$DEPLOY_DIR"
timestamp_asset_refs "$DEPLOY_DIR" "$TIMESTAMP"
ensure_pm2_static_process "$PM2_NAME" "$DEPLOY_DIR" "$PORT"
pm2 save

echo "✅ i18n frontend deployed (v=$TIMESTAMP)"
