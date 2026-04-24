/**
 * Query payment status directly from chain (browser-side).
 * Used to verify DB cache is up to date.
 */

const REST_URL = import.meta.env.VITE_REST_URL || 'https://rest.initia.xyz'
const MODULE_ADDRESS = import.meta.env.VITE_MODULE_ADDRESS || ''
const POOL_ADDRESS = import.meta.env.VITE_IPAY_POOL_ADDRESS || ''

const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://api.iusd-pay.xyz/v1'

// Chain status codes from pay_v3 contract
export const CHAIN_STATUS = {
  PENDING_CLAIM: 2,
  CONFIRMED: 3,
  REVOKED: 5,
  REFUNDED: 6,
  EXPIRED: 7,
} as const

export const CHAIN_STATUS_LABEL: Record<number, string> = {
  2: 'pending',
  3: 'paid',
  5: 'revoked',
  6: 'refunded',
  7: 'expired',
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '')
  const b = new Uint8Array(h.length / 2)
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return b
}

function uleb128(n: number): Uint8Array {
  const bytes: number[] = []
  do { let b = n & 0x7f; n >>= 7; if (n > 0) b |= 0x80; bytes.push(b) } while (n > 0)
  return new Uint8Array(bytes)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** sha256(hex plain) → hex hash. Chain-side pay_v3 key is sha256(plainPaymentId). */
async function hashPaymentIdHex(plainHex: string): Promise<string> {
  const plainBuf = hexToBytes(plainHex.replace(/^0x/i, ''))
  const hashBuf = await crypto.subtle.digest('SHA-256', plainBuf as any)
  const bytes = new Uint8Array(hashBuf)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Full chain-side view of a pay_v3 payment. Shape matches the tuple
 * returned by `get_payment_full`:
 *   (status, amount, fee, sender, claimed_by, created_at, expires_at,
 *    ciphertext, key_for_sender, key_for_recipient, claim_key_hash)
 */
export interface ChainPaymentFull {
  status: number
  amount: string       // stringified u64 micro
  fee: string          // stringified u64 micro
  sender: string       // 0x hex (32 bytes)
  claimedBy: string    // 0x hex (32 bytes, may be @0x0 when unclaimed)
  createdAt: number    // unix seconds
  expiresAt: number    // unix seconds
  // Ciphertext fields dropped — not needed for display hydration.
}

/** Low-level: query pay_v3::get_payment_full by raw hex key (no hashing). */
export async function queryPaymentFullByRawKey(rawHexKey: string): Promise<ChainPaymentFull | null> {
  try {
    if (!MODULE_ADDRESS || !POOL_ADDRESS) return null
    const pool = POOL_ADDRESS.replace(/^0x/i, '').toLowerCase().padStart(64, '0')

    const poolB64 = toBase64(hexToBytes(pool))
    const pidBytes = hexToBytes(rawHexKey.replace(/^0x/i, ''))
    const pidLen = uleb128(pidBytes.length)
    const pidBcs = new Uint8Array(pidLen.length + pidBytes.length)
    pidBcs.set(pidLen)
    pidBcs.set(pidBytes, pidLen.length)
    const pidB64 = toBase64(pidBcs)

    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/pay_v3/view_functions/get_payment_full`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [poolB64, pidB64] }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: string }
    if (!json.data) return null
    const parsed = JSON.parse(json.data)
    if (!Array.isArray(parsed) || parsed.length < 7) return null
    const status = Number(parsed[0])
    const amount = String(parsed[1] ?? '0')
    // Contract returns (0, 0, 0, @0x0, @0x0, 0, 0, ...) when the key is not
    // present. Signal "not found" so the caller can fall back.
    if (status === 0 && amount === '0') return null
    return {
      status,
      amount,
      fee: String(parsed[2] ?? '0'),
      sender: String(parsed[3] ?? ''),
      claimedBy: String(parsed[4] ?? ''),
      createdAt: Number(parsed[5] ?? 0),
      expiresAt: Number(parsed[6] ?? 0),
    }
  } catch {
    return null
  }
}

/**
 * Fetch the full pay_v3 payment struct from chain.
 *
 * Resilient to the pay hash rollout: current code (orderBuilder.ts
 * after commit 1b9bf10) sends deposit TXs using sha256(plain) as the
 * contract-side payment_id, but payments created by the pre-hash
 * frontend still live on chain keyed by the plain id. This helper
 * tries the hash first, then falls back to plain — covering both the
 * pre-hash legacy entries and the post-hash new ones.
 *
 * Used by History.tsx as a fallback when the backend hydration returns
 * amountMicro=0 (DB gap, version skew, etc).
 */
export async function fetchPaymentFullFromChain(paymentId: string): Promise<ChainPaymentFull | null> {
  const plainHex = paymentId.replace(/^0x/i, '')
  // Primary: hash(plain) — what the post-hash frontend uses as chain key.
  const hashed = await hashPaymentIdHex(plainHex)
  const hit = await queryPaymentFullByRawKey(hashed)
  if (hit) return hit
  // Fallback: plain key — for entries deposited by the pre-hash frontend.
  return await queryPaymentFullByRawKey(plainHex)
}

/**
 * Fetch payment status directly from chain via REST API.
 * Returns numeric status code or null on error.
 */
export async function fetchPaymentChainStatus(paymentId: string): Promise<number | null> {
  try {
    const pool = POOL_ADDRESS.replace(/^0x/i, '').toLowerCase().padStart(64, '0')
    // Chain-side key is sha256(plain) — hash before querying.
    const pid = await hashPaymentIdHex(paymentId)

    const poolB64 = toBase64(hexToBytes(pool))
    const pidBytes = hexToBytes(pid)
    const pidLen = uleb128(pidBytes.length)
    const pidBcs = new Uint8Array(pidLen.length + pidBytes.length)
    pidBcs.set(pidLen)
    pidBcs.set(pidBytes, pidLen.length)
    const pidB64 = toBase64(pidBcs)

    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/pay_v3/view_functions/get_payment_full`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [poolB64, pidB64] }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: string }
    if (!json.data) return null
    const parsed = JSON.parse(json.data)
    return Number(parsed[0])
  } catch {
    return null
  }
}

/**
 * Tell the server to sync a payment's chain status to DB cache.
 * Fire-and-forget — no need to wait for response.
 */
export function triggerServerSync(paymentId: string): void {
  fetch(`${API_BASE}/payment/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId }),
  }).catch(() => {})
}
