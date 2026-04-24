/**
 * OFAC Sanctions Screening Service
 *
 * Screens wallet addresses against the OFAC SDN (Specially Designated Nationals)
 * consolidated list before allowing any transaction.
 *
 * Two modes:
 *  1. Local — downloads and caches the OFAC consolidated list (free, ~30min refresh)
 *  2. External — calls Chainalysis / TRM Labs API (paid, real-time)
 *
 * The local mode is sufficient for v1. Swap to external for production scale.
 */

import crypto from 'crypto'

const OFAC_LIST_URL =
  'https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml'

// In-memory cache: Set<lowercased address>
const blockedAddresses = new Set<string>()
let lastFetched = 0
const REFRESH_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

// Hardcoded high-confidence blocked addresses (update periodically)
// Source: https://home.treasury.gov/policy-issues/financial-sanctions/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists
const KNOWN_BLOCKED: string[] = [
  // Lazarus Group (DPRK) — confirmed on-chain addresses
  '0x098b716b8aaf21512996dc57eb0615e2383e2f96', // Ronin bridge hack
  '0xa0e1c89ef1a489c9c7de96311ed5ce5d32c20e4b',
  '0x3cffd56b47278a68122f8acfa3bf33ea7f43b7cb',
  // Add more as published by OFAC
]

// Blocked country IP ranges (basic — supplement with proper GeoIP in production)
export const BLOCKED_COUNTRY_CODES = [
  'KP', // North Korea
  'IR', // Iran
  'CU', // Cuba
  'SY', // Syria
  // RU: partial — only sanctioned entities, not all of Russia
]

/**
 * Initialize the OFAC service — call at API startup.
 * Seeds the blocked list and starts background refresh.
 */
export async function initOfacService(): Promise<void> {
  // Seed with known addresses immediately
  for (const addr of KNOWN_BLOCKED) {
    blockedAddresses.add(addr.toLowerCase())
  }

  // Attempt to fetch fresh list
  await refreshOfacList()

  // Background refresh every 30 minutes
  setInterval(() => {
    refreshOfacList().catch(err =>
      console.error('[OFAC] Background refresh failed:', err.message)
    )
  }, REFRESH_INTERVAL_MS)

  console.log(
    `[OFAC] Service initialized — ${blockedAddresses.size} blocked addresses`
  )
}

/**
 * Screen a wallet address against the OFAC SDN list.
 *
 * @param address — bech32 (init1...), hex (0x...), or username
 * @returns { blocked: boolean, reason?: string }
 */
export async function screenAddress(address: string): Promise<{
  blocked: boolean
  reason?: string
}> {
  // Ensure list is fresh
  if (Date.now() - lastFetched > REFRESH_INTERVAL_MS) {
    await refreshOfacList().catch(() => {
      // Non-fatal: continue with cached list
    })
  }

  const normalized = address.toLowerCase().trim()

  if (blockedAddresses.has(normalized)) {
    return {
      blocked: true,
      reason: 'Address appears on OFAC Specially Designated Nationals list',
    }
  }

  // Also check hex representation if bech32 provided
  if (normalized.startsWith('init1')) {
    const hex = bech32ToHex(normalized)
    if (hex && blockedAddresses.has(hex)) {
      return {
        blocked: true,
        reason: 'Address appears on OFAC Specially Designated Nationals list',
      }
    }
  }

  return { blocked: false }
}

/**
 * Screen multiple addresses in one call (e.g. sender + recipient).
 */
export async function screenAddresses(addresses: string[]): Promise<{
  blocked: boolean
  blockedAddress?: string
  reason?: string
}> {
  for (const addr of addresses) {
    const result = await screenAddress(addr)
    if (result.blocked) {
      return { blocked: true, blockedAddress: addr, reason: result.reason }
    }
  }
  return { blocked: false }
}

/**
 * Refresh the OFAC consolidated list.
 * Parses the XML and extracts all crypto wallet addresses.
 */
async function refreshOfacList(): Promise<void> {
  try {
    const response = await fetch(OFAC_LIST_URL, {
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const xml = await response.text()
    const extracted = extractAddressesFromXml(xml)

    // Add to set
    let added = 0
    for (const addr of extracted) {
      if (!blockedAddresses.has(addr)) {
        blockedAddresses.add(addr)
        added++
      }
    }

    lastFetched = Date.now()
    console.log(
      `[OFAC] List refreshed — ${added} new addresses, ${blockedAddresses.size} total`
    )
  } catch (err: any) {
    console.warn('[OFAC] Could not refresh list:', err.message)
    // Non-fatal — continue with cached list + known blocked
  }
}

/**
 * Extract digital currency addresses from OFAC XML.
 * The SDN XML contains <feature featureTypeID="..."> entries for ETH, BTC, XMR, etc.
 */
function extractAddressesFromXml(xml: string): string[] {
  const addresses: string[] = []

  // Match digital currency addresses in OFAC XML format
  // <feature featureTypeID="344"><featureVersion seqID="..."><versionDetail>0x...</versionDetail>
  const regex = /<versionDetail[^>]*>([0-9a-zA-Z]{20,})<\/versionDetail>/gi
  let match

  while ((match = regex.exec(xml)) !== null) {
    const value = match[1].toLowerCase()
    // Filter: looks like a hex address or bech32
    if (
      value.match(/^0x[0-9a-f]{40}$/) || // EVM
      value.match(/^init1[a-z0-9]{38,}$/) || // Initia bech32
      value.match(/^cosmos1[a-z0-9]{38,}$/) || // Cosmos
      value.match(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/) // Bitcoin
    ) {
      addresses.push(value)
    }
  }

  return addresses
}

/**
 * Basic bech32 → hex conversion for Initia/Cosmos addresses.
 * Used for cross-format matching.
 */
function bech32ToHex(bech32Addr: string): string | null {
  try {
    // Strip prefix and decode base32
    const parts = bech32Addr.split('1')
    if (parts.length < 2) return null
    // Simplified — in production use @cosmjs/encoding
    return null // placeholder
  } catch {
    return null
  }
}

/**
 * Hash an IP address for privacy-preserving logging.
 */
export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + 'ipay-salt').digest('hex').slice(0, 16)
}
