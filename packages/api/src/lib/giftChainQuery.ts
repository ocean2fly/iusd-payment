/**
 * Gift V3 chain query helpers — REST-based view function calls.
 */

import { getGiftPoolAddress, getModuleAddress } from '../shared/contract-config'
import { REST_URL } from '../shared/config'

// ── BCS encoding helpers ──────────────────────────────────────────

function encodeAddress(addr: string): string {
  let hex = addr.toLowerCase().replace(/^0x/, '')
  hex = hex.padStart(64, '0')
  return Buffer.from(hex, 'hex').toString('base64')
}

function encodeU64(num: number): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(num))
  return buf.toString('base64')
}

function encodeVecU8(hexOrBuf: string | Buffer): string {
  const bytes = typeof hexOrBuf === 'string'
    ? Buffer.from(hexOrBuf.replace(/^0x/, ''), 'hex')
    : hexOrBuf
  // BCS vector: ULEB128 length prefix + raw bytes
  const lenBuf = uleb128(bytes.length)
  return Buffer.concat([lenBuf, bytes]).toString('base64')
}

function uleb128(value: number): Buffer {
  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value >>= 7
    if (value > 0) byte |= 0x80
    bytes.push(byte)
  } while (value > 0)
  return Buffer.from(bytes)
}

// ── View function query ───────────────────────────────────────────

async function queryGiftView(functionName: string, args: string[] = []): Promise<any> {
  const moduleAddr = getModuleAddress()
  const url = `${REST_URL}/initia/move/v1/accounts/${moduleAddr}/modules/gift_v3/view_functions/${functionName}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type_args: [], args }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`gift_v3::${functionName} failed: ${res.status} ${text}`)
  }

  const json = await res.json() as any
  const data = json?.data
  if (data == null) return null
  return typeof data === 'string' ? JSON.parse(data) : data
}

// ── Public query functions ────────────────────────────────────────

export interface BoxDef {
  box_id: number
  name: string
  amount: number
  fee_bps: number
  urls: string[]
  enabled: boolean
}

export async function fetchBoxIds(): Promise<number[]> {
  const pool = getGiftPoolAddress()
  const data = await queryGiftView('get_box_ids', [encodeAddress(pool)])
  return (data || []).map(Number)
}

export async function fetchBox(boxId: number): Promise<BoxDef> {
  const pool = getGiftPoolAddress()
  const data = await queryGiftView('get_box', [encodeAddress(pool), encodeU64(boxId)])
  // Returns tuple: (box_id, name, amount, fee_bps, urls, enabled)
  return {
    box_id: Number(data[0]),
    name: data[1],
    amount: Number(data[2]),
    fee_bps: Number(data[3]),
    urls: data[4],
    enabled: data[5],
  }
}

export async function fetchAllBoxes(): Promise<BoxDef[]> {
  const ids = await fetchBoxIds()
  const boxes: BoxDef[] = []
  for (const id of ids) {
    try {
      boxes.push(await fetchBox(id))
    } catch {}
  }
  return boxes
}

export async function fetchEnabledBoxes(): Promise<BoxDef[]> {
  const all = await fetchAllBoxes()
  return all.filter(b => b.enabled)
}

export interface PacketOverview {
  packet_id: string
  box_id: number
  sender: string
  mode: number
  /** ECIES recipient blob (hex) for Direct mode; empty for Group mode. */
  recipient_blob: string
  amount: number
  total_slots: number
  claimed_slots: number
  fee: number
  status: number
  created_at: number
  expires_at: number
}

function normalizeBytesField(v: any): string {
  // Move REST returns vector<u8> as either "0x..." hex string or array of numbers.
  if (typeof v === 'string') return v.replace(/^0x/i, '').toLowerCase()
  if (Array.isArray(v)) return Buffer.from(v).toString('hex')
  return ''
}

export async function fetchPacket(packetIdHex: string): Promise<PacketOverview> {
  const pool = getGiftPoolAddress()
  const data = await queryGiftView('get_packet', [
    encodeAddress(pool),
    encodeVecU8(packetIdHex),
  ])
  return {
    packet_id: data[0],
    box_id: Number(data[1]),
    sender: data[2],
    mode: Number(data[3]),
    recipient_blob: normalizeBytesField(data[4]),
    amount: Number(data[5]),
    total_slots: Number(data[6]),
    claimed_slots: Number(data[7]),
    fee: Number(data[8]),
    status: Number(data[9]),
    created_at: Number(data[10]),
    expires_at: Number(data[11]),
  }
}

/**
 * Fetch the recipient blob + claim_key_hash for a Direct-mode packet.
 * Both fields are empty for Group-mode packets.
 */
export async function fetchRecipientBlob(packetIdHex: string): Promise<{
  blobHex: string
  claimKeyHashHex: string
}> {
  const pool = getGiftPoolAddress()
  const data = await queryGiftView('get_recipient_blob', [
    encodeAddress(pool),
    encodeVecU8(packetIdHex),
  ])
  return {
    blobHex: normalizeBytesField(data[0]),
    claimKeyHashHex: normalizeBytesField(data[1]),
  }
}

export interface SlotsSummary {
  statuses: number[]
  claimers: string[]
  amounts: number[]
}

export async function fetchSlotsSummary(packetIdHex: string): Promise<SlotsSummary> {
  const pool = getGiftPoolAddress()
  const data = await queryGiftView('get_slots_summary', [
    encodeAddress(pool),
    encodeVecU8(packetIdHex),
  ])

  if (Array.isArray(data)) {
    return {
      statuses: (Array.isArray(data[0]) ? data[0] : []).map(Number),
      claimers: Array.isArray(data[1]) ? data[1] : [],
      amounts: (Array.isArray(data[2]) ? data[2] : []).map(Number),
    }
  }

  const obj = (data && typeof data === 'object') ? data as Record<string, any> : {}
  return {
    statuses: (Array.isArray(obj.statuses) ? obj.statuses : []).map(Number),
    claimers: Array.isArray(obj.claimers) ? obj.claimers : [],
    amounts: (Array.isArray(obj.amounts) ? obj.amounts : []).map(Number),
  }
}

export interface PoolStats {
  owner: string
  treasury: string
  cap: number
  total_gifts: number
  total_volume: number
  total_fees: number
}

export async function fetchPoolStats(): Promise<PoolStats> {
  const pool = getGiftPoolAddress()
  const data = await queryGiftView('get_pool_stats', [encodeAddress(pool)])
  return {
    owner: data[0],
    treasury: data[1],
    cap: Number(data[2]),
    total_gifts: Number(data[3]),
    total_volume: Number(data[4]),
    total_fees: Number(data[5]),
  }
}

export async function isBoxListed(boxId: number): Promise<boolean> {
  const pool = getGiftPoolAddress()
  return await queryGiftView('is_box_listed', [encodeAddress(pool), encodeU64(boxId)])
}
