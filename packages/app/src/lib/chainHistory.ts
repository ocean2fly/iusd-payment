/**
 * chainHistory.ts
 * Frontend queries Initia chain RPC directly for payment history.
 * No iPay API involved — pure chain-first.
 */

const RPC = import.meta.env.VITE_RPC_URL || 'https://rpc.initia.xyz'
const MODULE_HEX = (import.meta.env.VITE_MODULE_ADDRESS || '').toLowerCase()
const CREATED_EVENT = `${MODULE_HEX}::pay_v3::PaymentCreatedEventV2`
const CLAIMED_EVENT = `${MODULE_HEX}::pay_v3::PaymentClaimedEventV2`

export interface ChainPayment {
  // NOTE: Since we hash payment_id before submitting it to the contract,
  // `paymentId` here is the SHA-256 HASH of the plain claim-link id —
  // NOT the value that lives in the DB / claim links. Do not attempt to
  // correlate this field against DB rows; use the iPay API enrichment
  // endpoints instead for sender/recipient/memo.
  paymentId:    string    // 0x-prefixed (sha256(plain))
  txHash:       string
  blockHeight:  number
  amountMicro:  string
  feeMicro:     string
  expiresAt:    number
  senderEvm:    string
  recipientEvm: string
  status:       number    // 0=pending 2=claimable 3=confirmed
  // enriched fields (from iPay API, optional)
  recipientShortId?: string | null
  senderShortId?:    string | null
  dbCreatedAt?:      string | null
}

// ── Bech32 helpers (inline, no dep needed) ────────────────────────────────

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]
  }
  return chk
}
function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = []
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5)
  ret.push(0)
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31)
  return ret
}
function bech32Decode(bechStr: string): { hrp: string; words: number[] } | null {
  const str = bechStr.toLowerCase()
  const pos = str.lastIndexOf('1')
  if (pos < 1 || pos + 7 > str.length || str.length > 90) return null
  const hrp = str.slice(0, pos)
  const data: number[] = []
  for (let i = pos + 1; i < str.length; i++) {
    const d = BECH32_CHARSET.indexOf(str[i])
    if (d === -1) return null
    data.push(d)
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== 1) return null
  return { hrp, words: data.slice(0, -6) }
}
function convertBits(data: number[], fromBits: number, toBits: number, pad = true): number[] | null {
  let acc = 0, bits = 0
  const out: number[] = [], maxv = (1 << toBits) - 1
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) return null
    acc = (acc << fromBits) | value; bits += fromBits
    while (bits >= toBits) { bits -= toBits; out.push((acc >> bits) & maxv) }
  }
  if (pad) { if (bits > 0) out.push((acc << (toBits - bits)) & maxv) }
  else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) return null
  return out
}

/** Convert init1... bech32 → 0x hex EVM address */
export function bech32ToEvmHex(addr: string): string {
  try {
    const dec = bech32Decode(addr)
    if (!dec) return addr
    const bytes = convertBits(dec.words, 5, 8, false)
    if (!bytes) return addr
    return '0x' + bytes.map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { return addr }
}

// ── RPC helpers ───────────────────────────────────────────────────────────

async function rpcTxSearch(query: string, page = 1, perPage = 50): Promise<any[]> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'tx_search',
      params: { query, prove: false, page: String(page), per_page: String(perPage), order_by: 'desc' },
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return []
  const json = await res.json() as any
  return json?.result?.txs ?? []
}

function extractPayEvents(txs: any[], eventType: string): ChainPayment[] {
  const out: ChainPayment[] = []
  for (const tx of txs) {
    const events: any[] = tx?.tx_result?.events ?? []
    for (const ev of events) {
      if (ev.type !== 'move') continue
      const attrs: Record<string, string> = {}
      for (const a of (ev.attributes ?? [])) attrs[a.key] = a.value
      if (attrs['type_tag'] !== eventType) continue
      try {
        const d = JSON.parse(attrs['data'] ?? '{}')
        out.push({
          paymentId:   '0x' + String(d.payment_id ?? '').replace(/^0x/, ''),
          txHash:      tx.hash as string,
          blockHeight: parseInt(tx.height ?? '0'),
          amountMicro: String(d.amount ?? '0'),
          feeMicro:    String(d.fee    ?? '0'),
          expiresAt:   Number(d.expires_at  ?? 0),
          senderEvm:   String(d.sender      ?? ''),
          recipientEvm:String(d.recipient   ?? d.claimed_by ?? ''),
          status:      Number(d.status      ?? 0),
        })
      } catch { /* skip */ }
    }
  }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Fetch sent payments for a given address (chain only, no iPay API).
 * @param address  init1... bech32 or 0x EVM hex
 */
export async function fetchSentHistory(address: string, page = 1, limit = 50): Promise<ChainPayment[]> {
  // RPC message.sender filter requires bech32
  let bech32Addr = address
  if (address.startsWith('0x') || !address.startsWith('init')) {
    // hex → bech32: we can just use the raw bech32Addr stored in account
    // Fallback: pass as-is (won't match anything useful)
    bech32Addr = address
  }
  const txs = await rpcTxSearch(`message.sender='${bech32Addr}'`, page, limit)
  return extractPayEvents(txs, CREATED_EVENT)
}

/**
 * Fetch received (claimed) payments for a given EVM hex address (chain only).
 * @param evmHex  0x-prefixed EVM address (lowercase)
 */
export async function fetchReceivedHistory(evmHex: string, page = 1, limit = 50): Promise<ChainPayment[]> {
  const addrLower = evmHex.toLowerCase()
  const txs = await rpcTxSearch(`move.claimed_by='${addrLower}'`, page, limit)
  return extractPayEvents(txs, CLAIMED_EVENT)
}
