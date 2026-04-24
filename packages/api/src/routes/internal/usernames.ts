/**
 * Usernames Routes (INS Name Resolution)
 * 
 * Resolves .init usernames to addresses via Initia Name Service.
 * Uses view functions:
 *   - get_address_from_name(String) -> Option<address>
 *   - get_name_from_address(address) -> Option<String>
 */

import { FastifyInstance } from 'fastify'
import { REST_URL, INS_CONTRACT_ADDRESS } from '../public/config'
import { bech32 } from 'bech32'

// Cache for resolved names (5 min TTL)
const nameCache = new Map<string, { address: string | null; expires: number }>()
const CACHE_TTL = 5 * 60 * 1000

/**
 * BCS encode a Move String (ULEB128 length + UTF-8 bytes)
 */
function bcsString(str: string): string {
  const bytes = Buffer.from(str, 'utf-8')
  const len = bytes.length
  const lenBytes: number[] = []
  let v = len
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    lenBytes.push(b)
  } while (v !== 0)
  
  const result = Buffer.concat([Buffer.from(lenBytes), bytes])
  return result.toString('base64')
}

/**
 * BCS encode an address (32 bytes, left-padded)
 */
function bcsAddress(addr: string): string {
  let hex = addr.toLowerCase()
  
  // Convert bech32 to hex if needed
  if (hex.startsWith('init1')) {
    const decoded = bech32.decode(hex)
    const addrBytes = Buffer.from(bech32.fromWords(decoded.words))
    hex = '0x' + addrBytes.toString('hex')
  }
  
  hex = hex.replace('0x', '').padStart(64, '0')
  return Buffer.from(hex, 'hex').toString('base64')
}

/**
 * Convert hex address to bech32
 */
function hexToBech32(hex: string): string {
  const cleanHex = hex.replace('0x', '').toLowerCase()
  const bytes = Buffer.from(cleanHex, 'hex')
  const words = bech32.toWords(bytes)
  return bech32.encode('init', words)
}

/**
 * Call INS view function
 */
async function callInsViewFunction(
  fnName: string, 
  args: string[]
): Promise<any> {
  const url = `${REST_URL}/initia/move/v1/accounts/${INS_CONTRACT_ADDRESS}/modules/usernames/view_functions/${fnName}`
  
  console.log(`[INS] Calling ${fnName} with args:`, args)
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type_args: [],
      args
    })
  })
  
  if (!res.ok) {
    const text = await res.text()
    console.error(`[INS] ${fnName} failed:`, text)
    return null
  }
  
  const json = await res.json()
  console.log(`[INS] ${fnName} response:`, json)
  
  // Parse the result - it's a JSON string in data field
  if (json.data) {
    try {
      return JSON.parse(json.data)
    } catch {
      return json.data
    }
  }
  
  return null
}

/**
 * Resolve username.init to address
 */
async function resolveUsername(name: string): Promise<string | null> {
  const normalName = name.toLowerCase().replace(/\.init$/, '')
  const cacheKey = normalName
  
  // Check cache
  const cached = nameCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return cached.address
  }
  
  try {
    // Call get_address_from_name(String)
    const result = await callInsViewFunction('get_address_from_name', [bcsString(normalName)])
    
    // Result is either a hex string "0x..." or null
    let address: string | null = null
    if (result && result !== 'null' && typeof result === 'string' && result.startsWith('0x')) {
      address = hexToBech32(result)
    }
    
    console.log('[INS] resolveUsername:', normalName, '→', address)
    nameCache.set(cacheKey, { address, expires: Date.now() + CACHE_TTL })
    return address
  } catch (e) {
    console.error('[INS] resolveUsername error:', e)
    return null
  }
}

// reverseResolve() was removed along with /usernames/reverse/:address —
// privacy invariant: no server endpoint should take an init1 address as a
// lookup key for identity metadata.

export async function usernamesRoutes(app: FastifyInstance) {
  // GET /usernames/resolve/:name - Resolve username to address
  app.get('/usernames/resolve/:name', async (request, reply) => {
    const { name } = request.params as { name: string }
    const address = await resolveUsername(name)
    
    if (!address) {
      return reply.status(404).send({ error: 'NAME_NOT_FOUND' })
    }
    
    return { name, address }
  })

  // Reverse-resolve endpoints (`/usernames/reverse/:address` and
  // `/usernames/batch-reverse`) were removed: they linked a private init1
  // address back to a public shortId/nickname, which breaks the privacy
  // invariant. shortId is derivable client-side from the user's OWN address
  // via `generateShortId`; there is no legitimate need for a server-side
  // address→shortId lookup. If re-added in the future, it must require auth
  // AND restrict queries to the caller's own address.
}
