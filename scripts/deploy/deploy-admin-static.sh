#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/common.sh"

SRC_DIR="${1:-$REPO_ROOT/packages/admin/dist}"
DEPLOY_DIR="${2:-$ADMIN_RUNTIME_DIR_DEFAULT}"

echo "▶ Deploying admin to $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
rm -rf "$DEPLOY_DIR"/*
cp -r "$SRC_DIR"/* "$DEPLOY_DIR"/
ensure_pm2_static_process "ipay-admin" "$DEPLOY_DIR" "$ADMIN_PORT_DEFAULT"
pm2 save

echo "✅ Admin deployed"
