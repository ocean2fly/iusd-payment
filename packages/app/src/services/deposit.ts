/**
 * Deposit/Withdraw Service — Custom bridge using Initia router API.
 *
 * Closely follows InterwovenKit's bridge implementation:
 *   - simulate.ts     → fetchRoute()
 *   - bridgeTxUtils.ts → fetchBridgeMsgs(), decodeCosmosAminoMessages()
 *   - hooks.ts         → fetchAssets(), fetchBalances(), EXTERNAL_SOURCE_OVERRIDES
 *   - FooterWithAddressList.tsx → buildAddressList()
 *   - chains.ts        → fetchChains()
 */

const ROUTER_API = 'https://router-api.initia.xyz'

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface RouterAsset {
  denom: string
  chain_id: string
  symbol: string
  decimals: number
  logo_uri?: string
  name?: string
  hidden?: boolean
}

export interface ChainInfo {
  chain_id: string
  chain_name: string
  pretty_name: string
  logo_uri?: string
  chain_type: string
  bech32_prefix?: string
}

export interface RouteResponse {
  amount_in: string
  amount_out: string
  source_asset_chain_id: string
  source_asset_denom: string
  dest_asset_chain_id: string
  dest_asset_denom: string
  operations: unknown[]
  required_chain_addresses: string[]
  estimated_route_duration_seconds?: number
  estimated_fees?: Array<{
    fee_type: string
    bridge_id: string
    amount: string
    usd_amount?: string
    origin_asset?: { denom: string; chain_id: string; symbol?: string; decimals?: number }
  }>
}

export interface MsgsResponse {
  txs: Array<{
    cosmos_tx?: { msgs: Array<{ msg_type_url: string; msg: string }>; signer_address?: string }
    evm_tx?: { chain_id: string; to: string; value: string; data: string; signer_address?: string }
  }>
}

interface BalanceEntry {
  amount: string
  price?: string
  value_usd?: string
}

export interface DepositQuote {
  route: RouteResponse
  amountIn: string
  amountOut: string
  amountOutDisplay: string
  amountInDisplay: string
  durationSeconds?: number
  srcAsset: RouterAsset
  dstAsset: RouterAsset | null
}

export interface SourceOption {
  asset: RouterAsset
  chain: ChainInfo
  balance?: BalanceEntry
  balanceDisplay?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function toBaseUnit(amount: string, decimals: number): string {
  if (!amount || amount === '0') return '0'
  const [int = '0', frac = ''] = amount.split('.')
  const padded = frac.padEnd(decimals, '0').slice(0, decimals)
  const raw = BigInt(int) * BigInt(10 ** decimals) + BigInt(padded || '0')
  return raw.toString()
}

export function fromBaseUnit(amount: string, decimals: number): string {
  if (!amount || amount === '0') return '0'
  const s = amount.padStart(decimals + 1, '0')
  const int = s.slice(0, s.length - decimals) || '0'
  const frac = s.slice(s.length - decimals).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

export function formatAmount(amount: string, maxDecimals = 4): string {
  const [int, frac] = amount.split('.')
  if (!frac) return int
  return `${int}.${frac.slice(0, maxDecimals)}`
}

// ── Caches ────────────────────────────────────────────────────────────────

let assetsCache: Map<string, RouterAsset> | null = null
let chainsCache: ChainInfo[] | null = null

// ── Assets ────────────────────────────────────────────────────────────────

export async function fetchAssets(): Promise<Map<string, RouterAsset>> {
  if (assetsCache) return assetsCache
  const res = await fetch(`${ROUTER_API}/v2/fungible/assets`)
  const data = await res.json()
  const map = new Map<string, RouterAsset>()
  for (const [chainId, entry] of Object.entries(data.chain_to_assets_map ?? {})) {
    for (const asset of (entry as any)?.assets ?? []) {
      map.set(`${chainId}:${asset.denom}`, { ...asset, chain_id: chainId })
    }
  }
  assetsCache = map
  return map
}

export function getAsset(chainId: string, denom: string): RouterAsset | undefined {
  return assetsCache?.get(`${chainId}:${denom}`)
}

// ── Chains ────────────────────────────────────────────────────────────────

export async function fetchChains(): Promise<ChainInfo[]> {
  if (chainsCache) return chainsCache
  const res = await fetch(`${ROUTER_API}/v2/info/chains`)
  const data = await res.json()
  chainsCache = data.chains ?? []
  return chainsCache!
}

export function findChain(chainId: string): ChainInfo | undefined {
  return chainsCache?.find(c => c.chain_id === chainId)
}

// ── Balances (from IK hooks.ts useAllBalancesQuery) ───────────────────────

export async function fetchBalances(
  chainIds: string[],
  initiaAddress: string,
  hexAddress: string,
): Promise<Record<string, Record<string, BalanceEntry>>> {
  const chains = await fetchChains()
  const chainMap = new Map(chains.map(c => [c.chain_id, c]))

  const payload: Record<string, { address: string; denoms: string[] }> = {}
  for (const id of chainIds) {
    const chain = chainMap.get(id)
    if (!chain) continue
    payload[id] = {
      address: chain.chain_type === 'evm' ? hexAddress : initiaAddress,
      denoms: [],
    }
  }

  const res = await fetch(`${ROUTER_API}/v2/info/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chains: payload }),
  })
  const data = await res.json()

  const result: Record<string, Record<string, BalanceEntry>> = {}
  for (const id of chainIds) {
    result[id] = data.chains?.[id]?.denoms ?? {}
  }
  return result
}

// ── Source options (from IK hooks.ts EXTERNAL_SOURCE_OVERRIDES) ────────────

const ETHEREUM_CHAIN_ID = '1'
const ETHEREUM_USDC_DENOM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const ETHEREUM_AUSD_DENOM = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a'
const BASE_CHAIN_ID = '8453'
const BASE_USDC_DENOM = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

interface SourceOverride {
  externalSourceSymbols: string[]
  extraExternalOptions: Array<{ chainId: string; denom: string }>
  extraInitiaSourceSymbols: string[]
}

const SOURCE_OVERRIDES: Record<string, SourceOverride> = {
  iUSD: {
    externalSourceSymbols: ['USDC', 'AUSD'],
    extraExternalOptions: [
      { chainId: ETHEREUM_CHAIN_ID, denom: ETHEREUM_USDC_DENOM },
      { chainId: ETHEREUM_CHAIN_ID, denom: ETHEREUM_AUSD_DENOM },
    ],
    extraInitiaSourceSymbols: ['USDC'],
  },
  INIT: {
    externalSourceSymbols: ['iUSD', 'USDC'],
    extraExternalOptions: [],
    extraInitiaSourceSymbols: ['iUSD', 'USDC'],
  },
}

/**
 * For withdraw mode: explicit destination targets.
 * EVM chains (Ethereum, Base) → USDC; all Initia appchains → iUSD.
 */
const WITHDRAW_EVM_DESTINATIONS: Array<{ chainId: string; denom: string }> = [
  { chainId: ETHEREUM_CHAIN_ID, denom: ETHEREUM_USDC_DENOM },
  { chainId: BASE_CHAIN_ID, denom: BASE_USDC_DENOM },
]

export async function fetchSourceOptions(
  localChainId: string,
  localDenom: string,
  initiaAddress: string,
  hexAddress: string,
  /**
   * 'deposit'  → list chains where the user already has balance (these are
   *              true sources — you can only deposit from something you hold).
   * 'withdraw' → list every candidate chain as a potential destination,
   *              regardless of current balance (you can withdraw TO a chain
   *              you've never touched).
   */
  mode: 'deposit' | 'withdraw' = 'deposit',
): Promise<SourceOption[]> {
  const [assets, chains] = await Promise.all([fetchAssets(), fetchChains()])
  const chainMap = new Map(chains.map(c => [c.chain_id, c]))
  const localAsset = assets.get(`${localChainId}:${localDenom}`)
  if (!localAsset) return []

  const override = SOURCE_OVERRIDES[localAsset.symbol]
  const sourceSymbols = override?.externalSourceSymbols ?? [localAsset.symbol]
  const extraOptions = override?.extraExternalOptions ?? []
  const extraInitiaSymbols = override?.extraInitiaSourceSymbols ?? []

  const initiaChainIds = new Set(
    chains.filter(c => c.bech32_prefix === 'init').map(c => c.chain_id)
  )

  // Collect candidate options
  const candidates: SourceOption[] = []

  if (mode === 'withdraw') {
    // ── Withdraw: explicitly list ALL destinations ──────────────────
    // 1. All Initia appchains → iUSD (same symbol as local asset)
    for (const appChainId of initiaChainIds) {
      if (appChainId === localChainId) continue
      // Find iUSD (same symbol) on this appchain
      const asset = assets.get(`${appChainId}:${localDenom}`)
        ?? [...assets.values()].find(a => a.chain_id === appChainId && a.symbol === localAsset.symbol && !a.hidden)
      const chain = chainMap.get(appChainId)
      if (asset && chain) {
        candidates.push({ asset, chain })
      }
    }
    // 2. EVM chains → USDC (Ethereum, Base)
    for (const dest of WITHDRAW_EVM_DESTINATIONS) {
      const asset = assets.get(`${dest.chainId}:${dest.denom}`)
      const chain = chainMap.get(dest.chainId)
      if (asset && chain) {
        candidates.push({ asset, chain })
      }
    }
  } else {
    // ── Deposit: find assets user holds that can bridge in ──────────
    for (const [, asset] of assets) {
      if (asset.hidden) continue
      if (asset.chain_id === localChainId && asset.denom === localDenom) continue

      const isExtraExternal = extraOptions.some(
        o => o.chainId === asset.chain_id && o.denom.toLowerCase() === asset.denom.toLowerCase()
      )
      const isExtraInitia = initiaChainIds.has(asset.chain_id) && extraInitiaSymbols.includes(asset.symbol)
      const isSameSymbol = asset.symbol === localAsset.symbol
      const isSourceSymbol = sourceSymbols.includes(asset.symbol)

      if (!isExtraExternal && !isExtraInitia && !isSameSymbol && !isSourceSymbol) continue

      const chain = chainMap.get(asset.chain_id)
      if (!chain) continue
      // Only EVM and Initia chains (cosmos with init prefix)
      if (chain.chain_type === 'cosmos' && chain.bech32_prefix !== 'init') continue

      candidates.push({ asset, chain })
    }
  }

  // Fetch balances for all candidate chains
  const chainIds = [...new Set(candidates.map(c => c.chain.chain_id))]
  let balances: Record<string, Record<string, BalanceEntry>> = {}
  try {
    balances = await fetchBalances(chainIds, initiaAddress, hexAddress)
  } catch { /* ignore balance errors */ }

  // Enrich with balances. For deposit mode, drop zero-balance rows (you
  // can't deposit what you don't hold). For withdraw mode, keep every
  // candidate regardless of balance — the user wants to send TO that chain,
  // not pull FROM it.
  const enriched = candidates
    .map(opt => {
      const bal = balances[opt.chain.chain_id]?.[opt.asset.denom]
      const amount = bal?.amount ?? '0'
      return {
        ...opt,
        balance: bal,
        balanceDisplay: fromBaseUnit(amount, opt.asset.decimals ?? 6),
      }
    })
    .filter(opt => {
      if (mode === 'withdraw') return true
      // Deposit: hide zero and dust balances (< 0.01)
      const amount = parseFloat(opt.balanceDisplay ?? '0')
      return amount >= 0.01
    })
    .sort((a, b) => {
      // Both modes: sort by USD value desc (richest first),
      // then by raw balance, then alphabetical as tiebreaker.
      const aUsd = parseFloat(a.balance?.value_usd ?? '0')
      const bUsd = parseFloat(b.balance?.value_usd ?? '0')
      if (bUsd !== aUsd) return bUsd - aUsd
      const aBal = parseFloat(a.balanceDisplay ?? '0')
      const bBal = parseFloat(b.balanceDisplay ?? '0')
      if (bBal !== aBal) return bBal - aBal
      return (a.chain.pretty_name || a.chain.chain_name).localeCompare(
        b.chain.pretty_name || b.chain.chain_name,
      )
    })

  return enriched
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function fetchRoute(params: {
  srcChainId: string
  srcDenom: string
  dstChainId: string
  dstDenom: string
  quantity: string
}): Promise<DepositQuote> {
  const assets = await fetchAssets()
  const srcAsset = assets.get(`${params.srcChainId}:${params.srcDenom}`)
  if (!srcAsset || srcAsset.decimals == null) {
    throw new Error('Source asset metadata unavailable')
  }
  const dstAsset = assets.get(`${params.dstChainId}:${params.dstDenom}`) ?? null

  const res = await fetch(`${ROUTER_API}/v2/fungible/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount_in: toBaseUnit(params.quantity, srcAsset.decimals),
      source_asset_chain_id: params.srcChainId,
      source_asset_denom: params.srcDenom,
      dest_asset_chain_id: params.dstChainId,
      dest_asset_denom: params.dstDenom,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Route failed: ${res.status}`)
  }

  const route: RouteResponse = await res.json()
  const outDecimals = dstAsset?.decimals ?? srcAsset.decimals

  return {
    route,
    amountIn: route.amount_in,
    amountOut: route.amount_out,
    amountOutDisplay: fromBaseUnit(route.amount_out, outDecimals),
    amountInDisplay: fromBaseUnit(route.amount_in, srcAsset.decimals),
    durationSeconds: route.estimated_route_duration_seconds,
    srcAsset,
    dstAsset,
  }
}

// ── Address list (from IK FooterWithAddressList.tsx) ───────────────────────

export function buildAddressList(
  route: RouteResponse,
  initiaAddress: string,
  hexAddress: string,
): string[] {
  const { required_chain_addresses } = route
  if (!required_chain_addresses?.length) return [initiaAddress]

  const chainMap = new Map((chainsCache ?? []).map(c => [c.chain_id, c]))

  return required_chain_addresses.map((chainId) => {
    const chain = chainMap.get(chainId)
    if (!chain) return initiaAddress
    if (chain.chain_type === 'evm') return hexAddress
    return initiaAddress
  })
}

// ── Messages (from IK bridgeTxUtils.ts) ───────────────────────────────────

export async function fetchMessages(params: {
  addressList: string[]
  route: RouteResponse
  slippagePercent?: string
}): Promise<MsgsResponse> {
  const payload = {
    address_list: params.addressList,
    amount_in: params.route.amount_in,
    amount_out: params.route.amount_out,
    source_asset_chain_id: params.route.source_asset_chain_id,
    source_asset_denom: params.route.source_asset_denom,
    dest_asset_chain_id: params.route.dest_asset_chain_id,
    dest_asset_denom: params.route.dest_asset_denom,
    slippage_tolerance_percent: params.slippagePercent ?? '1',
    operations: params.route.operations,
  }

  const res = await fetch(`${ROUTER_API}/v2/fungible/msgs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Message generation failed: ${res.status}`)
  }

  const data: MsgsResponse = await res.json()
  if (!data.txs?.length) throw new Error('No transaction data found')
  return data
}

// ── Build messages for signing ────────────────────────────────────────────
// Router API returns amino JSON (snake_case) but requestTxBlock expects
// Router API returns amino JSON (snake_case) with proto typeUrls.
// Must convert snake_case → camelCase for proto encoding.

/** Convert amino JSON (snake_case) to proto format (camelCase), strip undefined/null */
function snakeToCamel(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj
  if (Array.isArray(obj)) return obj.map(snakeToCamel).filter(v => v !== undefined)
  if (typeof obj !== 'object') return obj
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const converted = snakeToCamel(value)
    if (converted === undefined) continue // skip undefined fields entirely
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
    result[camelKey] = converted
  }
  // Remove empty objects (e.g. timeoutHeight: {} → skip)
  if (Object.keys(result).length === 0) return undefined
  return result
}

export interface TxForSigning {
  type: 'cosmos' | 'evm'
  messages?: Array<{ typeUrl: string; value: unknown }>
  chainId?: string  // target chain for broadcast (from cosmos_tx.chain_id)
  evmTx?: { chainId: string; to: string; value: string; data: string }
  erc20Approvals?: Array<{ amount: string; spender: string; token_contract: string }>
}

export function buildTxForSigning(msgsResponse: MsgsResponse): TxForSigning {
  const tx = msgsResponse.txs[0]

  if (tx.cosmos_tx?.msgs?.length) {
    const messages = tx.cosmos_tx.msgs.map(({ msg_type_url, msg }) => {
      if (!msg_type_url || !msg) throw new Error('Invalid message data')
      const raw = JSON.parse(msg)
      const value = snakeToCamel(raw) as Record<string, unknown>

      // Add required defaults for known message types
      if (msg_type_url === '/ibc.applications.transfer.v1.MsgTransfer') {
        if (!('memo' in value)) value.memo = ''
        if (value.timeoutTimestamp != null) value.timeoutTimestamp = String(value.timeoutTimestamp)
      }

      // For Move MsgExecute(JSON), the router-api returns `args` as an array
      // of base64 strings. The initia proto definition has `args` as
      // `repeated bytes`, and InterwovenKit's protobuf encoder requires
      // Uint8Array (not base64 string) per element — otherwise encoding
      // fails with `invalid uint32: undefined` when cosmjs tries to compute
      // the length prefix of a non-bytes value. Decode here.
      if (
        msg_type_url === '/initia.move.v1.MsgExecute' ||
        msg_type_url === '/initia.move.v1.MsgExecuteJSON'
      ) {
        if (Array.isArray(value.args)) {
          value.args = (value.args as unknown[]).map(a =>
            typeof a === 'string' ? base64ToBytes(a) : a,
          )
        }
        if (!Array.isArray(value.typeArgs)) {
          value.typeArgs = []
        }
      }

      return { typeUrl: msg_type_url, value }
    })
    // chain_id from response — tx must be broadcast to this chain, not default
    const chainId = (tx.cosmos_tx as any).chain_id as string | undefined
    return { type: 'cosmos', messages, chainId }
  }

  if (tx.evm_tx) {
    return {
      type: 'evm',
      evmTx: {
        chainId: tx.evm_tx.chain_id,
        to: tx.evm_tx.to,
        value: tx.evm_tx.value,
        data: tx.evm_tx.data,
      },
      erc20Approvals: (tx.evm_tx as any).required_erc20_approvals,
    }
  }

  throw new Error('No supported transaction type in response')
}
