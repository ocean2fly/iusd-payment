/**
 * BCS encoding helpers for MsgExecute args.
 *
 * MsgExecute.args is `repeated bytes` in protobuf; each element must be a
 * Uint8Array containing the BCS-serialised Move value (NOT a hex string).
 */

/** Decode a hex string (with or without 0x prefix) to Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  const padded = clean.length % 2 === 0 ? clean : '0' + clean
  const bytes = new Uint8Array(padded.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/** BCS-encode a Move `address` (32 raw bytes, no length prefix). */
export function bcsAddress(hexAddr: string): Uint8Array {
  return hexToBytes(hexAddr.replace(/^0x/, '').padStart(64, '0'))
}

/** ULEB128-encode a non-negative integer. */
export function uleb128(value: number): number[] {
  const out: number[] = []
  let v = value
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    out.push(b)
  } while (v !== 0)
  return out
}

/** BCS-encode a Move `vector<u8>` (ULEB128 length prefix + raw bytes). */
export function bcsVecU8(bytes: Uint8Array): Uint8Array {
  const lenBytes = uleb128(bytes.length)
  const result = new Uint8Array(lenBytes.length + bytes.length)
  result.set(lenBytes)
  result.set(bytes, lenBytes.length)
  return result
}

/** BCS-encode a hex-string payload as Move `vector<u8>`. */
export function bcsVecFromHex(hex: string): Uint8Array {
  return bcsVecU8(hexToBytes(hex))
}

/** BCS-encode a Move `u8` (single byte). */
export function bcsU8(n: number): Uint8Array {
  return new Uint8Array([n & 0xff])
}

/** BCS-encode a Move `u64` (little-endian 8 bytes). */
export function bcsU64(n: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number((n >> BigInt(i * 8)) & 0xffn)
  }
  return bytes
}
