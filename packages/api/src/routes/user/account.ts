/**
 * Account Routes — authenticated self-management
 *
 * GET  /v1/account/me                      — get my account
 * PUT  /v1/account/nickname                — update nickname
 * POST /v1/account/decrypt-claim-key       — decrypt claim key (server-hosted)
 * GET  /v1/account/viewing-pubkey          — get my own viewing pubkey
 * PUT  /v1/account/default-claim-address   — set default claim address
 * GET  /v1/account/default-claim-address   — get default claim address
 *
 * All routes require Bearer session token.
 *
 * Registration: see register.ts
 * Public lookups: see directory.ts
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createHash } from 'crypto'
import { getDb } from '../../db'
import { decryptClaimKey } from '../../services/security/encryption'
import { calcAutoClaimAt, runAutoClaimV2, triggerClaimNow } from '../../services/relayer/autoClaim'
import { requireAuth } from '../../middleware/auth'
import { getPoolAddress } from '../../shared/contract-config'
import { APP_URL, MODULE_ADDRESS, REST_URL, RPC_URL } from '../../shared/config'
import { sponsorClaim } from '../../services/relayer/payRelayer'
import { encodeGiftShortCode, encodeGiftGroupCode } from '../../lib/giftCrypto'
import { hashPaymentId } from '../../lib/payKeyHash'
import { ensureViewingKey } from '../../lib/viewingKey'
import { syncPaymentFromChain } from '../../lib/payChainSync'
interface ApiAccount { shortId: string; nickname: string; address?: string; [k: string]: any }
interface ApiAccountResponse { account: ApiAccount | null; [k: string]: any }

/**
 * Compute DNA gradient parameters from an address.
 * Mirrors the FNV-1a derivation in IdentityCard.tsx so the public ProfileCard
 * page can render the same visual identity without exposing the raw address.
 */
function computeDnaParams(address: string) {
  const s = address.toLowerCase()
  const fnv = (x: string): number => {
    let h = 0x811c9dc5
    for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 0x01000193) }
    return h >>> 0
  }
  return {
    hue:      fnv(s) % 360,
    rawL:     fnv(s + 'lit')   % 48,
    rawS:     fnv(s + 'sat')   % 48,
    themeIdx: fnv(s + 'theme') % 6,
    angIdx:   fnv(s + 'ang')   % 8,
    h2oRaw:   fnv(s + 'h2o')   % 30,
  }
}

/** Fetch payment IDs where this address is the recipient (cooked index on chain) */
async function getInboxPaymentIds(viewingPubkeyHex: string, poolAddress: string, moduleAddress: string): Promise<string[]> {
  try {
    const pubBytes = Buffer.from(viewingPubkeyHex.replace('0x',''), 'hex')
    const b64Pub  = pubBytes.toString('base64')
    const poolBytes = Buffer.from(poolAddress.replace('0x',''), 'hex').toString('base64')
    const res = await fetch(
      `${REST_URL}/initia/move/v1/accounts/${moduleAddress}/modules/pay_v3/view_functions/get_payment_ids_by_recipient`,
      { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ type_args:[], args:[poolBytes, b64Pub] }) }
    )
    if (!res.ok) return []
    const data = await res.json()
    const ids: string[] = JSON.parse(data.data ?? '[]')
    return ids
  } catch { return [] }
}

/** Low-level: query pay_v3::get_payment_full by raw hex key (no hashing). */
async function queryPayFullByRawKey(rawHex: string, poolAddress: string, moduleAddress: string): Promise<any|null> {
  try {
    const pid  = rawHex.replace(/^0x/i, '').toLowerCase()
    const pool = poolAddress.replace(/^0x/i, '').toLowerCase()
    const mod  = moduleAddress.toLowerCase()

    const poolBytes = Buffer.from(pool.padStart(64, '0'), 'hex')
    const poolB64   = poolBytes.toString('base64')
    const pidBytes  = Buffer.from(pid.padStart(64, '0'), 'hex')
    const pidBcs    = Buffer.concat([Buffer.from([pidBytes.length]), pidBytes])
    const pidB64    = pidBcs.toString('base64')

    const url = `${REST_URL}/initia/move/v1/accounts/${mod}/modules/pay_v3/view_functions/get_payment_full`
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type_args: [], args: [poolB64, pidB64] }),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: string }
    if (!json.data) return null
    return JSON.parse(json.data)
  } catch { return null }
}

/**
 * Fetch full payment struct from chain via REST API.
 *
 * Resilient to the pay hash rollout: tries sha256(plain) first (what
 * the post-hash frontend uses as chain key) and falls back to plain on
 * the contract's "not found" sentinel (status=0, amount=0). This
 * recovers payments deposited by the pre-hash frontend which are
 * still keyed by the plain id on chain. Mirrors the same logic we
 * already have in the frontend's fetchPaymentFullFromChain helper.
 */
export async function getChainPayment(paymentId: string, poolAddress: string, moduleAddress: string): Promise<any|null> {
  const plainHex = paymentId.replace(/^0x/i, '')
  // Primary: sha256(plain)
  const hashed = hashPaymentId(plainHex)
  const hit = await queryPayFullByRawKey(hashed, poolAddress, moduleAddress)
  if (Array.isArray(hit) && (Number(hit[0]) !== 0 || String(hit[1]) !== '0')) {
    return hit
  }
  // Fallback: plain key (pre-hash legacy entries)
  return await queryPayFullByRawKey(plainHex, poolAddress, moduleAddress)
}

const MODULE_HEX   = MODULE_ADDRESS
const CREATED_EVENT = `${MODULE_HEX}::pay_v3::PaymentCreatedEventV2`
const CLAIMED_EVENT = `${MODULE_HEX}::pay_v3::PaymentClaimedEventV2`
const REVOKED_EVENT = `${MODULE_HEX}::pay_v3::PaymentRevokedEventV2`

/** Search RPC for txs by sender address, extract pay_v3 events */
async function rpcTxSearch(query: string, page = 1, perPage = 50): Promise<any[]> {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'tx_search',
    params: { query, prove: false, page: String(page), per_page: String(perPage), order_by: 'desc' },
  })
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'iPay/1.0' },
    body, signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) return []
  const json = await res.json() as any
  return json?.result?.txs ?? []
}

function decodeAttr(val: string): string {
  return val  // JSON-RPC tx_search returns plain strings (not base64)
}

/** Extract pay_v3 events of a given type from raw RPC tx list */
function extractPayEvents(txs: any[], eventType: string): Array<{ txHash: string; height: number; data: any }> {
  const out: Array<{ txHash: string; height: number; data: any }> = []
  for (const tx of txs) {
    const events: any[] = tx?.tx_result?.events ?? []
    for (const ev of events) {
      if (ev.type !== 'move') continue
      const attrs: Record<string, string> = {}
      for (const a of (ev.attributes ?? [])) {
        attrs[decodeAttr(a.key)] = decodeAttr(a.value)
      }
      if (attrs.type_tag !== eventType) continue
      try {
        const data = JSON.parse(attrs.data ?? '{}')
        out.push({ txHash: tx.hash as string, height: parseInt(tx.height ?? '0'), data })
      } catch { /* skip malformed */ }
    }
  }
  return out
}

/** Bech32 → EVM hex (lowercase 0x) */
function bech32ToEvmHex(addr: string): string {
  try {
    const { bech32 } = require('bech32') as any
    const { words } = bech32.decode(addr)
    const bytes = bech32.fromWords(words)
    return '0x' + Buffer.from(bytes).toString('hex')
  } catch { return addr }
}

/**
 * Chain-first history: SENT payments (PaymentCreatedEventV2 by sender)
 */
async function getChainSentHistory(evmHex: string, page = 1, limit = 50): Promise<any[]> {
  try {
    // Convert 0x address to bech32 for the RPC query (message.sender = bech32)
    const { bech32 } = require('bech32') as any
    const addrBytes = Buffer.from(evmHex.replace('0x','').padStart(64,'0').slice(-40), 'hex')
    const bech32Addr = bech32.encode('init', bech32.toWords(addrBytes))
    const txs = await rpcTxSearch(`message.sender='${bech32Addr}'`, page, limit)
    return extractPayEvents(txs, CREATED_EVENT)
  } catch { return [] }
}

/**
 * Chain-first history: RECEIVED payments (PaymentClaimedEventV2 by claimed_by)
 * claimed_by = the address that received iUSD (set during sponsor_claim / direct claim)
 */
async function getChainReceivedHistory(evmHex: string, page = 1, limit = 50): Promise<any[]> {
  try {
    // Direct attribute index query — O(mine) not O(all-relayer-txs)
    const addrLower = evmHex.toLowerCase().replace(/[^0-9a-fx]/g, '')
    const txs = await rpcTxSearch(`move.claimed_by='${addrLower}'`, page, limit)
    return extractPayEvents(txs, CLAIMED_EVENT)
  } catch { return [] }
}


// ─── Helpers (exported for use in register.ts and directory.ts) ────────────

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Deterministic base36 encoding of any address format (init1 bech32 or 0x EVM).
 * Uses SHA256 hash to produce a consistent 50-char base36 string.
 */
function addressToBase36(addr: string): string {
  const normalized = addr.toLowerCase().replace(/\s/g, '')
  const hashHex = createHash('sha256').update(normalized).digest('hex')
  let n = BigInt('0x' + hashHex)
  let out = ''
  const B = 36n
  while (n > 0n) { out = B36[Number(n % B)] + out; n = n / B }
  while (out.length < 50) out = '0' + out
  return out.toUpperCase()
}

export function generateShortId(address: string): string {
  return addressToBase36(address).slice(0, 16)
}

// Checksum = last 4 chars of the full 16-char shortId (the TAIL shown in display)
export function generateChecksum(address: string): string {
  return addressToBase36(address).slice(12, 16)
}

import { ADJECTIVES, NOUNS } from '../../lib/nicknames'

export function generateRandomNickname(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}${noun}`
}

export function normalizeAddress(addr: string): string {
  if (addr.startsWith('init1')) return addr.toLowerCase()
  return addr.toLowerCase().startsWith('0x') ? addr.toLowerCase() : `0x${addr.toLowerCase()}`
}

function formatDisplay(nickname: string, shortId: string, checksum: string): string {
  return `[${nickname}]@${shortId}***[${checksum}]`
}

/** Maps DB row → ApiAccount (camelCase, matches shared types) */
/**
 * Format an account row for API output.
 *
 * PRIVACY: the init1 `address` is the user's private wallet identifier and
 * MUST NOT be exposed in public (unauth) lookups — doing so would break the
 * invariant that only the `shortId` is the public handle. Callers handling
 * a user's OWN authenticated session may pass `{ includeAddress: true }` to
 * include the address; every other caller must leave it out.
 */
export function formatAccountResponse(
  row: any,
  opts: { includeAddress?: boolean } = {},
): ApiAccount {
  const out: ApiAccount = {
    shortId:             row.short_id,
    checksum:            row.checksum,
    nickname:            row.nickname,
    address:             undefined as any,
    display:             formatDisplay(row.nickname, row.short_id, row.checksum),
    avatarSeed:          row.avatar_seed ?? null,
    avatarSvg:           row.avatar_svg       ?? null,
    shortSealSvg:        row.short_seal_svg   ?? null,
    defaultClaimAddress: row.default_claim_address ?? null,
    autoClaimEnabled:    !!row.auto_claim_enabled,
    merchantName:        row.merchant_name ?? null,
    merchantData:        row.merchant_data ? (() => { try { return JSON.parse(row.merchant_data) } catch { return null } })() : null,
    bio:                 row.bio ?? '',
    createdAt:           row.created_at,
  }
  if (opts.includeAddress) {
    out.address = row.address
  } else {
    delete (out as any).address
  }
  return out
}

function pick<T extends Record<string, any>>(obj: T, keys: string[]) {
  const out: Record<string, any> = {}
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  return out
}

function sanitizeMerchant(merchant: any) {
  if (!merchant || typeof merchant !== 'object') return {}
  return pick(merchant, ['name', 'logoUrl', 'color', 'description', 'email', 'phone', 'website', 'address', 'taxId'])
}

function hashMeta(input: string) {
  return createHash('sha256').update(input).digest('hex')
}

function auditPublicAccess(db: any, req: any, params: {
  route: string
  resourceId: string
  result: 'ok' | 'not_found' | 'error'
  fieldSetVersion: string
}) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS public_endpoint_audit (
        id SERIAL PRIMARY KEY,
        route TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        ip_hash TEXT,
        ua_hash TEXT,
        result TEXT NOT NULL,
        field_set_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (now()::text)
      )
    `)
    const ip = String(req.ip ?? req.headers?.['x-forwarded-for'] ?? '')
    const ua = String(req.headers?.['user-agent'] ?? '')
    db.prepare(`
      INSERT INTO public_endpoint_audit
      (route, resource_id, ip_hash, ua_hash, result, field_set_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      params.route,
      params.resourceId,
      hashMeta(ip),
      hashMeta(ua),
      params.result,
      params.fieldSetVersion,
    )
  } catch {}
}

// ─── Routes ────────────────────────────────────────────────────────────────

export async function accountRoutes(app: FastifyInstance) {
  const db = getDb()

  // Deprecated endpoints removed — use /v1/activity?types=gift_sent,gift_received instead.
  // Old handlers: /account/gift/sent, /account/gift/received

  // Ensure accounts table exists (idempotent)
  try { db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id                  SERIAL PRIMARY KEY,
      address             TEXT UNIQUE NOT NULL,
      pubkey              TEXT NOT NULL DEFAULT '',
      short_id            TEXT UNIQUE NOT NULL,
      checksum            TEXT NOT NULL,
      nickname            TEXT NOT NULL,
      avatar_seed         INTEGER DEFAULT 0,
      avatar_svg          TEXT,
      viewing_privkey_enc TEXT,
      default_claim_address TEXT,
      short_seal_svg      TEXT,
      frozen_at           TEXT,
      deleted_at          TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_short_id ON accounts(short_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_nickname  ON accounts(nickname);
  `) } catch { /* table may already exist from migration */ }

  /**
   * GET /v1/account/public/:shortId/merchant
   * Public merchant profile — no auth required.
   * Returns only merchant_data (name, logoUrl, color, description, address, etc.)
   */
  app.get('/account/public/:shortId/merchant', async (req: any, reply: any) => {
    const db = getDb()
    const { shortId } = req.params as { shortId: string }
    const row = db.prepare('SELECT merchant_data, nickname FROM accounts WHERE short_id = ?').get(shortId) as any
    if (!row) {
      auditPublicAccess(db, req, {
        route: '/v1/account/public/:shortId/merchant',
        resourceId: shortId,
        result: 'not_found',
        fieldSetVersion: 'merchant_public_v1',
      })
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }
    let merchant: any = {}
    try { merchant = row.merchant_data ? JSON.parse(row.merchant_data) : {} } catch {}
    const payload = {
      merchant: sanitizeMerchant(merchant),
      nickname: row.nickname ?? null,
    }
    auditPublicAccess(db, req, {
      route: '/v1/account/public/:shortId/merchant',
      resourceId: shortId,
      result: 'ok',
      fieldSetVersion: 'merchant_public_v1',
    })
    return reply.send(payload)
  })

  /**
   * GET /v1/account/public/:shortId/profile
   * Public profile card data — no auth required.
   */
  app.get('/account/public/:shortId/profile', async (req: any, reply: any) => {
    const db = getDb()
    const { shortId } = req.params as { shortId: string }
    const row = db.prepare(
      'SELECT nickname, short_id, address, avatar_svg, short_seal_svg, bio, merchant_data FROM accounts WHERE short_id = ?'
    ).get(shortId) as any
    if (!row) {
      auditPublicAccess(db, req, {
        route: '/v1/account/public/:shortId/profile',
        resourceId: shortId,
        result: 'not_found',
        fieldSetVersion: 'profile_public_v1',
      })
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }
    let merchant: any = null
    try { merchant = row.merchant_data ? JSON.parse(row.merchant_data) : null } catch {}
    const privId = (id: string) => id && id.length >= 8 ? `${id.slice(0,4)}◆${id.slice(-4)}` : id
    // DNA params derived from the (private) address — exposed so the public
    // profile page can render the same gradient as the owner's IdentityCard
    // without leaking the raw init1 address. Information content is negligible
    // (hue 0-359, themeIdx 0-5, angIdx 0-7, etc.) and FNV is one-way for
    // practical purposes on 40+ char addresses.
    const dna = row.address ? computeDnaParams(row.address) : null
    const fullPayload = {
      shortId:      row.short_id,
      nickname:     row.nickname ?? '',
      privacyId:    privId(row.short_id ?? ''),
      avatarSvg:    row.avatar_svg ?? null,
      shortSealSvg: row.short_seal_svg ?? null,
      bio:          row.bio ?? '',
      merchantName: merchant?.name ?? null,
      profileUrl:   `https://iusd-pay.xyz/profile/${row.short_id}`,
      payUrl:       `https://iusd-pay.xyz/profile/${row.short_id}`,
      dna,
    }
    const payload = pick(fullPayload, [
      'shortId', 'nickname', 'privacyId', 'avatarSvg', 'shortSealSvg', 'bio', 'merchantName', 'profileUrl', 'payUrl', 'dna',
    ])
    auditPublicAccess(db, req, {
      route: '/v1/account/public/:shortId/profile',
      resourceId: shortId,
      result: 'ok',
      fieldSetVersion: 'profile_public_v1',
    })
    return reply.send(payload)
  })

  /**
   * GET /v1/payment/verify/:paymentId
   * Public endpoint — verify a payment by ID. Returns non-sensitive info only.
   */
  app.get('/payment/verify/:paymentId', async (req: any, reply: any) => {
    const db = getDb()
    const { paymentId } = req.params as { paymentId: string }
    const pid = paymentId.replace(/^0x/i, '').toLowerCase()
    const row = db.prepare(`
      SELECT ip.payment_id, ip.amount_micro, ip.created_at, ip.auto_claimed_at,
             ip.recipient_short_id, ip.sender_short_id,
             itx.status AS chain_status, itx.tx_hash,
             a_r.nickname AS recipient_nickname, a_r.short_seal_svg AS recipient_seal,
             a_s.nickname AS sender_nickname,   a_s.short_seal_svg AS sender_seal
      FROM payment_intents ip
      LEFT JOIN invoice_transactions itx ON lower(replace(itx.payment_id,'0x','')) = lower(replace(ip.payment_id,'0x',''))
      LEFT JOIN accounts a_r ON a_r.short_id = ip.recipient_short_id
      LEFT JOIN accounts a_s ON a_s.short_id = ip.sender_short_id
      WHERE lower(replace(ip.payment_id,'0x','')) = ?
    `).get(pid) as any
    if (!row) {
      auditPublicAccess(db, req, {
        route: '/v1/payment/verify/:paymentId',
        resourceId: pid,
        result: 'not_found',
        fieldSetVersion: 'verify_v1',
      })
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }
    const status = row.chain_status === 3 ? 'paid'
      : row.chain_status === 5 ? 'revoked'
      : row.chain_status === 7 ? 'expired'
      : row.auto_claimed_at ? 'paid'
      : 'pending'

    const fullPayload = {
      paymentId:          row.payment_id,
      amountMicro:        row.amount_micro,
      feeMicro:           (() => {
        // Derive fee from gross amount: fee = gross * 0.005, capped at 5 iUSD (5_000_000 micro)
        const gross = parseInt(row.amount_micro ?? '0')
        if (!gross) return null
        const fee = Math.min(Math.round(gross * 0.005), 5_000_000)
        return fee > 0 ? String(fee) : null
      })(),
      status,
      createdAt:          row.created_at,
      claimedAt:          row.auto_claimed_at ?? null,
      txHash:             row.tx_hash ?? null,
      recipientNickname:  row.recipient_nickname ?? null,
      recipientShortId:   row.recipient_short_id ?? null,
      recipientSeal:      row.recipient_seal ?? null,
      senderNickname:     row.sender_nickname ?? null,
      senderShortId:      row.sender_short_id ?? null,
      senderSeal:         row.sender_seal ?? null,
    }
    const payload = pick(fullPayload, [
      'paymentId', 'status', 'amountMicro', 'feeMicro', 'createdAt', 'claimedAt', 'txHash',
      'senderNickname', 'recipientNickname', 'senderShortId', 'recipientShortId', 'senderSeal', 'recipientSeal',
    ])

    auditPublicAccess(db, req, {
      route: '/v1/payment/verify/:paymentId',
      resourceId: pid,
      result: 'ok',
      fieldSetVersion: 'verify_v1',
    })
    return reply.send(payload)
  })

  /**
   * POST /v1/payment/sync — Frontend calls this when chain status differs from DB cache.
   * Server asynchronously fetches chain state and updates DB. No auth required.
   */
  app.post('/payment/sync', async (req: FastifyRequest, reply: FastifyReply) => {
    const { paymentId } = req.body as { paymentId?: string }
    if (!paymentId) return reply.status(400).send({ error: 'paymentId required' })

    const pid = paymentId.replace(/^0x/i, '').toLowerCase()

    // Fire and forget — don't block the response
    syncPaymentFromChain(pid).then(result => {
      if (result.synced) {
        console.log(`[sync] Payment ${pid.slice(0, 12)} synced: chainStatus=${result.chainStatus}`)
      }
    }).catch(err => {
      console.warn(`[sync] Failed to sync ${pid.slice(0, 12)}:`, err.message)
    })

    return reply.send({ ok: true })
  })

  /**
   * GET /v1/account/me
   */
  app.get('/account/me', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const row = db.prepare('SELECT * FROM accounts WHERE address = ?').get(userAddress) as any
    if (!row) return reply.status(404).send({ error: 'NOT_REGISTERED' })
    return { account: formatAccountResponse(row, { includeAddress: true }) } satisfies ApiAccountResponse
  })

  /**
   * GET /v1/account/nickname-fee
   * Returns the fee for changing nickname: 0.1 iUSD first time, 10 iUSD after.
   */
  app.get('/account/nickname-fee', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const row = db.prepare('SELECT nickname_change_count FROM accounts WHERE address = ?').get(userAddress) as any
    if (!row) return reply.status(404).send({ error: 'NOT_REGISTERED' })
    const count = row.nickname_change_count ?? 0
    const feeMicro = count === 0 ? 100_000 : 10_000_000  // 0.1 or 10 iUSD
    const feeIusd = count === 0 ? '0.10' : '10.00'
    const { TREASURY_ADDRESS: treasury } = await import('../../shared/config')
    return reply.send({ changeCount: count, feeMicro, feeIusd, isFirst: count === 0, treasury })
  })

  /**
   * PUT /v1/account/nickname
   * Any Unicode, 1–12 chars. Requires txHash of fee payment.
   * First change: 0.1 iUSD, subsequent: 10 iUSD.
   */
  app.put('/account/nickname', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const { nickname, txHash } = request.body as { nickname: string; txHash?: string }

    if (!nickname || nickname.trim().length < 1) {
      return reply.status(400).send({ error: 'INVALID_NICKNAME', message: 'Nickname cannot be empty' })
    }
    const trimmed = nickname.trim().slice(0, 12)

    const row = db.prepare('SELECT nickname_change_count FROM accounts WHERE address = ?').get(userAddress) as any
    if (!row) return reply.status(404).send({ error: 'NOT_REGISTERED' })
    const count = row.nickname_change_count ?? 0
    const requiredMicro = count === 0 ? 100_000 : 10_000_000

    // Verify fee payment tx on chain
    if (!txHash) {
      return reply.status(400).send({ error: 'TX_REQUIRED', message: 'Fee payment txHash required' })
    }
    try {
      const txRes = await fetch(`${REST_URL}/cosmos/tx/v1beta1/txs/${txHash}`)
      if (!txRes.ok) {
        return reply.status(400).send({ error: 'TX_NOT_FOUND', message: 'Transaction not found on chain' })
      }
      const txData = await txRes.json() as any
      const txResult = txData.tx_response || txData
      if (txResult.code && txResult.code !== 0) {
        return reply.status(400).send({ error: 'TX_FAILED', message: 'Transaction failed on chain' })
      }
    } catch {
      return reply.status(400).send({ error: 'TX_VERIFY_ERROR', message: 'Could not verify transaction' })
    }

    const { generateIdentitySeal } = await import('../../services/core/identity-seal')
    const avatarSvg    = generateIdentitySeal({ address: userAddress, nickname: trimmed, fontSize: 16 })
    const shortSealSvg = generateIdentitySeal({ address: userAddress, nickname: '', fontSize: 14, showNickname: false })

    const result = db.prepare(
      "UPDATE accounts SET nickname = ?, avatar_svg = ?, short_seal_svg = ?, nickname_change_count = COALESCE(nickname_change_count, 0) + 1, updated_at = now()::text WHERE address = ?"
    ).run(trimmed, avatarSvg, shortSealSvg, userAddress)

    if (result.changes === 0) return reply.status(404).send({ error: 'NOT_REGISTERED' })

    const updated = db.prepare('SELECT * FROM accounts WHERE address = ?').get(userAddress) as any
    return { success: true, account: formatAccountResponse(updated, { includeAddress: true }) }
  })

  /**
   * GET /v1/account/preview-seal?nickname=xxx
   * Returns SVG preview of the seal for the current user's address + given nickname.
   */
  app.get('/account/preview-seal', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const { nickname } = request.query as { nickname?: string }
    const nick = (nickname ?? '').trim().slice(0, 12)
    const { generateIdentitySeal } = await import('../../services/core/identity-seal')
    const svg = generateIdentitySeal({ address: userAddress, nickname: nick || 'preview', fontSize: 16 })
    reply.header('Content-Type', 'image/svg+xml')
    return reply.send(svg)
  })

  /**
   * GET /v1/account/viewing-pubkey — my own viewing pubkey
   */
  app.get('/account/viewing-pubkey', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    try {
      const vk = ensureViewingKey(db, userAddress)
      return { viewingPubkey: vk.pubkeyHex, address: userAddress }
    } catch (err: any) {
      return reply.status(404).send({ error: 'NOT_REGISTERED', detail: err.message })
    }
  })

  /**
   * POST /v1/account/decrypt-claim-key
   * Body: { keyForRecipient: string (hex) }
   */
  app.post('/account/decrypt-claim-key', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const { keyForRecipient } = request.body as { keyForRecipient: string }

    if (!keyForRecipient) {
      return reply.status(400).send({ error: 'MISSING_KEY' })
    }

    const row = db.prepare('SELECT viewing_privkey_enc FROM accounts WHERE address = ?').get(userAddress) as any
    if (!row) return reply.status(404).send({ error: 'NOT_REGISTERED' })
    if (!row.viewing_privkey_enc) {
      return reply.status(400).send({ error: 'NO_SERVER_KEY' })
    }

    try {
      const claimKey = decryptClaimKey(Buffer.from(keyForRecipient, 'hex'), row.viewing_privkey_enc)
      return { success: true, claimKey: claimKey.toString('hex') }
    } catch (e: any) {
      return reply.status(400).send({ error: 'DECRYPTION_FAILED', message: e.message })
    }
  })

  /**
   * PUT /v1/account/default-claim-address
   * Body: { address: string | null }
   */
  app.put('/account/default-claim-address', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const { address } = request.body as { address: string | null }

    if (address !== null && address !== undefined) {
      if (!/^0x[a-f0-9]{40}$/i.test(address.trim())) {
        return reply.status(400).send({ error: 'INVALID_ADDRESS' })
      }
      db.prepare('UPDATE accounts SET default_claim_address = ?, updated_at = CURRENT_TIMESTAMP WHERE address = ?')
        .run(address.trim().toLowerCase(), userAddress)
    } else {
      db.prepare('UPDATE accounts SET default_claim_address = NULL, updated_at = CURRENT_TIMESTAMP WHERE address = ?')
        .run(userAddress)
    }

    return { success: true, defaultClaimAddress: address ? address.toLowerCase() : null }
  })

  /**
   * GET /v1/account/default-claim-address
   */
  app.get('/account/default-claim-address', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const row = db.prepare('SELECT default_claim_address FROM accounts WHERE address = ?').get(userAddress) as any
    if (!row) return reply.status(404).send({ error: 'NOT_REGISTERED' })
    return { defaultClaimAddress: row.default_claim_address || null }
  })

  /**
   * DELETE /v1/account/me
   * Self-service account deletion.
   * - Removes account row (nickname, avatar, viewing key, etc.)
   * - Removes viewing_keys row
   * - Revokes all auth sessions
   * - Auth challenge cleared
   */
  app.delete('/account/me', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress

    // Remove account row (all personal data)
    db.prepare('DELETE FROM accounts WHERE address = ?').run(userAddress)

    // Remove viewing key
    db.prepare('DELETE FROM viewing_keys WHERE address = ?').run(userAddress)

    // Revoke all sessions
    db.prepare('DELETE FROM auth_sessions WHERE address = ?').run(userAddress)

    // Clear auth challenge
    db.prepare('DELETE FROM auth_challenges WHERE address = ?').run(userAddress)

    // Log deletion
    db.prepare(`INSERT INTO event_log (event_type, address, details, created_at)
                VALUES ('account_deleted', ?, ?, now()::text)`)
      .run(userAddress, '{}')

    console.log(`[account] Account deleted: ${userAddress}`)
    return { success: true }
  })
  /**
   * POST /v1/account/payment-intent
   * Record intended recipient for a payment (for admin visibility only)
   */
  app.post('/account/payment-intent', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { paymentId, recipientShortId, amountMicro, invoiceType, merchantSnapshot } = request.body as any
    if (!paymentId || !recipientShortId) {
      return reply.status(400).send({ error: 'paymentId and recipientShortId required' })
    }
    const db = getDb()
    const senderShortId = (request as any).account?.short_id ?? null
    // Check recipient auto-claim before try block (needed after)
    const recipAccount = recipientShortId
      ? db.prepare('SELECT auto_claim_enabled, address FROM accounts WHERE short_id = ?').get(recipientShortId) as any
      : null
    const recipAutoClaimEnabled = !!recipAccount?.auto_claim_enabled
    const recipientAddress = recipAccount?.address ?? null

    // Detect if recipient is a new user (account not yet on-chain).
    // New users have no funded address yet, so the sponsor relayer must fast-claim for them.
    let recipientIsNewUser = false
    if (recipientAddress) {
      try {
        const acctRes = await fetch(`${REST_URL}/cosmos/auth/v1beta1/accounts/${recipientAddress}`)
        if (!acctRes.ok) recipientIsNewUser = true
        else {
          const acctData = await acctRes.json() as any
          if (!acctData.account?.pub_key) recipientIsNewUser = true
        }
      } catch {
        recipientIsNewUser = true
      }
    }

    const isMerchant = invoiceType === 'merchant'
    const useFastClaim = isMerchant || recipAutoClaimEnabled || recipientIsNewUser

    try {
      // Also store recipient address (bech32) + random auto_claim_at window (12~24h)
      const recipientRow = recipientShortId && !recipientAddress
        ? db.prepare('SELECT address FROM accounts WHERE short_id = ?').get(recipientShortId) as any
        : null
      const _recipientAddress = recipientRow?.address ?? recipientAddress ?? null

      const fastSec = Math.round(60 + Math.random() * 60)  // 1~2 min
      const claimAt = useFastClaim
        ? new Date(Date.now() + fastSec * 1000).toISOString().replace('T', ' ').replace('Z', '')
        : calcAutoClaimAt()  // 12~24h random window

      // UPSERT: on conflict keep whichever auto_claim_at is earlier (so link-payment's
      // immediate datetime('now') is never overridden by this +90s window value).
      db.prepare(`
        INSERT INTO payment_intents
          (payment_id, sender_short_id, recipient_short_id, amount_micro, recipient_address,
           auto_claim_at, auto_claim_status, invoice_type, merchant_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(payment_id) DO UPDATE SET
          sender_short_id   = excluded.sender_short_id,
          recipient_short_id = excluded.recipient_short_id,
          amount_micro       = excluded.amount_micro,
          recipient_address  = excluded.recipient_address,
          merchant_snapshot  = excluded.merchant_snapshot,
          invoice_type = CASE WHEN payment_intents.invoice_type = 'merchant' THEN 'merchant' ELSE excluded.invoice_type END,
          auto_claim_at = CASE
            WHEN payment_intents.auto_claim_at::timestamp <= (now() + interval '5 seconds') THEN payment_intents.auto_claim_at
            ELSE excluded.auto_claim_at
          END
        WHERE payment_intents.auto_claim_status = 'pending'
      `).run(paymentId, senderShortId, recipientShortId, amountMicro ?? null, _recipientAddress,
             claimAt, invoiceType ?? 'personal', merchantSnapshot ?? null)
    } catch (e: any) {
      // non-critical
      console.warn('[Account] payment-intent insert failed:', e.message)
    }

    // Immediately trigger claim for auto-claim users and new users (can't claim manually)
    if (useFastClaim) {
      triggerClaimNow(paymentId.replace(/^0x/, '')).catch(() => {})
    }

    return reply.send({ ok: true })
  })

  /**
   * GET /v1/account/history/sent
   * GET /v1/account/payment-intent/by-payment?paymentId=XX
   * Returns the recipient shortId for a given payment ID (for History counterparty enrichment)
   */
  app.get('/account/payment-intent/by-payment', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb()
    const { paymentId } = request.query as { paymentId?: string }
    if (!paymentId) return reply.status(400).send({ error: 'paymentId required' })
    const row = db.prepare(
      'SELECT recipient_short_id, sender_short_id FROM payment_intents WHERE payment_id = ?'
    ).get(paymentId) as any
    if (!row) return reply.send({ found: false })
    return reply.send({
      found:            true,
      recipientShortId: row.recipient_short_id ?? null,
      senderShortId:    row.sender_short_id ?? null,
    })
  })

  // Deprecated: /account/history/sent and /account/history/received removed —
  // use /v1/activity?types=payment_sent|payment_received instead.

  /**
   * GET /v1/account/history/sent-chain
   * Chain-first sent history using RPC tx_search + PaymentCreatedEventV2 events.
   * Returns payment_id, amount, expires_at, txHash, blockHeight per sent payment.
   * Kept separate from DB endpoint — both coexist.
   */
  app.get('/account/history/sent-chain', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const acct    = (request as any).account as any
    const address = acct?.address as string  // init1... bech32 or 0x
    if (!address) return reply.status(401).send({ error: 'UNAUTHORIZED' })

    // Normalize to EVM hex
    let evmHex = address
    if (address.startsWith('init1')) {
      try {
        const { bech32 } = require('bech32') as any
        const { words } = bech32.decode(address)
        const bytes = Buffer.from(bech32.fromWords(words))
        evmHex = '0x' + bytes.toString('hex')
      } catch {}
    }

    const page  = parseInt((request.query as any).page  ?? '1')
    const limit = parseInt((request.query as any).limit ?? '50')
    const events = await getChainSentHistory(evmHex, page, limit)

    const db          = getDb()
    const poolAddress = await getPoolAddress()

    // Enrich each chain event with DB recipient info + live chain status
    const payments = await Promise.all(events.map(async e => {
      const rawPid  = (e.data.payment_id ?? '').replace(/^0x/, '')
      const pid0x   = '0x' + rawPid

      // DB lookup: recipient_short_id + created_at
      let recipientShortId: string | null = null
      let dbCreatedAt: string | null = null
      try {
        const intent = db.prepare(
          'SELECT recipient_short_id, created_at FROM payment_intents WHERE payment_id = ?'
        ).get(pid0x) as any ?? db.prepare(
          'SELECT recipient_short_id, created_at FROM payment_intents WHERE payment_id = ?'
        ).get(rawPid) as any
        if (intent) {
          recipientShortId = intent.recipient_short_id ?? null
          dbCreatedAt      = intent.created_at ?? null
        }
      } catch {}

      // Chain status lookup
      let status    = 0
      let feeMicro  = '0'
      let expiresAt = Number(e.data.expires_at ?? 0)
      try {
        if (poolAddress && rawPid) {
          const raw = await getChainPayment(rawPid, poolAddress, MODULE_ADDRESS)
          if (raw) {
            status    = Number(raw[0])
            feeMicro  = String(raw[2] ?? '0')
            expiresAt = Number(raw[6] ?? expiresAt)
          }
        }
      } catch {}

      return {
        paymentId:          pid0x,
        amountMicro:        String(e.data.amount ?? 0),
        feeMicro,
        status,
        expiresAt,
        recipientShortId,
        dbCreatedAt,
        txHash:             e.txHash,
        blockHeight:        e.height,
        direction:          'sent',
      }
    }))

    return reply.send({ payments, count: payments.length, source: 'chain' })
  })

  /**
   * GET /v1/account/history/received-chain
   * Chain-first received history using RPC tx_search + PaymentClaimedEventV2 events.
   * Scans relayer txs, filters by claimed_by = current user's address.
   */
  app.get('/account/history/received-chain', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const acct    = (request as any).account as any
    const address = acct?.address as string
    if (!address) return reply.status(401).send({ error: 'UNAUTHORIZED' })

    let evmHex = address
    if (address.startsWith('init1')) {
      try {
        const { bech32 } = require('bech32') as any
        const { words } = bech32.decode(address)
        const bytes = Buffer.from(bech32.fromWords(words))
        evmHex = '0x' + bytes.toString('hex')
      } catch {}
    }

    const page  = parseInt((request.query as any).page  ?? '1')
    const events = await getChainReceivedHistory(evmHex, page, 50)

    const payments = events.map(e => ({
      paymentId:   '0x' + (e.data.payment_id ?? ''),
      amountMicro: String(e.data.amount ?? 0),
      claimedBy:   e.data.claimed_by ?? null,
      pool:        e.data.pool ?? null,
      txHash:      e.txHash,
      blockHeight: e.height,
      direction:   'received',
    }))

    return reply.send({ payments, count: payments.length, source: 'chain' })
  })


  /**
   * GET /v1/account/inbox
   * Returns all PENDING_CLAIM payments addressed to the authenticated user.
   * Decrypts key_for_recipient using server-held viewing private key.
   */
  // Deprecated: /account/inbox removed — use /v1/activity?types=payment_pending instead.

  /**
   * POST /v1/account/claim
   * Claim a pending payment via relayer (sponsor pays gas on the user's behalf).
   * Body: { paymentId, claimKey, claimToAddress }
   */
  app.post('/account/claim', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const acct = (request as any).account as any
    const userAddress = acct?.address ?? (request as any).userAddress
    if (!userAddress) return reply.status(401).send({ error: 'UNAUTHORIZED' })

    const { paymentId, claimKey, claimToAddress } = request.body as any
    if (!paymentId || !claimKey || !claimToAddress) {
      return reply.status(400).send({ error: 'paymentId, claimKey, and claimToAddress required' })
    }

    // claimToAddress must be 0x hex for the contract
    let recipientHex = claimToAddress as string
    if (recipientHex.startsWith('init')) {
      // bech32 → hex
      try {
        const { bech32 } = await import('bech32')
        const { words } = bech32.decode(recipientHex)
        const bytes = bech32.fromWords(words)
        recipientHex = '0x' + Buffer.from(bytes).toString('hex')
      } catch (e: any) {
        return reply.status(400).send({ error: 'Invalid claimToAddress', detail: e.message })
      }
    }

    const result = await sponsorClaim(paymentId, claimKey, recipientHex)
    if (!result.success) {
      return reply.status(500).send({ error: 'Claim failed', detail: result.error })
    }

    return reply.send({ success: true, txHash: result.txHash, claimedTo: recipientHex })
  })

  /**
   * PATCH /v1/account/preferences
   * Update user preferences (e.g. autoClaimEnabled).
   * When autoClaimEnabled=true: immediately escalate all pending payment_intents
   * for this user to invoice_type='merchant' + auto_claim_at=NOW (trigger within ~1 min).
   */
  app.patch('/account/preferences', { preHandler: [requireAuth] }, async (req, reply) => {
    const account  = (req as any).account
    const { autoClaimEnabled, merchantName, merchantData, bio } = req.body as {
      autoClaimEnabled?: boolean
      merchantName?: string
      merchantData?: any
      bio?: string
    }

    // Persist bio/slogan
    if (bio !== undefined) {
      db.prepare('UPDATE accounts SET bio=? WHERE short_id=?')
        .run(String(bio).slice(0, 200), account.short_id)
    }

    // Persist auto_claim_enabled to accounts table
    if (autoClaimEnabled !== undefined) {
      db.prepare('UPDATE accounts SET auto_claim_enabled=? WHERE short_id=?')
        .run(autoClaimEnabled ? 1 : 0, account.short_id)
    }

    // Persist merchant info (name + full JSON profile)
    if (merchantName !== undefined) {
      db.prepare('UPDATE accounts SET merchant_name=? WHERE short_id=?')
        .run(merchantName, account.short_id)
    }
    if (merchantData !== undefined) {
      db.prepare('UPDATE accounts SET merchant_data=? WHERE short_id=?')
        .run(JSON.stringify(merchantData), account.short_id)
    }

    // If auto-claim just enabled: escalate all pending payment_intents immediately
    if (autoClaimEnabled === true) {
      const result = db.prepare(
        `UPDATE payment_intents
         SET invoice_type='merchant', auto_claim_at=now()::text
         WHERE recipient_short_id=? AND auto_claim_status='pending'`
      ).run(account.short_id)
      runAutoClaimV2().catch((e: any) => console.error('[preferences] auto-claim trigger error:', e.message))
      return reply.send({
        ok: true,
        escalated: (result as any).changes ?? 0,
        message: 'Auto-claim enabled — pending payments will be claimed within ~2 min',
      })
    }

    return reply.send({ ok: true })
  })

  // ── Contacts (server-side alias) ─────────────────────────────────────────

  // contact_aliases table is created in PostgreSQL bootstrap (postgres.ts)

  /**
   * GET /v1/account/contacts/aliases — return all server-side aliases for caller
   */
  app.get('/account/contacts/aliases', { preHandler: [requireAuth] }, async (req, reply) => {
    const account = (req as any).account
    const db = getDb()

    const rows = db.prepare(
      `SELECT contact_short_id, alias FROM contact_aliases WHERE owner_short_id = ?`
    ).all(account.short_id) as { contact_short_id: string; alias: string }[]
    const map: Record<string, string> = {}
    for (const r of rows) map[r.contact_short_id] = r.alias
    return reply.send({ aliases: map })
  })

  /**
   * PATCH /v1/account/contacts/:shortId — set/update alias
   */
  app.patch('/account/contacts/:shortId', { preHandler: [requireAuth] }, async (req, reply) => {
    const account = (req as any).account
    const { shortId } = req.params as { shortId: string }
    const { alias } = req.body as { alias?: string }
    if (alias === undefined) return reply.status(400).send({ error: 'alias required' })
    const db = getDb()

    db.prepare(`
      INSERT INTO contact_aliases (owner_short_id, contact_short_id, alias, updated_at)
      VALUES (?, ?, ?, now()::text)
      ON CONFLICT(owner_short_id, contact_short_id) DO UPDATE SET
        alias = excluded.alias, updated_at = excluded.updated_at
    `).run(account.short_id, shortId.toUpperCase(), alias.trim())
    return reply.send({ ok: true })
  })

  /**
   * GET /v1/account/contacts/deleted — return list of deleted contact shortIds
   */
  app.get('/account/contacts/deleted', { preHandler: [requireAuth] }, async (req, reply) => {
    const account = (req as any).account
    const db = getDb()
    const rows = db.prepare(
      `SELECT contact_short_id FROM deleted_contacts WHERE owner_short_id = ?`
    ).all(account.short_id) as { contact_short_id: string }[]
    return reply.send({ deleted: rows.map(r => r.contact_short_id) })
  })

  /**
   * POST /v1/account/contacts/:shortId/delete — soft-delete a contact (record in deleted list)
   */
  app.post('/account/contacts/:shortId/delete', { preHandler: [requireAuth] }, async (req, reply) => {
    const account = (req as any).account
    const { shortId } = req.params as { shortId: string }
    const db = getDb()
    db.prepare(`
      INSERT INTO deleted_contacts (owner_short_id, contact_short_id)
      VALUES (?, ?)
      ON CONFLICT DO NOTHING
    `).run(account.short_id, shortId.toUpperCase())
    return reply.send({ ok: true })
  })

  /**
   * DELETE /v1/account/contacts/:shortId/delete — remove from deleted list (allow re-add)
   */
  app.delete('/account/contacts/:shortId/delete', { preHandler: [requireAuth] }, async (req, reply) => {
    const account = (req as any).account
    const { shortId } = req.params as { shortId: string }
    const db = getDb()
    db.prepare(
      `DELETE FROM deleted_contacts WHERE owner_short_id = ? AND contact_short_id = ?`
    ).run(account.short_id, shortId.toUpperCase())
    return reply.send({ ok: true })
  })

  /**
   * POST /v1/account/payment/:paymentId/claim-now
   * Recipient triggers immediate auto-claim for their incoming payment.
   */
  app.post('/payment/:paymentId/claim-now', { preHandler: [requireAuth] }, async (req, reply) => {
    const account  = (req as any).account
    const { paymentId } = req.params as { paymentId: string }

    // Verify this payment belongs to the caller (recipient)
    const intent = db.prepare(
      `SELECT recipient_short_id FROM payment_intents WHERE payment_id=?`
    ).get(paymentId.replace(/^0x/, '')) as any

    // Also check with 0x prefix
    const intentHex = !intent ? db.prepare(
      `SELECT recipient_short_id FROM payment_intents WHERE payment_id=?`
    ).get(paymentId) as any : intent

    const found = intent ?? intentHex
    if (!found) {
      return reply.status(404).send({ error: 'Payment not found' })
    }
    if (found.recipient_short_id !== account.short_id) {
      return reply.status(403).send({ error: 'Not your payment' })
    }

    const result = await triggerClaimNow(paymentId.replace(/^0x/, ''))
    if (!result.ok) {
      return reply.status(400).send({ error: result.error })
    }
    const msg =
      result.status === 'already-claimed' ? 'Already claimed'
      : result.status === 'in-progress'   ? 'Claim already in progress'
      : 'Claim queued — processing shortly'
    return reply.send({ ok: true, status: result.status, message: msg })
  })

}
