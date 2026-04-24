#!/usr/bin/env bash
set -euo pipefail

DEPLOY_BASE_DIR_DEFAULT="${DEPLOY_BASE_DIR:-/home/jack_initia_xyz/ipay-deploy}"
FRONTEND_RUNTIME_DIR_DEFAULT="${FRONTEND_RUNTIME_DIR:-${DEPLOY_BASE_DIR_DEFAULT}/frontend}"
ADMIN_RUNTIME_DIR_DEFAULT="${ADMIN_RUNTIME_DIR:-${DEPLOY_BASE_DIR_DEFAULT}/admin}"
API_PORT_DEFAULT="${API_PORT:-3001}"
APP_PORT_DEFAULT="${APP_PORT:-3201}"
ADMIN_PORT_DEFAULT="${ADMIN_PORT:-3203}"

timestamp_asset_refs() {
  local deploy_dir="$1"
  local src_dir="${3:-}"
  local timestamp="${2:-$(date +%s)}"
  local new_js new_css

  cd "$deploy_dir"
  # IMPORTANT: Pick the newest entry chunk by modification time (ls -t).
  # Alphabetical ls is wrong because old chunks are kept around (for stale
  # clients lazy-loading) and can sort before the latest one.
  new_js=$(ls -t assets/index-*.js 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)
  new_css=$(ls -t assets/index-*.css 2>/dev/null | head -1 | xargs basename 2>/dev/null || true)

  [ -n "$new_js" ] && sed -i "s|src=\"/assets/index-[^\"]*\"|src=\"/assets/${new_js}?v=${timestamp}\"|g" index.html
  [ -n "$new_css" ] && sed -i "s|href=\"/assets/index-[^\"]*\"|href=\"/assets/${new_css}?v=${timestamp}\"|g" index.html
}

sync_static_dist() {
  local src_dir="$1"
  local deploy_dir="$2"

  mkdir -p "$deploy_dir/assets"
  # Copy new build over the existing deploy directory.
  # IMPORTANT: We intentionally DO NOT delete old chunks — users still holding
  # an old index.html reference need those lazy-loaded chunks to be reachable,
  # otherwise `serve -s` falls back to index.html and the browser gets
  # "text/html is not a valid javascript MIME type".
  cp -r "$src_dir"/* "$deploy_dir"/

  # Only clean chunks that are older than 14 days AND clearly hash-named.
  # This keeps a reasonable tail of history without letting the dir grow
  # forever. index-*.js is excluded because it's the entry chunk.
  find "$deploy_dir/assets" -type f \
    \( -name '*-*.js' -o -name '*-*.css' \) \
    -not -name 'index-*' \
    -mtime +14 -delete 2>/dev/null || true
}

ensure_pm2_static_process() {
  local name="$1"
  local cwd="$2"
  local port="$3"

  if pm2 show "$name" >/dev/null 2>&1; then
    pm2 restart "$name"
  else
    # pm2 needs the script and its args separated — passing a single
    # quoted string like "npx serve -s . -l 3204" makes pm2 treat the
    # whole thing as a file path and fail with "File ... not found".
    local serve_args=(serve -s . -l "$port")
    if [ -f "$cwd/serve.json" ]; then
      serve_args+=(-c serve.json)
    fi
    pm2 start npx --name "$name" --cwd "$cwd" -- "${serve_args[@]}"
  fi
}

ensure_pm2_node_process() {
  local name="$1"
  local script="$2"
  local cwd="$3"

  if pm2 show "$name" >/dev/null 2>&1; then
    pm2 restart "$name" --update-env
  else
    pm2 start "$script" --name "$name" --cwd "$cwd"
  fi
}
