/**
 * Gift V3 — Build MsgExecute for gift_v3 contract functions.
 * Frontend TX builder + client-side claim secret derivation.
 */

const MODULE_ADDRESS = import.meta.env.VITE_MODULE_ADDRESS || ''
const GIFT_POOL = import.meta.env.VITE_GIFT_POOL_ADDRESS || ''
const REST_URL = import.meta.env.VITE_REST_URL || 'https://rest.initia.xyz'

// ── Chain-side gift packet view (frontend fallback) ─────────────
//
// History / Gift pages rely on the backend /v1/activity to hydrate
// gift packet amount + status. When that hydration is missing (new
// packets that the backend hasn't synced yet, version skew, etc.)
// the UI falls back to this helper and queries gift_v3::get_packet
// directly from the chain REST gateway.
//
// Note: gift_v3 packet_id is currently NOT hashed on-chain (unlike
// pay_v3). If that ever changes, hash here too.

export interface ChainGiftPacket {
  packetId: string       // 0x hex
  boxId: number
  sender: string         // 0x hex (32 bytes)
  mode: number           // 0 = direct, 1 = group
  recipientBlob: string  // hex (opaque ECIES)
  amount: string         // stringified u64 micro
  totalSlots: number
  claimedSlots: number
  fee: string
  status: number         // 0 pending, 1 active, 2 completed, 3 expired
  createdAt: number
  expiresAt: number
}

export async function fetchGiftPacketFromChain(packetIdHex: string): Promise<ChainGiftPacket | null> {
  try {
    if (!MODULE_ADDRESS || !GIFT_POOL) return null
    // BCS encode: Object<GiftPoolV3> = 32-byte address
    const poolClean = GIFT_POOL.replace(/^0x/i, '').toLowerCase().padStart(64, '0')
    const poolBytes = hexToBytes(poolClean)
    // vector<u8>: ULEB128(len) + bytes
    const pidBytes = hexToBytes(packetIdHex.replace(/^0x/i, ''))
    const pidBcs = concat(uleb128(pidBytes.length), pidBytes)

    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/gift_v3/view_functions/get_packet`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type_args: [],
        args: [bytesToBase64(poolBytes), bytesToBase64(pidBcs)],
      }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: string }
    if (!json.data) return null
    const parsed = JSON.parse(json.data)
    if (!Array.isArray(parsed) || parsed.length < 12) return null
    const rawBlob = parsed[4]
    const blobHex = typeof rawBlob === 'string'
      ? rawBlob.replace(/^0x/i, '').toLowerCase()
      : Array.isArray(rawBlob) ? Array.from(rawBlob).map((b: any) => Number(b).toString(16).padStart(2, '0')).join('') : ''
    return {
      packetId: String(parsed[0] ?? ''),
      boxId: Number(parsed[1] ?? 0),
      sender: String(parsed[2] ?? ''),
      mode: Number(parsed[3] ?? 0),
      recipientBlob: blobHex,
      amount: String(parsed[5] ?? '0'),
      totalSlots: Number(parsed[6] ?? 0),
      claimedSlots: Number(parsed[7] ?? 0),
      fee: String(parsed[8] ?? '0'),
      status: Number(parsed[9] ?? 0),
      createdAt: Number(parsed[10] ?? 0),
      expiresAt: Number(parsed[11] ?? 0),
    }
  } catch {
    return null
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// ── BCS helpers ──────────────────────────────────────────────────

function bcsU64(n: number | bigint): Uint8Array {
  const buf = new DataView(new ArrayBuffer(8))
  const big = BigInt(n)
  buf.setUint32(0, Number(big & 0xffffffffn), true)
  buf.setUint32(4, Number((big >> 32n) & 0xffffffffn), true)
  return new Uint8Array(buf.buffer)
}

function bcsAddress(addr: string): Uint8Array {
  if (addr.startsWith('init1')) {
    // bech32 → decode to raw bytes → pad to 32 bytes
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    const data = addr.slice(5) // remove 'init1'
    const values = Array.from(data).map(c => CHARSET.indexOf(c))
    const words = values.slice(0, -6) // remove checksum
    // Convert 5-bit groups back to 8-bit bytes
    const bytes: number[] = []
    let bits = 0, value = 0
    for (const w of words) {
      value = (value << 5) | w; bits += 5
      while (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff) }
    }
    const raw = new Uint8Array(bytes)
    const padded = new Uint8Array(32)
    padded.set(raw, 32 - raw.length)
    return padded
  }
  return hexToBytes(addr.replace(/^0x/i, '').padStart(64, '0'))
}

function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2)
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return b
}

function uleb128(n: number): Uint8Array {
  const bytes: number[] = []
  do { let b = n & 0x7f; n >>= 7; if (n > 0) b |= 0x80; bytes.push(b) } while (n > 0)
  return new Uint8Array(bytes)
}

function bcsVecU8(hex: string): Uint8Array {
  const bytes = hexToBytes(hex.replace(/^0x/i, ''))
  return concat(uleb128(bytes.length), bytes)
}

function bcsVec<T>(items: T[], encode: (t: T) => Uint8Array): Uint8Array {
  const parts = items.map(encode)
  const total = parts.reduce((a, b) => a + b.length, 0)
  const len = uleb128(items.length)
  const result = new Uint8Array(len.length + total)
  result.set(len)
  let offset = len.length
  for (const p of parts) { result.set(p, offset); offset += p.length }
  return result
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((a, b) => a + b.length, 0)
  const r = new Uint8Array(total)
  let off = 0
  for (const a of arrs) { r.set(a, off); off += a.length }
  return r
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── SHA-256 (Web Crypto) ─────────────────────────────────────────

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data))
  return new Uint8Array(hash)
}

function leU64Bytes(n: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(8))
  buf.setBigUint64(0, BigInt(n), true)
  return new Uint8Array(buf.buffer)
}

// ── Claim Secret Derivation (client-side) ────────────────────────

/**
 * Derive slot_secret, slot_hash, and proof for a group gift claim.
 * Used when claiming via claim link: ?p=<packetId>&k=<claimKey>&s=<slotIndex>
 */
export async function generateClaimSecrets(
  claimKeyHex: string,
  slotIndex: number,
  claimerAddress: string,
): Promise<{ slotSecret: string; slotHash: string; proof: string }> {
  const claimKey = hexToBytes(claimKeyHex)
  const slotIdxBytes = leU64Bytes(slotIndex)

  // slot_secret = SHA256(claim_key || LE(slot_index))
  const slotSecret = await sha256(concat(claimKey, slotIdxBytes))

  // slot_hash = SHA256(slot_secret)
  const slotHash = await sha256(slotSecret)

  // proof = SHA256(slot_secret || BCS(claimer_address))
  const addrBytes = bcsAddress(claimerAddress)
  const proof = await sha256(concat(slotSecret, addrBytes))

  return {
    slotSecret: bytesToHex(slotSecret),
    slotHash: bytesToHex(slotHash),
    proof: bytesToHex(proof),
  }
}

// ── TX Builders ──────────────────────────────────────────────────

function buildMsg(senderAddress: string, functionName: string, args: Uint8Array[]) {
  return [{
    typeUrl: '/initia.move.v1.MsgExecute',
    value: {
      sender: senderAddress,
      moduleAddress: MODULE_ADDRESS,
      moduleName: 'gift_v3',
      functionName,
      typeArgs: [],
      args,
    },
  }]
}

/**
 * Build send_gift TX (direct mode).
 *
 * The contract no longer takes a plaintext recipient address. Instead it
 * takes:
 *   - recipientBlob:  ECIES double-envelope ciphertext (computed by the
 *                     API server and returned in /gift/send txParams)
 *   - claimKeyHash:   sha2_256 of the bearer claim_key embedded in the blob
 */
export function buildSendGiftTx(
  senderAddress: string,
  params: {
    pool?: string
    boxId: number
    packetId: string        // hex
    recipientBlob: string   // hex (opaque ECIES blob)
    claimKeyHash: string    // hex (32 bytes)
    amount: number          // micro iUSD
    ttl: number             // seconds (0 = max)
  },
) {
  const pool = params.pool || GIFT_POOL
  return buildMsg(senderAddress, 'send_gift', [
    bcsAddress(pool),
    bcsU64(params.boxId),
    bcsVecU8(params.packetId),
    bcsVecU8(params.recipientBlob),
    bcsVecU8(params.claimKeyHash),
    bcsU64(params.amount),
    bcsU64(params.ttl),
  ])
}

/** Build send_gift_group TX (group red envelope) */
export function buildSendGiftGroupTx(
  senderAddress: string,
  params: {
    pool?: string
    boxId: number
    packetId: string          // hex
    numSlots: number
    amount: number            // micro iUSD
    allocationSeed: string    // hex (32 bytes)
    slotHashes: string[]      // hex[] (32 bytes each)
    ttl: number
  },
) {
  const pool = params.pool || GIFT_POOL
  return buildMsg(senderAddress, 'send_gift_group', [
    bcsAddress(pool),
    bcsU64(params.boxId),
    bcsVecU8(params.packetId),
    bcsU64(params.numSlots),
    bcsU64(params.amount),
    bcsVecU8(params.allocationSeed),
    bcsVec(params.slotHashes, h => bcsVecU8(h)),
    bcsU64(params.ttl),
  ])
}

/** Build send_gift_group_equal TX (equal split, no allocation seed) */
export function buildSendGiftGroupEqualTx(
  senderAddress: string,
  params: {
    pool?: string
    boxId: number
    packetId: string          // hex
    numSlots: number
    amount: number            // micro iUSD
    slotHashes: string[]      // hex[] (32 bytes each)
    ttl: number
  },
) {
  const pool = params.pool || GIFT_POOL
  return buildMsg(senderAddress, 'send_gift_group_equal', [
    bcsAddress(pool),
    bcsU64(params.boxId),
    bcsVecU8(params.packetId),
    bcsU64(params.numSlots),
    bcsU64(params.amount),
    bcsVec(params.slotHashes, h => bcsVecU8(h)),
    bcsU64(params.ttl),
  ])
}

/** Build claim_direct TX (self-claim when user has gas) */
export function buildClaimDirectTx(
  claimerAddress: string,
  params: { pool?: string; packetId: string; claimKey: string /* hex */ },
) {
  const pool = params.pool || GIFT_POOL
  return buildMsg(claimerAddress, 'claim_direct', [
    bcsAddress(pool),
    bcsVecU8(params.packetId),
    bcsVecU8(params.claimKey),
  ])
}

/** Build claim_slot TX (self-claim when user has gas) */
export function buildClaimSlotTx(
  claimerAddress: string,
  params: {
    pool?: string
    packetId: string
    slotIndex: number
    slotSecret: string  // hex
    proof: string       // hex
  },
) {
  const pool = params.pool || GIFT_POOL
  return buildMsg(claimerAddress, 'claim_slot', [
    bcsAddress(pool),
    bcsVecU8(params.packetId),
    bcsU64(params.slotIndex),
    bcsVecU8(params.slotSecret),
    bcsVecU8(params.proof),
  ])
}
