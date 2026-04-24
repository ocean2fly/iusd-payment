#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  02-deploy.sh — publish the iPay Move package to Initia
# ─────────────────────────────────────────────────────────────────────────
#
# Usage:
#   DEPLOYER_KEY=<initiad-key-name> bash scripts/deploy/02-deploy.sh
#
# Prereqs:
#   - 01-build.sh finished with no errors (build/ exists)
#   - `initiad keys list` shows DEPLOYER_KEY
#   - Deployer account == @ipay address in Move.toml (same key that 01-build
#     used). Deployer has enough INIT for gas (~10 INIT recommended).
#
# What it does:
#   Publishes the compiled pay_v3 / gift_v3 / common modules to the
#   deployer's address. This is a FIRST publish (not an upgrade), so
#   the `compatible` upgrade policy in Move.toml is not exercised;
#   the contract starts from empty state.
#
#   After success, you must run 03-init.sh to:
#     - init pay_v3 FrozenRegistry
#     - init pay_v3 pool (emits a PayPoolV3 object)
#     - init gift_v3 pool (emits a GiftPoolV3 object)
#     - add relayer sponsors to both pools
#     - register gift boxes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MOVE_DIR="$REPO_ROOT/packages/contracts/move"
CHAIN_ID="${CHAIN_ID:-interwoven-1}"
NODE="${NODE:-https://rpc.initia.xyz}"
KEYRING_BACKEND="${KEYRING_BACKEND:-test}"
HOME_DIR="${HOME_DIR:-$HOME/.initia/iusd_pay_v3}"

if [ -z "${DEPLOYER_KEY:-}" ]; then
  echo "ERROR: set DEPLOYER_KEY=<your-initiad-key-name> and retry"
  echo "   e.g. DEPLOYER_KEY=deployer bash scripts/deploy/02-deploy.sh"
  exit 1
fi

if [ ! -d "$MOVE_DIR/build" ]; then
  echo "ERROR: no build/ directory. Run 01-build.sh first."
  exit 1
fi

echo "▶ Publishing iPay Move package"
echo "    chain:    $CHAIN_ID"
echo "    node:     $NODE"
echo "    from:     $DEPLOYER_KEY"
echo "    keyring:  $KEYRING_BACKEND"
echo "    home:     $HOME_DIR"
echo ""

cd "$MOVE_DIR"

initiad move deploy \
  --path "$MOVE_DIR" \
  --from "$DEPLOYER_KEY" \
  --keyring-backend "$KEYRING_BACKEND" \
  --home "$HOME_DIR" \
  --chain-id "$CHAIN_ID" \
  --node "$NODE" \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.015uinit \
  -y

echo ""
echo "✅ Publish submitted."
echo "   Next step: DEPLOYER_KEY=$DEPLOYER_KEY bash scripts/deploy/03-init.sh"
