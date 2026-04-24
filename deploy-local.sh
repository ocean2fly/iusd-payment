#!/usr/bin/env bash
set -euo pipefail

# Quick local build & deploy — use during debugging instead of CI/CD
# Usage:
#   ./deploy-local.sh app       # frontend only
#   ./deploy-local.sh admin     # admin only
#   ./deploy-local.sh api       # backend only
#   ./deploy-local.sh cf        # Cloudflare worker (OG bot rewriting)
#   ./deploy-local.sh all       # app + admin + api (cf NOT included)

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-app}"

deploy_app() {
  bash "$REPO_ROOT/scripts/deploy/build-frontend.sh"
  bash "$REPO_ROOT/scripts/deploy/deploy-frontend-static.sh"
}

deploy_admin() {
  bash "$REPO_ROOT/scripts/deploy/build-admin.sh"
  bash "$REPO_ROOT/scripts/deploy/deploy-admin-static.sh"
}

deploy_api() {
  bash "$REPO_ROOT/scripts/deploy/build-api.sh"
  bash "$REPO_ROOT/scripts/deploy/restart-api.sh"
}

deploy_cf() {
  bash "$REPO_ROOT/scripts/deploy/deploy-cf-worker.sh"
}

case "$TARGET" in
  app)   deploy_app ;;
  admin) deploy_admin ;;
  api)   deploy_api ;;
  cf)    deploy_cf ;;
  all)   deploy_app; deploy_admin; deploy_api ;;
  *)     echo "Usage: $0 {app|admin|api|cf|all}"; exit 1 ;;
esac
