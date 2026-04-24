#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  re-register-gift-boxes-baked.sh — pre-baked 24 gift_v3 register_box calls
# ─────────────────────────────────────────────────────────────────────────
#
# Generated from gift_box_meta on 2026-04-14.
# Use this on deploy machines that have no DB access — all the box data
# (box_id / name / image_urls) is hard-coded so the script only needs:
#   - initiad CLI
#   - deployer keyring
#   - access to the RPC node
#
# Usage:
#   DEPLOYER_KEY=<initiad-key-name> \
#   GIFT_POOL_ADDRESS=0x... \
#     bash scripts/deploy/re-register-gift-boxes-baked.sh
#
# Defaults: amount=0 (flexible), fee_bps=50, enabled=true for every box.
# Override all with BOX_AMOUNT= / BOX_FEE_BPS= env vars if you want.
#
# DRY_RUN=1 → only print commands, do not broadcast.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_chain_lib.sh"

CHAIN_ID="${CHAIN_ID:-interwoven-1}"
NODE="${NODE:-https://rpc.initia.xyz}"
KEYRING_BACKEND="${KEYRING_BACKEND:-test}"
HOME_DIR="${HOME_DIR:-$HOME/.initia/iusd_pay_v3}"
BOX_AMOUNT="${BOX_AMOUNT:-0}"
BOX_FEE_BPS="${BOX_FEE_BPS:-50}"

if [ -z "${DEPLOYER_KEY:-}" ]; then
  echo "ERROR: set DEPLOYER_KEY=<your-initiad-key-name> and retry" >&2
  exit 1
fi
if [ -z "${GIFT_POOL_ADDRESS:-}" ]; then
  echo "ERROR: set GIFT_POOL_ADDRESS=0x... (the new GiftPoolV3 object)" >&2
  exit 1
fi

ensure_module_addr

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

OK_COUNT=0
FAIL_IDS=()

register_box() {
  local BOX_ID="$1"; shift
  local NAME="$1";   shift
  local URLS="$1";   shift
  echo ""
  echo "▶ Box #$BOX_ID: $NAME"
  local ARGS_JSON
  ARGS_JSON='["object:'"$GIFT_POOL_ADDRESS"'","u64:'"$BOX_ID"'","string:'"$NAME"'","u64:'"$BOX_AMOUNT"'","u64:'"$BOX_FEE_BPS"'","vector<string>:'"$URLS"'","bool:true"]'
  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "    (dry-run) args: $ARGS_JSON"
    OK_COUNT=$((OK_COUNT + 1))
    return 0
  fi
  local OUT
  OUT=$(initiad tx move execute "$MODULE_ADDR" gift_v3 register_box \
    --args "$ARGS_JSON" \
    "${COMMON_ARGS[@]}" 2>&1) || {
    echo "    ✗ tx failed:"
    echo "$OUT" | tail -5 | sed "s/^/      /"
    FAIL_IDS+=("$BOX_ID")
    sleep 1
    return 0
  }
  local TX
  TX=$(echo "$OUT" | extract_txhash || true)
  if [ -n "$TX" ]; then
    if wait_for_tx "$TX" 60 2>/dev/null; then
      echo "    ✓ tx $TX"
      OK_COUNT=$((OK_COUNT + 1))
    else
      echo "    ✗ tx $TX did not confirm in 60s"
      FAIL_IDS+=("$BOX_ID")
    fi
  else
    echo "    ✗ could not parse tx hash"
    FAIL_IDS+=("$BOX_ID")
  fi
  sleep 1
}

echo "▶ Re-register config:"
echo "    chain:       $CHAIN_ID"
echo "    node:        $NODE"
echo "    module:      $MODULE_ADDR"
echo "    gift pool:   $GIFT_POOL_ADDRESS"
echo "    from:        $DEPLOYER_KEY"
echo "    amount:      $BOX_AMOUNT (0 = flexible)"
echo "    fee_bps:     $BOX_FEE_BPS"
echo "    dry run:     ${DRY_RUN:-0}"

# ── Baked box data (from gift_box_meta @ 2026-04-14) ──

register_box '1' 'Music Box' 'https://iusd-pay.xyz/images/gifts/box_1_0.jpg,https://iusd-pay.xyz/images/gifts/box_1_2.jpg'
register_box '2' 'FLY Coffee' 'https://iusd-pay.xyz/images/gifts/image__6__3e599dd35c5b.jpg'
register_box '3' 'Repeating watch' 'https://iusd-pay.xyz/images/gifts/box_3_0.jpg,https://iusd-pay.xyz/images/gifts/box_3_2.jpg,https://iusd-pay.xyz/images/gifts/box_3_3.jpg,https://iusd-pay.xyz/images/gifts/box_3_4.jpg'
register_box '4' 'Guitar' 'https://iusd-pay.xyz/images/gifts/box_4_0.jpg'
register_box '5' 'Music Box' 'https://iusd-pay.xyz/images/gifts/box_5_0.jpg,https://iusd-pay.xyz/images/gifts/box_5_2.jpg,https://iusd-pay.xyz/images/gifts/box_5_3.jpg'
register_box '6' 'Guitar' 'https://iusd-pay.xyz/images/gifts/box_6_0.jpg,https://iusd-pay.xyz/images/gifts/box_6_2.jpg,https://iusd-pay.xyz/images/gifts/box_6_3.jpg,https://iusd-pay.xyz/images/gifts/box_6_4.jpg'
register_box '7' 'Winter Morning in the Country' 'https://iusd-pay.xyz/images/gifts/box_7_0.jpg'
register_box '8' 'Give Me Liberty or Give Me Death!' 'https://iusd-pay.xyz/images/gifts/box_8_0.jpg'
register_box '9' 'Music Box' 'https://iusd-pay.xyz/images/gifts/box_9_0.jpg,https://iusd-pay.xyz/images/gifts/box_9_2.jpg'
register_box '10' 'Watch case' 'https://iusd-pay.xyz/images/gifts/box_10_0.jpg,https://iusd-pay.xyz/images/gifts/box_10_2.jpg'
register_box '11' 'Division Viol' 'https://iusd-pay.xyz/images/gifts/box_11_0.jpg,https://iusd-pay.xyz/images/gifts/box_11_2.jpg,https://iusd-pay.xyz/images/gifts/box_11_3.jpg,https://iusd-pay.xyz/images/gifts/box_11_4.jpg'
register_box '12' 'Dragon' 'https://iusd-pay.xyz/images/gifts/box_12_0.jpg,https://iusd-pay.xyz/images/gifts/box_12_3.jpg'
register_box '13' 'Roses and Lilies' 'https://iusd-pay.xyz/images/gifts/box_13_0.jpg'
register_box '14' 'Watch' 'https://iusd-pay.xyz/images/gifts/box_14_0.jpg,https://iusd-pay.xyz/images/gifts/box_14_2.jpg,https://iusd-pay.xyz/images/gifts/box_14_3.jpg,https://iusd-pay.xyz/images/gifts/box_14_4.jpg'
register_box '15' 'Dragonfly brooch' 'https://iusd-pay.xyz/images/gifts/box_15_0.jpg,https://iusd-pay.xyz/images/gifts/box_15_2.jpg,https://iusd-pay.xyz/images/gifts/box_15_3.jpg,https://iusd-pay.xyz/images/gifts/box_15_4.jpg'
register_box '16' 'Armlet' 'https://iusd-pay.xyz/images/gifts/box_16_0.jpg,https://iusd-pay.xyz/images/gifts/box_16_3.jpg,https://iusd-pay.xyz/images/gifts/box_16_4.jpg'
register_box '17' 'Armor Garniture of George Clifford' 'https://iusd-pay.xyz/images/gifts/box_17_0.jpg,https://iusd-pay.xyz/images/gifts/box_17_2.jpg,https://iusd-pay.xyz/images/gifts/box_17_3.jpg,https://iusd-pay.xyz/images/gifts/box_17_4.jpg'
register_box '18' 'Brooch in the form of an owl head' 'https://iusd-pay.xyz/images/gifts/box_18_0.jpg,https://iusd-pay.xyz/images/gifts/box_18_2.jpg'
register_box '19' 'Watch' 'https://iusd-pay.xyz/images/gifts/box_19_0.jpg,https://iusd-pay.xyz/images/gifts/box_19_2.jpg,https://iusd-pay.xyz/images/gifts/box_19_3.jpg'
register_box '20' 'Irises' 'https://iusd-pay.xyz/images/gifts/box_20_0.jpg'
register_box '21' 'Sugar bowl with cover' 'https://iusd-pay.xyz/images/gifts/box_21_0.jpg,https://iusd-pay.xyz/images/gifts/box_21_2.jpg,https://iusd-pay.xyz/images/gifts/box_21_3.jpg,https://iusd-pay.xyz/images/gifts/box_21_4.jpg'
register_box '22' 'Ewer' 'https://iusd-pay.xyz/images/gifts/box_22_0.jpg,https://iusd-pay.xyz/images/gifts/box_22_2.jpg,https://iusd-pay.xyz/images/gifts/box_22_3.jpg,https://iusd-pay.xyz/images/gifts/box_22_4.jpg'
register_box '23' 'The Actor Asao Gakujūrō I as Mashiba Hisatsugu' 'https://iusd-pay.xyz/images/gifts/box_23_0.jpg'
register_box '24' 'the Crown of the Andes' 'https://iusd-pay.xyz/images/gifts/12_copy_9af58e89eb26.jpg'
TOTAL=24
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  Registered: $OK_COUNT / $TOTAL"
if [ "${#FAIL_IDS[@]}" -gt 0 ]; then
  echo "  Failed box ids: ${FAIL_IDS[*]}"
else
  echo "  ✅ All boxes re-registered."
fi
echo "────────────────────────────────────────────────────────────"
