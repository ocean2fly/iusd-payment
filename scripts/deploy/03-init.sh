#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  03-init.sh — initialize pay_v3 and gift_v3 pools after fresh publish
# ─────────────────────────────────────────────────────────────────────────
#
# Usage:
#   DEPLOYER_KEY=<initiad-key-name> bash scripts/deploy/03-init.sh
#
# Env:
#   MODULE_ADDR=0x...             (auto-resolved from DEPLOYER_KEY if unset)
#   IUSD_FA=0x...                 iUSD fungible asset metadata object addr
#                                 (default: 0x1908... -- interwoven-1 iUSD)
#   PAY_FEE_BPS=50                pay_v3 pool fee in basis points
#   PAY_FEE_CAP=10000000          pay_v3 pool fee cap (10 iUSD)
#   CHAIN_ID / NODE / KEYRING_BACKEND / HOME_DIR -- standard initiad overrides
#
#   RELAYER_ADDRS=init1a,init1b,...  (comma-separated bech32 list)
#     If set, each will be added as sponsor to both pay + gift pools.
#     If unset, no sponsors are added -- run add-sponsors later manually.
#
#   REGISTER_GIFT_BOXES=1            if set, registers a default box #0
#                                    with name "Standard Gift", amount 0
#                                    (flexible), fee_bps 50, enabled true.
#                                    You will want to add more boxes via the
#                                    admin panel after init.
#
# What it does (in order):
#   1. init pay_v3::FrozenRegistry
#   2. init pay_v3 pool
#   3. init gift_v3 pool
#   4. extract pool object addresses from the init TX events
#   5. (optional) add sponsors to both pools
#   6. (optional) register a default gift box
#   7. print env var snippets to paste into .env.api and packages/app/.env

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_chain_lib.sh"

CHAIN_ID="${CHAIN_ID:-interwoven-1}"
NODE="${NODE:-https://rpc.initia.xyz}"
KEYRING_BACKEND="${KEYRING_BACKEND:-test}"
HOME_DIR="${HOME_DIR:-$HOME/.initia/iusd_pay_v3}"
IUSD_FA="${IUSD_FA:-0x1908077bb700bdccbf6824b625779a8346b182c716902950087c0d5e74b6cd5a}"
PAY_FEE_BPS="${PAY_FEE_BPS:-50}"
PAY_FEE_CAP="${PAY_FEE_CAP:-10000000}"

if [ -z "${DEPLOYER_KEY:-}" ]; then
  echo "ERROR: set DEPLOYER_KEY=<your-initiad-key-name> and retry" >&2
  exit 1
fi

ensure_module_addr

echo "▶ Init config:"
echo "    chain:    $CHAIN_ID"
echo "    node:     $NODE"
echo "    module:   $MODULE_ADDR"
echo "    iusd_fa:  $IUSD_FA"
echo "    pay fee:  ${PAY_FEE_BPS} bps, cap ${PAY_FEE_CAP}"
echo "    from:     $DEPLOYER_KEY"
echo ""

COMMON_ARGS=(
  --from "$DEPLOYER_KEY"
  --keyring-backend "$KEYRING_BACKEND"
  --home "$HOME_DIR"
  --chain-id "$CHAIN_ID"
  --node "$NODE"
  --gas auto
  --gas-adjustment 1.5
  --gas-prices 0.015uinit
  -y
  -o json
)

# ────────────────────────────────────────────────────────────────────
# Step 1: init FrozenRegistry (pay_v3)
# ────────────────────────────────────────────────────────────────────
echo "▶ Step 1/6: init pay_v3::FrozenRegistry"
FR_OUT=$(initiad tx move execute "$MODULE_ADDR" pay_v3 init_freeze_registry \
  --args "[]" \
  "${COMMON_ARGS[@]}" 2>&1) || {
  # may already exist; continue and let the user inspect
  echo "    (init_freeze_registry failed or already exists — continuing)"
  echo "$FR_OUT" | tail -5
}
FR_TX=$(echo "$FR_OUT" | extract_txhash || true)
if [ -n "$FR_TX" ]; then
  wait_for_tx "$FR_TX" 60 || true
fi

# ────────────────────────────────────────────────────────────────────
# Step 2: init pay_v3 pool
# ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 2/6: init pay_v3 pool"
# pay_v3::init_pool(owner, iusd_fa, fee_bps, fee_cap)
PAY_INIT_ARGS="[\"object:$IUSD_FA\",\"u64:$PAY_FEE_BPS\",\"u64:$PAY_FEE_CAP\"]"
PAY_OUT=$(initiad tx move execute "$MODULE_ADDR" pay_v3 init_pool \
  --args "$PAY_INIT_ARGS" \
  "${COMMON_ARGS[@]}" 2>&1)
echo "$PAY_OUT" | tail -3
PAY_TX=$(echo "$PAY_OUT" | extract_txhash || true)
if [ -z "$PAY_TX" ]; then
  echo "    ✗ could not parse pay_v3 init tx hash" >&2
  exit 1
fi
wait_for_tx "$PAY_TX" 60 || { echo "    ✗ pay_v3 init not confirmed" >&2; exit 1; }
PAY_POOL=$(extract_object_addr "$PAY_TX")
if [ -z "$PAY_POOL" ]; then
  echo "    ✗ could not extract PayPoolV3 object address from tx $PAY_TX" >&2
  echo "    run manually: initiad query tx $PAY_TX --node $NODE -o json | grep object" >&2
  exit 1
fi
echo "    ✓ PayPoolV3 object: $PAY_POOL"

# ────────────────────────────────────────────────────────────────────
# Step 3: init gift_v3 pool
# ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Step 3/6: init gift_v3 pool"
# gift_v3::init_pool(owner, iusd_fa)
GIFT_INIT_ARGS="[\"object:$IUSD_FA\"]"
GIFT_OUT=$(initiad tx move execute "$MODULE_ADDR" gift_v3 init_pool \
  --args "$GIFT_INIT_ARGS" \
  "${COMMON_ARGS[@]}" 2>&1)
echo "$GIFT_OUT" | tail -3
GIFT_TX=$(echo "$GIFT_OUT" | extract_txhash || true)
if [ -z "$GIFT_TX" ]; then
  echo "    ✗ could not parse gift_v3 init tx hash" >&2
  exit 1
fi
wait_for_tx "$GIFT_TX" 60 || { echo "    ✗ gift_v3 init not confirmed" >&2; exit 1; }
GIFT_POOL=$(extract_object_addr "$GIFT_TX")
if [ -z "$GIFT_POOL" ]; then
  echo "    ✗ could not extract GiftPoolV3 object address from tx $GIFT_TX" >&2
  echo "    run manually: initiad query tx $GIFT_TX --node $NODE -o json | grep object" >&2
  exit 1
fi
echo "    ✓ GiftPoolV3 object: $GIFT_POOL"

# ────────────────────────────────────────────────────────────────────
# Step 4: add sponsors (optional)
# ────────────────────────────────────────────────────────────────────
echo ""
if [ -n "${RELAYER_ADDRS:-}" ]; then
  echo "▶ Step 4/6: adding sponsors to both pools"
  IFS=',' read -ra ADDRS <<< "$RELAYER_ADDRS"
  for ADDR in "${ADDRS[@]}"; do
    ADDR=$(echo "$ADDR" | tr -d '[:space:]')
    [ -z "$ADDR" ] && continue
    echo "    + pay_v3::add_sponsor $ADDR"
    initiad tx move execute "$MODULE_ADDR" pay_v3 add_sponsor \
      --args "[\"object:$PAY_POOL\",\"address:$ADDR\"]" \
      "${COMMON_ARGS[@]}" >/dev/null 2>&1 || echo "      (failed, continuing)"
    sleep 2
    echo "    + gift_v3::add_sponsor $ADDR"
    initiad tx move execute "$MODULE_ADDR" gift_v3 add_sponsor \
      --args "[\"object:$GIFT_POOL\",\"address:$ADDR\"]" \
      "${COMMON_ARGS[@]}" >/dev/null 2>&1 || echo "      (failed, continuing)"
    sleep 2
  done
  echo "    done."
else
  echo "▶ Step 4/6: SKIPPED (RELAYER_ADDRS not set)"
  echo "    Add sponsors later with:"
  echo "      initiad tx move execute $MODULE_ADDR pay_v3 add_sponsor \\"
  echo "        --args '[\"object:$PAY_POOL\",\"address:<relayer>\"]' ..."
fi

# ────────────────────────────────────────────────────────────────────
# Step 5: register default gift box (optional)
# ────────────────────────────────────────────────────────────────────
echo ""
if [ "${REGISTER_GIFT_BOXES:-0}" = "1" ]; then
  echo "▶ Step 5/6: registering default gift box #0"
  # register_box(admin, pool, box_id, name, amount, fee_bps, urls, enabled)
  initiad tx move execute "$MODULE_ADDR" gift_v3 register_box \
    --args "[\"object:$GIFT_POOL\",\"u64:0\",\"string:Standard Gift\",\"u64:0\",\"u64:50\",\"vector<string>:[]\",\"bool:true\"]" \
    "${COMMON_ARGS[@]}" >/dev/null 2>&1 || echo "    (failed, continuing)"
  echo "    done."
else
  echo "▶ Step 5/6: SKIPPED (REGISTER_GIFT_BOXES != 1)"
  echo "    Register gift boxes via the admin panel after init."
fi

# ────────────────────────────────────────────────────────────────────
# Step 6: print env var snippets
# ────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Init complete."
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  MODULE_ADDRESS    = $MODULE_ADDR"
echo "  IPAY_POOL_ADDRESS = $PAY_POOL"
echo "  GIFT_POOL_ADDRESS = $GIFT_POOL"
echo "  IUSD_FA           = $IUSD_FA"
echo "────────────────────────────────────────────────────────────"
echo ""
echo "Paste into packages/api/.env.api (API runtime):"
echo "  MODULE_ADDRESS=$MODULE_ADDR"
echo "  IPAY_POOL_ADDRESS=$PAY_POOL"
echo "  GIFT_POOL_ADDRESS=$GIFT_POOL"
echo "  IUSD_FA=$IUSD_FA"
echo ""
echo "Paste into packages/app/.env (frontend build-time):"
echo "  VITE_MODULE_ADDRESS=$MODULE_ADDR"
echo "  VITE_IPAY_POOL_ADDRESS=$PAY_POOL"
echo "  VITE_GIFT_POOL_ADDRESS=$GIFT_POOL"
echo "  VITE_IUSD_FA=$IUSD_FA"
echo ""
echo "Then:"
echo "  1. Rebuild + restart backend: bash scripts/deploy/build-api.sh && bash scripts/deploy/restart-api.sh"
echo "  2. Rebuild frontend: bash scripts/deploy/build-frontend.sh && bash scripts/deploy/deploy-frontend-static.sh"
