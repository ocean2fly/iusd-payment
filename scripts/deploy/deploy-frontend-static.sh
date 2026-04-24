#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/common.sh"

SRC_DIR="${1:-$REPO_ROOT/packages/app/dist}"
DEPLOY_DIR="${2:-$FRONTEND_RUNTIME_DIR_DEFAULT}"
TIMESTAMP="${3:-$(date +%s)}"

echo "▶ Deploying frontend to $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
sync_static_dist "$SRC_DIR" "$DEPLOY_DIR"
timestamp_asset_refs "$DEPLOY_DIR" "$TIMESTAMP"
ensure_pm2_static_process "ipay-app" "$DEPLOY_DIR" "$APP_PORT_DEFAULT"
pm2 save

echo "✅ Frontend deployed (v=$TIMESTAMP)"
