#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "▶ Patching IK source..."
cd "$REPO_ROOT"
bash scripts/patch-ik.sh

echo "▶ Building frontend (clean)..."
cd "$REPO_ROOT/packages/app"
rm -rf dist node_modules/.vite
# vite build at render-chunks peaks over 2GB (the Node default) due to
# the pay/gift/zk bundle size. Bump the old-space limit unless the
# caller has already configured one.
export NODE_OPTIONS="${NODE_OPTIONS:-"--max-old-space-size=6144"}"
pnpm build
