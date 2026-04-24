/**
 * Initia Usernames resolution
 * Network-aware: uses correct module address based on CHAIN_ID
 */
import { REST_URL, CHAIN_ID } from '../shared/config'

const USERNAMES_MODULE = process.env.USERNAMES_MODULE ?? ''

// BCS encode string: length prefix (varint) + utf8 bytes
function bcsEncodeString(s: string): string {
  const bytes = Buffer.from(s, 'utf8')
  const len = bytes.length
  // Simple varint for lengths < 128
  const encoded = Buffer.concat([Buffer.from([len]), bytes])
  return encoded.toString('base64')
}

// BCS encode address: 32 bytes, left-padded with zeros
function bcsEncodeAddress(addr: string): string {
  // Remove 0x prefix if present, convert init1... to hex if needed
  let hex = addr.toLowerCase()
  if (hex.startsWith('init1')) {
    // Bech32 decode - use the raw bytes
    const { bech32 } = require('bech32')
    const decoded = bech32.decode(hex)
    const bytes = bech32.fromWords(decoded.words)
    hex = Buffer.from(bytes).toString('hex')
  } else if (hex.startsWith('0x')) {
    hex = hex.slice(2)
  }
  // Pad to 32 bytes (64 hex chars)
  const padded = hex.padStart(64, '0')
  return Buffer.from(padded, 'hex').toString('base64')
}

export async function resolveUsername(name: string): Promise<string | null> {
  // Strip .init suffix if present
  const cleanName = name.replace(/\.init$/i, '')
  
  try {
    const res = await fetch(`${REST_URL}/initia/move/v1/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: USERNAMES_MODULE,
        module_name: 'usernames',
        function_name: 'get_address_from_name',
        type_args: [],
        args: [bcsEncodeString(cleanName)]
      })
    })
    const json = await res.json()
    if (json.data && json.data !== 'null') {
      // Response is like "\"0x...\""
      return JSON.parse(json.data)
    }
    return null
  } catch (e) {
    console.error('resolveUsername error:', e)
    return null
  }
}

export async function reverseUsername(address: string): Promise<string | null> {
  try {
    const res = await fetch(`${REST_URL}/initia/move/v1/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: USERNAMES_MODULE,
        module_name: 'usernames',
        function_name: 'get_name_from_address',
        type_args: [],
        args: [bcsEncodeAddress(address)]
      })
    })
    const json = await res.json()
    if (json.data && json.data !== 'null') {
      // Response is like "\"username\""
      return JSON.parse(json.data)
    }
    return null
  } catch (e) {
    console.error('reverseUsername error:', e)
    return null
  }
}
