#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

case " ${NODE_OPTIONS:-} " in
  *" --max-old-space-size="*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=4096" ;;
esac

echo "▶ Building admin (clean)..."
cd "$REPO_ROOT/packages/admin"
rm -rf dist node_modules/.vite
pnpm build
