/**
 * BCS encoding utilities and MsgExecute builders for gift_v3 admin operations.
 *
 * Args are Uint8Array[] — the wallet/signing kit handles serialisation to protobuf.
 */

// ── BCS Encoding Primitives ─────────────────────────────────────

/** Concatenate multiple Uint8Arrays into one. */
export function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

/** ULEB128-encode a non-negative integer. */
export function uleb128Encode(value: number): Uint8Array {
  const bytes: number[] = []
  let v = value
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    bytes.push(b)
  } while (v !== 0)
  return new Uint8Array(bytes)
}

/** BCS-encode a Move `u64` as 8 little-endian bytes. */
export function bcsEncodeU64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number((value >> BigInt(i * 8)) & 0xffn)
  }
  return bytes
}

/** Decode a hex string (with or without 0x prefix) to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '')
  const padded = clean.length % 2 === 0 ? clean : '0' + clean
  const bytes = new Uint8Array(padded.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ── Minimal bech32 decoder (for init1... addresses) ─────────────

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i]
    }
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

function bech32Decode(str: string): { hrp: string; data: number[] } {
  const lower = str.toLowerCase()
  const sepIdx = lower.lastIndexOf('1')
  if (sepIdx < 1) throw new Error('Invalid bech32: no separator')
  const hrp = lower.slice(0, sepIdx)
  const dataChars = lower.slice(sepIdx + 1)
  const data: number[] = []
  for (const c of dataChars) {
    const idx = BECH32_CHARSET.indexOf(c)
    if (idx === -1) throw new Error(`Invalid bech32 character: ${c}`)
    data.push(idx)
  }
  const checkData = [...bech32HrpExpand(hrp), ...data]
  if (bech32Polymod(checkData) !== 1) throw new Error('Invalid bech32 checksum')
  return { hrp, data: data.slice(0, data.length - 6) }
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0
  let bits = 0
  const result: number[] = []
  const maxv = (1 << toBits) - 1
  for (const v of data) {
    acc = (acc << fromBits) | v
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push((acc >> bits) & maxv)
    }
  }
  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv)
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error('Invalid bit conversion')
  }
  return result
}

/**
 * BCS-encode a Move `address` (32 raw bytes, no length prefix).
 * Accepts either 0x-prefixed hex or init1... bech32.
 */
export function bcsEncodeAddress(addr: string): Uint8Array {
  if (addr.startsWith('0x') || addr.startsWith('0X')) {
    return hexToBytes(addr.replace(/^0x/i, '').padStart(64, '0'))
  }
  if (addr.startsWith('init1')) {
    const { data } = bech32Decode(addr)
    const bytes = convertBits(data, 5, 8, false)
    const raw = new Uint8Array(bytes)
    // Pad to 32 bytes (Move address size)
    if (raw.length === 32) return raw
    const padded = new Uint8Array(32)
    padded.set(raw, 32 - raw.length)
    return padded
  }
  // Fallback: treat as raw hex
  return hexToBytes(addr.padStart(64, '0'))
}

/** BCS-encode a Move `bool` (single byte: 0 or 1). */
export function bcsEncodeBool(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0])
}

/** BCS-encode a Move `String` (ULEB128 length prefix + UTF-8 bytes). */
export function bcsEncodeString(str: string): Uint8Array {
  const utf8 = new TextEncoder().encode(str)
  return concat(uleb128Encode(utf8.length), utf8)
}

/** BCS-encode a Move `vector<String>`. */
export function bcsEncodeVecString(strs: string[]): Uint8Array {
  const parts = strs.map(bcsEncodeString)
  return concat(uleb128Encode(strs.length), ...parts)
}

// ── MsgExecute Types ────────────────────────────────────────────

export interface GiftTxMsg {
  typeUrl: '/initia.move.v1.MsgExecute'
  value: {
    sender: string
    moduleAddress: string
    moduleName: string
    functionName: string
    typeArgs: string[]
    args: Uint8Array[]
  }
}

// ── Internal helper ─────────────────────────────────────────────

function buildGiftMsg(
  sender: string,
  moduleAddr: string,
  functionName: string,
  args: Uint8Array[],
): GiftTxMsg {
  return {
    typeUrl: '/initia.move.v1.MsgExecute',
    value: {
      sender,
      moduleAddress: moduleAddr,
      moduleName: 'gift_v3',
      functionName,
      typeArgs: [],
      args,
    },
  }
}

// ── Admin TX Builders ───────────────────────────────────────────

/**
 * register_box(admin, pool, box_id, name, amount, fee_bps, urls, enabled)
 * On-chain: name and urls are empty — metadata stored off-chain in DB.
 */
export function buildRegisterBox(
  sender: string,
  moduleAddr: string,
  giftPool: string,
  boxId: bigint,
  amount: bigint,
  feeBps: bigint,
  enabled: boolean,
): GiftTxMsg {
  return buildGiftMsg(sender, moduleAddr, 'register_box', [
    bcsEncodeAddress(giftPool),
    bcsEncodeU64(boxId),
    bcsEncodeString(''),          // name: empty (stored off-chain)
    bcsEncodeU64(amount),
    bcsEncodeU64(feeBps),
    bcsEncodeVecString([]),       // urls: empty (stored off-chain)
    bcsEncodeBool(enabled),
  ])
}

/**
 * update_box(admin, pool, box_id, name, amount, fee_bps, urls, enabled)
 * On-chain: name and urls are empty — metadata stored off-chain in DB.
 */
export function buildUpdateBox(
  sender: string,
  moduleAddr: string,
  giftPool: string,
  boxId: bigint,
  amount: bigint,
  feeBps: bigint,
  enabled: boolean,
): GiftTxMsg {
  return buildGiftMsg(sender, moduleAddr, 'update_box', [
    bcsEncodeAddress(giftPool),
    bcsEncodeU64(boxId),
    bcsEncodeString(''),          // name: empty (stored off-chain)
    bcsEncodeU64(amount),
    bcsEncodeU64(feeBps),
    bcsEncodeVecString([]),       // urls: empty (stored off-chain)
    bcsEncodeBool(enabled),
  ])
}

/**
 * remove_box(admin, pool, box_id)
 */
export function buildRemoveBox(
  sender: string,
  moduleAddr: string,
  giftPool: string,
  boxId: bigint,
): GiftTxMsg {
  return buildGiftMsg(sender, moduleAddr, 'remove_box', [
    bcsEncodeAddress(giftPool),
    bcsEncodeU64(boxId),
  ])
}

/**
 * list_box(admin, pool, box_id)
 */
export function buildListBox(
  sender: string,
  moduleAddr: string,
  giftPool: string,
  boxId: bigint,
): GiftTxMsg {
  return buildGiftMsg(sender, moduleAddr, 'list_box', [
    bcsEncodeAddress(giftPool),
    bcsEncodeU64(boxId),
  ])
}

/**
 * delist_box(admin, pool, box_id)
 */
export function buildDelistBox(
  sender: string,
  moduleAddr: string,
  giftPool: string,
  boxId: bigint,
): GiftTxMsg {
  return buildGiftMsg(sender, moduleAddr, 'delist_box', [
    bcsEncodeAddress(giftPool),
    bcsEncodeU64(boxId),
  ])
}
