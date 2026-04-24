#!/usr/bin/env bash
# Patch InterwovenKit 2.5.1 — run after pnpm install
#
# 1. Strip Prefetch to only keep wallet-change + auto-sign
#    Removes: bridge prefetch (chains/assets), registry, portfolioSSE, L1 positions, assets
#    This eliminates all background requests on page load:
#    - router-api.initia.xyz/v2/info/chains
#    - router-api.initia.xyz/v2/fungible/assets
#    - registry.initia.xyz/profiles.json
#    - registry.initia.xyz/chains.json
#
# 2. Analytics disabled via disableAnalytics prop (no patch needed)

set -euo pipefail

PATCHED=0
for f in $(find node_modules/.pnpm -path "*interwovenkit-react@2.5.1*/dist/index.js" 2>/dev/null); do
  # Original: P4 = () => ($p(), ah(), $h(), fe(), Ip(), Ll(), qs(), null)
  #   $p = usePrefetchBridgeData (router API chains/assets)
  #   ah = useClearWalletsOnAddressChange (keep)
  #   $h = useInitializeAutoSign (keep)
  #   fe = useInitiaRegistry (registry profiles/chains)
  #   Ip = usePortfolioSSE
  #   Ll = useL1PositionsTotal
  #   qs = useAllChainsAssetsQueries
  #
  # Keep only ah + $h (wallet + auto-sign)

  # Handle both original (7 hooks) and previously patched (4 hooks) versions
  sed -i 's/P4 = () => (\$p(), ah(), \$h(), fe(), Ip(), Ll(), qs(), null)/P4 = () => (ah(), $h(), null)/g' "$f"
  sed -i 's/P4 = () => (\$p(), ah(), \$h(), fe(), null)/P4 = () => (ah(), $h(), null)/g' "$f"

  PATCHED=$((PATCHED + 1))
done

echo "✅ Patched $PATCHED IK instance(s) — stripped all background requests"
