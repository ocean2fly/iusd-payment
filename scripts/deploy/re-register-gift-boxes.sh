#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  re-register-gift-boxes.sh — re-register all gift boxes on a fresh pool
# ─────────────────────────────────────────────────────────────────────────
#
# Context: the gift_v3 pool was re-created (new IUSD_FA) so the chain-side
# `boxes` table is empty. The off-chain `gift_box_meta` rows in Postgres
# survived the DB cleanup, so we have the canonical name / image_urls /
# collection — we just need to push each one back on-chain.
#
# Usage:
#   DEPLOYER_KEY=<initiad-key-name> \
#   GIFT_POOL_ADDRESS=0x... \
#     bash scripts/deploy/re-register-gift-boxes.sh
#
# Optional env:
#   CHAIN_ID / NODE / KEYRING_BACKEND / HOME_DIR — standard initiad overrides
#   MODULE_ADDR=0x...     — auto-resolved from DEPLOYER_KEY if unset
#   BOX_AMOUNT=0          — default amount (0 = flexible) for every box
#   BOX_FEE_BPS=50        — default fee bps for every box
#   DATABASE_URL=postgresql://...
#   DRY_RUN=1             — only print the commands, do not execute
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
DATABASE_URL="${DATABASE_URL:-postgresql://ipay:ipay_secure_2026@127.0.0.1:5432/ipay}"

if [ -z "${DEPLOYER_KEY:-}" ]; then
  echo "ERROR: set DEPLOYER_KEY=<your-initiad-key-name> and retry" >&2
  exit 1
fi
if [ -z "${GIFT_POOL_ADDRESS:-}" ]; then
  echo "ERROR: set GIFT_POOL_ADDRESS=0x... (the new GiftPoolV3 object)" >&2
  exit 1
fi

ensure_module_addr

echo "▶ Re-register config:"
echo "    chain:       $CHAIN_ID"
echo "    node:        $NODE"
echo "    module:      $MODULE_ADDR"
echo "    gift pool:   $GIFT_POOL_ADDRESS"
echo "    from:        $DEPLOYER_KEY"
echo "    amount:      $BOX_AMOUNT (0 = flexible)"
echo "    fee_bps:     $BOX_FEE_BPS"
echo "    dry run:     ${DRY_RUN:-0}"
echo ""

# ── Pull boxes from Postgres ──
#
# Tab-separated so embedded commas in names stay together. Each row is:
#   box_id <TAB> name <TAB> image_urls_json
#
ROWS=$(
  PGPASSWORD="${DATABASE_URL#*:*@}"
  PGPASSWORD="${PGPASSWORD%@*}"
  PGPASSWORD="${PGPASSWORD##*:}"
  PGPASSWORD="$PGPASSWORD" psql "$DATABASE_URL" -At -F $'\t' -c \
    "SELECT box_id, name, image_urls FROM gift_box_meta ORDER BY box_id;"
)

if [ -z "$ROWS" ]; then
  echo "ERROR: gift_box_meta is empty — nothing to re-register" >&2
  exit 1
fi

TOTAL=$(echo "$ROWS" | wc -l)
echo "Found $TOTAL boxes in gift_box_meta."
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

# Track failures so we can print a summary at the end.
FAIL_IDS=()
OK_COUNT=0

IFS=$'\n'
for LINE in $ROWS; do
  BOX_ID=$(echo "$LINE" | awk -F'\t' '{print $1}')
  NAME=$(echo "$LINE"   | awk -F'\t' '{print $2}')
  URLS_JSON=$(echo "$LINE" | awk -F'\t' '{print $3}')

  # initiad CLI expects `vector<string>:v1,v2,v3` (comma-separated, no
  # brackets) per `initiad tx move execute --help`. JSON-array form
  # ("[url1,url2]") fails with NUMBER_OF_ARGUMENTS_MISMATCH because the
  # CLI's arg parser can't handle it.
  URLS_CSV=$(python3 -c 'import json,sys; print(",".join(json.loads(sys.argv[1])))' "$URLS_JSON")
  URLS_ARG="vector<string>:$URLS_CSV"

  # Escape any double quotes in the name (unlikely but harmless)
  NAME_ESCAPED="${NAME//\"/\\\"}"

  echo "▶ Box #$BOX_ID: $NAME"

  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "    (dry-run) would execute: initiad tx move execute $MODULE_ADDR gift_v3 register_box ..."
    echo "       args: object:$GIFT_POOL_ADDRESS u64:$BOX_ID \"string:$NAME_ESCAPED\" u64:$BOX_AMOUNT u64:$BOX_FEE_BPS $URLS_ARG bool:true"
    OK_COUNT=$((OK_COUNT + 1))
    continue
  fi

  ARGS_JSON="[\"object:$GIFT_POOL_ADDRESS\",\"u64:$BOX_ID\",\"string:$NAME_ESCAPED\",\"u64:$BOX_AMOUNT\",\"u64:$BOX_FEE_BPS\",\"$URLS_ARG\",\"bool:true\"]"

  OUT=$(initiad tx move execute "$MODULE_ADDR" gift_v3 register_box \
    --args "$ARGS_JSON" \
    "${COMMON_ARGS[@]}" 2>&1) || {
    echo "    ✗ tx failed, last 5 lines of output:"
    echo "$OUT" | tail -5 | sed 's/^/      /'
    FAIL_IDS+=("$BOX_ID")
    sleep 1
    continue
  }

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

  # Small delay to avoid sequence-mismatch errors from back-to-back txs
  sleep 1
done
unset IFS

echo ""
echo "────────────────────────────────────────────────────────────"
echo "  Registered: $OK_COUNT / $TOTAL"
if [ "${#FAIL_IDS[@]}" -gt 0 ]; then
  echo "  Failed box ids: ${FAIL_IDS[*]}"
  echo ""
  echo "  Retry the failed ones by re-running the script — re-register of"
  echo "  an existing box_id will fail with E_BOX_EXISTS, so first call"
  echo "  update_box (or remove_box + register_box) for that id from the"
  echo "  admin panel."
else
  echo "  ✅ All boxes re-registered."
fi
echo "────────────────────────────────────────────────────────────"
