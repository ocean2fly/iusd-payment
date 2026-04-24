# ─────────────────────────────────────────────────────────────────────────
#  _chain_lib.sh — shared helpers for on-chain deploy scripts
# ─────────────────────────────────────────────────────────────────────────
#
# Source this from other deploy scripts:
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/_chain_lib.sh"
#
# Provides:
#   resolve_module_addr_from_key <key_name> [keyring_backend] [home_dir]
#     Look up the bech32 address of an initiad keyring entry and return its
#     20-byte hex form (0x + 40 hex chars). Uses the `bech32` npm package
#     already installed under packages/api/node_modules.
#
#   ensure_module_addr
#     Populates MODULE_ADDR from env if already set, otherwise from
#     DEPLOYER_KEY via the keyring lookup. Exits on failure. The resolved
#     value is exported so child commands see it.
#
#   wait_for_tx <txhash> [max_wait_sec]
#     Poll `initiad query tx` until the hash lands in a block. Returns 0
#     on success, 1 on timeout.
#
#   extract_txhash (stdin)
#     Grep the first "txhash":"<hex>" from JSON output and print just
#     the hex. Used to pipe through `initiad tx ... -o json`.
#
#   extract_object_addr <txhash>
#     Read a tx's `initia_std::object::CreateEvent` and return the created
#     object address (0x + 64 hex). Used to recover PayPool / GiftPool
#     object addresses after init_pool calls.

resolve_module_addr_from_key() {
  local key_name="$1"
  local keyring="${2:-test}"
  local home_dir="${3:-$HOME/.initia/iusd_pay_v3}"

  if [ -z "$key_name" ]; then
    echo "[chain_lib] resolve_module_addr_from_key: missing key_name" >&2
    return 1
  fi

  local bech
  bech=$(initiad keys show "$key_name" -a --bech32 \
    --keyring-backend "$keyring" --home "$home_dir" 2>/dev/null | tr -d '[:space:]')

  if [ -z "$bech" ]; then
    echo "[chain_lib] initiad keys show failed for key '$key_name' (keyring=$keyring home=$home_dir)" >&2
    return 1
  fi

  # Decode bech32 → 20B hex using the bech32 npm package in packages/api.
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local node_cwd=""
  if [ -d "$repo_root/packages/api/node_modules/bech32" ]; then
    node_cwd="$repo_root/packages/api"
  elif [ -d "$repo_root/packages/app/node_modules/bech32" ]; then
    node_cwd="$repo_root/packages/app"
  else
    echo "[chain_lib] bech32 npm package not found under packages/api or packages/app" >&2
    echo "[chain_lib]   run 'pnpm install' at repo root first" >&2
    return 1
  fi

  local hex
  hex=$(cd "$node_cwd" && node -e "
    const { bech32 } = require('bech32');
    try {
      const d = bech32.decode('$bech');
      const bytes = Buffer.from(bech32.fromWords(d.words));
      if (bytes.length !== 20) {
        process.stderr.write('bech32 decoded ' + bytes.length + ' bytes, expected 20\n');
        process.exit(1);
      }
      process.stdout.write('0x' + bytes.toString('hex'));
    } catch (e) {
      process.stderr.write('bech32 decode failed: ' + e.message + '\n');
      process.exit(1);
    }
  " 2>/dev/null)

  if [ -z "$hex" ] || [ "${#hex}" -ne 42 ]; then
    echo "[chain_lib] bech32 decode produced invalid hex '$hex'" >&2
    return 1
  fi

  echo "$hex"
  return 0
}

ensure_module_addr() {
  if [ -n "${MODULE_ADDR:-}" ]; then
    return 0
  fi
  if [ -z "${DEPLOYER_KEY:-}" ]; then
    echo "ERROR: neither MODULE_ADDR nor DEPLOYER_KEY is set." >&2
    echo "   Either:" >&2
    echo "     DEPLOYER_KEY=<initiad key name> $0" >&2
    echo "   or:" >&2
    echo "     MODULE_ADDR=0x<40-hex> $0" >&2
    exit 1
  fi
  MODULE_ADDR=$(resolve_module_addr_from_key \
    "$DEPLOYER_KEY" \
    "${KEYRING_BACKEND:-test}" \
    "${HOME_DIR:-$HOME/.initia/iusd_pay_v3}")
  if [ -z "$MODULE_ADDR" ]; then
    echo "ERROR: could not resolve MODULE_ADDR from key '$DEPLOYER_KEY'" >&2
    exit 1
  fi
  export MODULE_ADDR
  echo "▶ Auto-resolved MODULE_ADDR=$MODULE_ADDR (from key '$DEPLOYER_KEY')"
}

wait_for_tx() {
  local txhash="$1"
  local max_wait="${2:-60}"
  local waited=0
  echo "    waiting for $txhash to land (max ${max_wait}s)..."
  while [ "$waited" -lt "$max_wait" ]; do
    local resp
    resp=$(initiad query tx "$txhash" --node "${NODE:-https://rpc.initia.xyz}" -o json 2>/dev/null)
    if [ -n "$resp" ]; then
      local height
      height=$(echo "$resp" | grep -oE '"height"[[:space:]]*:[[:space:]]*"[0-9]+"' \
                           | head -1 | grep -oE '[0-9]+')
      if [ -n "$height" ] && [ "$height" != "0" ]; then
        echo "    ✓ tx in block $height"
        return 0
      fi
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "    ⚠ timed out waiting for $txhash (waited ${max_wait}s)"
  return 1
}

extract_txhash() {
  grep -o '"txhash":"[A-Fa-f0-9]*"' | head -1 | sed 's/"txhash":"//; s/"//'
}

extract_object_addr() {
  local txhash="$1"
  initiad query tx "$txhash" --node "${NODE:-https://rpc.initia.xyz}" -o json 2>/dev/null \
    | grep -oE '"object","value":"0x[a-f0-9]{64}"' \
    | head -1 \
    | grep -oE '0x[a-f0-9]{64}'
}
