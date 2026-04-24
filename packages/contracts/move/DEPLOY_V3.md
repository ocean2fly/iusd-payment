# iPay V3 Contract Deployment

## Prerequisites

- `initiad` CLI installed
- Deployer wallet with INIT balance for gas
- Deployer address: the `@ipay` address in Move.toml (`0x282fe828fb96aab89620cdd5aaaebabf71cab757`)

## Module Inventory

### V3 (active)
| Module | Purpose |
|--------|---------|
| `pay_v3` | Payment contract (deposit/claim/revoke/expire/refund) |
| `gift_v3` | Gift box system (direct + group red envelopes) |
| `common` | Shared constants and utilities |

### Deprecated (still deployed, not used by v3)
| Module | Replaced By |
|--------|------------|
| `pay` (v1) | `pay_v3` |
| `pay_v2` | `pay_v3` |
| `pay_factory` | removed (create_pool in pay_v3) |
| `pay_v2_factory` | removed |
| `gift_v1` | `gift_v3` |
| `gift_v1_factory` | removed |
| `oracle` | removed (env vars) |
| `config` | removed (env vars) |
| `invoice_v1` | not in v3 scope |

## Step 1: Build

```bash
initiad move build --path packages/contracts/move
```

## Step 2: Deploy (upgrade existing package)

```bash
initiad move publish \
  --path packages/contracts/move \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.015uinit
```

This upgrades the existing `ipay` package at `@ipay`. All new modules
(`pay_v3`, `gift_v3`) are added alongside existing ones.

## Step 3: Initialize Pay V3 Pool

```bash
# Create PayPoolV3 (only @ipay can call)
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  pay_v3 create_pool \
  --args \
    'object:0x1908077bb700bdccbf6824b625779a8346b182c716902950087c0d5e74b6cd5a' \
    'u64:5' \
    'u64:5000000' \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit

# Note the pool object address from TX events (PayPoolV3 address)
```

Parameters:
- `iusd_fa`: `0x1908077bb700bdccbf6824b625779a8346b182c716902950087c0d5e74b6cd5a`
- `fee_bps`: `5` (0.05%)
- `fee_cap`: `5000000` (5 iUSD)

## Step 4: Initialize Gift V3 Pool

```bash
# Create GiftPoolV3 (only @ipay can call)
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 create_pool \
  --args \
    'object:0x1908077bb700bdccbf6824b625779a8346b182c716902950087c0d5e74b6cd5a' \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit

# Note the GiftPoolV3 object address from TX events
```

## Step 5: Initialize Freeze Registry

```bash
# For pay_v3 freeze/unfreeze functionality
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  pay_v3 init_freeze_registry \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit
```

## Step 6: Add Relayer as Sponsor

```bash
RELAYER_ADDR="init14pnn9wy62ddwu6kyvwgykcvhl9pmuyw83de4td"

# Pay V3 sponsor
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  pay_v3 add_sponsor \
  --args 'object:<PAY_POOL_V3_ADDRESS>' "address:$RELAYER_ADDR" \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit

# Gift V3 sponsor
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 add_sponsor \
  --args 'object:<GIFT_POOL_V3_ADDRESS>' "address:$RELAYER_ADDR" \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit
```

## Step 7: Register Gift Boxes (Admin)

```bash
# Example: register a "Classic" gift box (fixed 10 iUSD, 0.5% fee)
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 register_box \
  --args \
    'object:<GIFT_POOL_V3_ADDRESS>' \
    'u64:1' \
    'string:Classic Gift' \
    'u64:10000000' \
    'u64:50' \
    'string:["https://example.com/box1.png","https://example.com/box1-open.png","https://example.com/box1-bg.png"]' \
    'bool:true' \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit
```

## Step 8: List / Delist Gift Boxes (Admin)

After registering boxes, use `list_box` / `delist_box` to control shop availability.
A delisted box will reject all `send_gift` / `send_gift_group` calls with `E_BOX_DISABLED (403)`.

```bash
# Delist a box (下架) — disables box_id 1
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 delist_box \
  --args \
    'object:<GIFT_POOL_V3_ADDRESS>' \
    'u64:1' \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit

# List a box (上架) — re-enables box_id 1
initiad tx move execute \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 list_box \
  --args \
    'object:<GIFT_POOL_V3_ADDRESS>' \
    'u64:1' \
  --from <deployer-key-name> \
  --chain-id interwoven-1 \
  --node https://rpc.initia.xyz \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit
```

### Verify listing status

```bash
initiad query move view \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 is_box_listed \
  --args 'object:<GIFT_POOL_V3_ADDRESS>' 'u64:1' \
  --node https://rpc.initia.xyz
```

## Step 9: Update Environment Variables

Update GitHub environment variables:
```
IPAY_POOL_ADDRESS=<PAY_POOL_V3_ADDRESS>
GIFT_POOL_ADDRESS=<GIFT_POOL_V3_ADDRESS>
MODULE_ADDRESS=0x282fe828fb96aab89620cdd5aaaebabf71cab757
```

Update `.env.api` and `.env.relayer` on the server accordingly.

## Step 10: Update Frontend

The frontend `orderBuilder.ts` needs to reference `pay_v3` instead of `pay_v2`:
- Change `moduleName: 'pay_v2'` to `moduleName: 'pay_v3'`
- Update pool object address to the new PayPoolV3 address

## Verification

```bash
# Check pay_v3 pool
initiad query move view \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  pay_v3 get_pool_stats \
  --args 'object:<PAY_POOL_V3_ADDRESS>' \
  --node https://rpc.initia.xyz

# Check gift_v3 pool
initiad query move view \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 get_pool_stats \
  --args 'object:<GIFT_POOL_V3_ADDRESS>' \
  --node https://rpc.initia.xyz

# Check sponsor
initiad query move view \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  pay_v3 is_sponsor \
  --args 'object:<PAY_POOL_V3_ADDRESS>' 'address:init14pnn9wy62ddwu6kyvwgykcvhl9pmuyw83de4td' \
  --node https://rpc.initia.xyz

# Check box listing status
initiad query move view \
  0x282fe828fb96aab89620cdd5aaaebabf71cab757 \
  gift_v3 is_box_listed \
  --args 'object:<GIFT_POOL_V3_ADDRESS>' 'u64:1' \
  --node https://rpc.initia.xyz
```
