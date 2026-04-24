#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  01-build.sh — build the iPay Move package (pay_v3 + gift_v3 + common)
# ─────────────────────────────────────────────────────────────────────────
#
# Usage (run from anywhere inside the repo):
#   DEPLOYER_KEY=<initiad-key-name> bash scripts/deploy/01-build.sh
#
# Or skip auto-resolution and pass the hex directly:
#   DEPLOYER_ADDRESS_HEX=0x<40-hex> bash scripts/deploy/01-build.sh
#
# What it does:
#   1. Resolve the deployer address (either from DEPLOYER_KEY via initiad
#      keyring lookup, or from DEPLOYER_ADDRESS_HEX).
#   2. Temporarily rewrite packages/contracts/move/Move.toml so the
#      `[addresses].ipay` line matches the deployer. Original file is
#      restored on exit (trap EXIT), including on failure.
#   3. Clean any stale build artifacts.
#   4. Run `initiad move build`.
#
# On success: compiled artifacts land in packages/contracts/move/build/
# On failure: prints the compiler output; don't proceed to 02-deploy.sh
#
# Prereqs:
#   - `initiad` on PATH (tested with v1.4.3+)
#   - git checkout has packages/contracts/move/sources/{common,pay_v3,gift_v3}.move
#   - pnpm install has run (the bech32 npm package is needed for
#     auto-resolution of deployer hex from a keyring name)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOVE_DIR="$REPO_ROOT/packages/contracts/move"
MOVE_TOML="$MOVE_DIR/Move.toml"
MOVE_TOML_BAK="$MOVE_DIR/Move.toml.bak"

source "$SCRIPT_DIR/_chain_lib.sh"

if [ ! -f "$MOVE_TOML" ]; then
  echo "ERROR: cannot find Move.toml at $MOVE_DIR"
  exit 1
fi

# Resolve DEPLOYER_ADDRESS_HEX
if [ -z "${DEPLOYER_ADDRESS_HEX:-}" ]; then
  if [ -z "${DEPLOYER_KEY:-}" ]; then
    echo "ERROR: set DEPLOYER_KEY=<initiad key name> or DEPLOYER_ADDRESS_HEX=0x<40-hex>" >&2
    exit 1
  fi
  DEPLOYER_ADDRESS_HEX=$(resolve_module_addr_from_key \
    "$DEPLOYER_KEY" \
    "${KEYRING_BACKEND:-test}" \
    "${HOME_DIR:-$HOME/.initia/iusd_pay_v3}")
  if [ -z "$DEPLOYER_ADDRESS_HEX" ]; then
    echo "ERROR: could not resolve deployer address from key '$DEPLOYER_KEY'" >&2
    exit 1
  fi
  echo "▶ Auto-resolved DEPLOYER_ADDRESS_HEX=$DEPLOYER_ADDRESS_HEX (from key '$DEPLOYER_KEY')"
fi

# Validate format
if ! [[ "$DEPLOYER_ADDRESS_HEX" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: DEPLOYER_ADDRESS_HEX must be 0x + 40 hex chars (got: $DEPLOYER_ADDRESS_HEX)"
  exit 1
fi

# Back up Move.toml and register restore trap
cp "$MOVE_TOML" "$MOVE_TOML_BAK"
trap 'mv "$MOVE_TOML_BAK" "$MOVE_TOML" 2>/dev/null || true' EXIT

# Rewrite the `ipay = "0x..."` line
sed -i "s|^ipay = \".*\"|ipay = \"${DEPLOYER_ADDRESS_HEX}\"|" "$MOVE_TOML"
echo "▶ Move.toml [addresses].ipay temporarily set to: $DEPLOYER_ADDRESS_HEX"

echo "▶ Repo root:   $REPO_ROOT"
echo "▶ Move pkg:    $MOVE_DIR"
echo "▶ Sources:"
ls "$MOVE_DIR/sources"

echo "▶ Clean previous build"
rm -rf "$MOVE_DIR/build"

echo "▶ initiad move build"
cd "$MOVE_DIR"
initiad move build

echo ""
echo "✅ Build complete. Artifacts in: $MOVE_DIR/build/"
echo "   Deployer hex:   $DEPLOYER_ADDRESS_HEX"
echo "   Next step:      DEPLOYER_KEY=$DEPLOYER_KEY bash scripts/deploy/02-deploy.sh"
