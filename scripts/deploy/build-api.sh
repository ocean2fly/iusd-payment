#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "▶ Building API..."
cd "$REPO_ROOT/packages/api"
pnpm build
