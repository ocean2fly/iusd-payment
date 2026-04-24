/**
 * iPay Admin API — unified admin routes.
 *
 * 1. Payments: query by ID
 * 2. Accounts: query, freeze, delete
 * 3. Gift boxes: register, update, list, delist, remove (TX params for frontend signing)
 * 4. Monitoring: deployer, relayer, treasury, pool balances
 *
 * Auth: JWT via adminAuth.ts (verifyAdminJWT)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDb } from '../../db'
import { getPoolAddress, getGiftPoolAddress, getModuleAddress, getContractConfig } from '../../shared/contract-config'
import { REST_URL, IUSD_FA, DEPLOYER_ADDRESS, RELAYER_ADDRESS, TREASURY_ADDRESS, MODULE_ADDRESS, GIFT_POOL_ADDRESS } from '../../shared/config'
import { bech32 } from 'bech32'
import { verifyAdminJWT } from './auth'
import { fetchAllBoxes, fetchPoolStats } from '../../lib/giftChainQuery'
import { hashPaymentId } from '../../lib/payKeyHash'

// Static upload directory for gift images
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/home/jack_initia_xyz/ipay-deploy/frontend/images/gifts'
const PUBLIC_URL_BASE = process.env.UPLOAD_URL_BASE || 'https://iusd-pay.xyz/images/gifts'

// ── Helpers ──────────────────────────────────────────────────────

function encodeAddress(addr: string): string {
  const hex = addr.replace(/^0x/i, '').padStart(64, '0').toLowerCase()
  return Buffer.from(hex, 'hex').toString('base64')
}

/** Query a view function with one object arg (pool) */
async function queryChainView(moduleName: string, funcName: string, poolAddr: string): Promise<any> {
  const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/${moduleName}/view_functions/${funcName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type_args: [], args: [encodeAddress(poolAddr)] }),
  })
  if (!res.ok) return null
  const json = await res.json() as any
  return json.data ? JSON.parse(json.data) : null
}

/** Query a view function with pool + address args */
async function queryChainView2(moduleName: string, funcName: string, poolAddr: string, addr: string): Promise<any> {
  const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/${moduleName}/view_functions/${funcName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type_args: [], args: [encodeAddress(poolAddr), encodeAddress(addr)] }),
  })
  if (!res.ok) return null
  const json = await res.json() as any
  return json.data ? JSON.parse(json.data) : null
}

/** Query a view function with just an address arg */
async function queryChainViewAddr(moduleName: string, funcName: string, addr: string): Promise<any> {
  const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/${moduleName}/view_functions/${funcName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type_args: [], args: [encodeAddress(addr)] }),
  })
  if (!res.ok) return null
  const json = await res.json() as any
  return json.data ? JSON.parse(json.data) : null
}

/** Convert 0x hex address to bech32 init1... if needed */
function ensureBech32(addr: string): string {
  if (addr.startsWith('init1')) return addr
  if (addr.startsWith('0x') || addr.startsWith('0X')) {
    const hex = addr.slice(2).toLowerCase()
    const words = bech32.toWords(Buffer.from(hex, 'hex'))
    return bech32.encode('init', words)
  }
  return addr
}

async function getBalance(addr: string): Promise<{ init: string; iusd: string }> {
  if (!addr) return { init: '0', iusd: '0' }
  try {
    const bech32Addr = ensureBech32(addr)
    const res = await fetch(`${REST_URL}/cosmos/bank/v1beta1/balances/${bech32Addr}`)
    if (!res.ok) return { init: '0', iusd: '0' }
    const data = await res.json() as any
    let init = '0', iusd = '0'
    for (const b of (data.balances || [])) {
      if (b.denom === 'uinit') init = (parseInt(b.amount) / 1_000_000).toFixed(4)
      const iusdDenom = `move/${IUSD_FA.replace(/^0x/, '')}`
      if (b.denom === iusdDenom || b.denom.includes(IUSD_FA.replace(/^0x/, '').slice(0, 20))) iusd = (parseInt(b.amount) / 1_000_000).toFixed(2)
    }
    return { init, iusd }
  } catch { return { init: '0', iusd: '0' } }
}

async function queryPaymentOnChain(paymentIdHex: string): Promise<any> {
  const module = getModuleAddress()
  const pool = getPoolAddress()
  const poolHex = '0x' + pool.replace(/^0x/i, '').toLowerCase()
  // Chain-side payment_id is sha256(plain) — see lib/payKeyHash.ts
  const pidBytes = Buffer.from(hashPaymentId(paymentIdHex), 'hex')

  // BCS encode: address (32 bytes) + vector<u8> (uleb128 len + bytes)
  const poolBytes = Buffer.from(pool.replace(/^0x/, '').padStart(64, '0'), 'hex')
  const lenBuf = Buffer.from([pidBytes.length])
  const pidBcs = Buffer.concat([lenBuf, pidBytes])

  const url = `${REST_URL}/initia/move/v1/accounts/${module}/modules/pay_v3/view_functions/get_payment`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type_args: [],
      args: [poolBytes.toString('base64'), pidBcs.toString('base64')],
    }),
  })
  if (!res.ok) return null
  const json = await res.json() as any
  return json.data ? JSON.parse(json.data) : null
}

// ── Routes ───────────────────────────────────────────────────────

export async function adminRoutes(app: FastifyInstance) {
  // All admin routes require JWT auth
  app.addHook('preHandler', (req, rep, done) => verifyAdminJWT(req, rep, done))

  // ================================================================
  // 1. PAYMENTS
  // ================================================================

  /** GET /v1/admin/payments/search — search payments by ID or address */
  app.get('/payments/search', async (req: FastifyRequest, reply: FastifyReply) => {
    const { q, type = 'id' } = req.query as { q?: string; type?: string }
    if (!q || !q.trim()) return reply.status(400).send({ error: 'Query parameter q is required' })

    const db = getDb()
    const term = q.trim()

    let rows: any[] = []
    if (type === 'address') {
      // Search by sender or recipient address (partial match)
      const like = `%${term}%`
      rows = db.prepare(`
        SELECT pi.payment_id,
               pi.sender_short_id,
               pi.recipient_short_id,
               pi.amount_micro AS amount,
               pi.auto_claim_status AS status,
               pi.created_at,
               sa.address  AS sender,
               sa.nickname AS sender_nickname,
               ra.address  AS recipient,
               ra.nickname AS recipient_nickname
        FROM payment_intents pi
        LEFT JOIN accounts sa ON sa.short_id = pi.sender_short_id
        LEFT JOIN accounts ra ON ra.short_id = pi.recipient_short_id
        WHERE pi.sender_short_id LIKE ? OR pi.recipient_short_id LIKE ?
           OR sa.address LIKE ? OR ra.address LIKE ?
        ORDER BY created_at DESC LIMIT 50
      `).all(like, like, like, like)
    } else {
      // Search by payment ID (exact or partial)
      const pid = term.replace(/^0x/, '').toLowerCase()
      const like = `%${pid}%`
      rows = db.prepare(`
        SELECT pi.payment_id,
               pi.sender_short_id,
               pi.recipient_short_id,
               pi.amount_micro AS amount,
               pi.auto_claim_status AS status,
               pi.created_at,
               sa.address  AS sender,
               sa.nickname AS sender_nickname,
               ra.address  AS recipient,
               ra.nickname AS recipient_nickname
        FROM payment_intents pi
        LEFT JOIN accounts sa ON sa.short_id = pi.sender_short_id
        LEFT JOIN accounts ra ON ra.short_id = pi.recipient_short_id
        WHERE lower(replace(payment_id, '0x', '')) LIKE ?
        ORDER BY created_at DESC LIMIT 50
      `).all(like)
    }

    return reply.send({ orders: rows, total: rows.length })
  })

  /** GET /v1/admin/payments/:paymentId — query payment by ID (DB + chain) */
  app.get('/payments/:paymentId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { paymentId } = req.params as { paymentId: string }
    const pid = paymentId.replace(/^0x/, '').toLowerCase()

    // DB lookup
    const db = getDb()
    const dbRecord = db.prepare(
      "SELECT * FROM payment_intents WHERE lower(replace(payment_id, '0x', '')) = ?"
    ).get(pid) as any

    // Chain lookup
    let chainData = null
    try {
      chainData = await queryPaymentOnChain(pid)
    } catch {}

    if (!dbRecord && !chainData) {
      return reply.status(404).send({ error: 'Payment not found' })
    }

    return reply.send({ db: dbRecord ?? null, chain: chainData ?? null })
  })

  /** GET /v1/admin/payments — list recent payments from DB */
  app.get('/payments', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = 50, offset = 0 } = req.query as any
    const db = getDb()
    const rows = db.prepare(`
      SELECT pi.payment_id,
             pi.sender_short_id,
             pi.recipient_short_id,
             pi.amount_micro AS amount,
             pi.auto_claim_status AS status,
             pi.created_at,
             sa.address  AS sender,
             sa.nickname AS sender_nickname,
             ra.address  AS recipient,
             ra.nickname AS recipient_nickname
      FROM payment_intents pi
      LEFT JOIN accounts sa ON sa.short_id = pi.sender_short_id
      LEFT JOIN accounts ra ON ra.short_id = pi.recipient_short_id
      ORDER BY pi.created_at DESC
      LIMIT ? OFFSET ?
    `).all(parseInt(limit), parseInt(offset))
    const total = (db.prepare('SELECT COUNT(*) as c FROM payment_intents').get() as any)?.c ?? 0
    return reply.send({ payments: rows, total })
  })

  // ================================================================
  // 2. ACCOUNTS
  // ================================================================

  /** GET /v1/admin/accounts — list accounts */
  app.get('/accounts', async (req: FastifyRequest, reply: FastifyReply) => {
    const { limit = 20, offset = 0, q } = req.query as any
    const db = getDb()

    if (q && q.trim().length >= 2) {
      const term = `%${q.trim()}%`
      const rows = db.prepare(`
        SELECT id, short_id, nickname, address, created_at, frozen_at,
               CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END AS deleted
        FROM accounts WHERE nickname LIKE ? OR short_id LIKE ? OR address LIKE ?
        ORDER BY created_at DESC LIMIT 50
      `).all(term, term, term)
      return reply.send({ accounts: rows })
    }

    const rows = db.prepare(`
      SELECT id, short_id, nickname, address, created_at, frozen_at,
             CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END AS deleted
      FROM accounts ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(parseInt(limit), parseInt(offset))
    const total = (db.prepare('SELECT COUNT(*) as c FROM accounts').get() as any).c
    return reply.send({ accounts: rows, total })
  })

  /** GET /v1/admin/accounts/:shortId — account detail */
  app.get('/accounts/:shortId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { shortId } = req.params as any
    const db = getDb()
    const account = db.prepare(`
      SELECT id, short_id, nickname, address, created_at, updated_at, frozen_at,
             CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END AS deleted
      FROM accounts WHERE short_id = ?
    `).get(shortId) as any
    if (!account) return reply.status(404).send({ error: 'Account not found' })
    return reply.send({ account })
  })

  /** POST /v1/admin/accounts/:shortId/freeze — DB freeze (chain freeze via admin frontend TX) */
  app.post('/accounts/:shortId/freeze', async (req: FastifyRequest, reply: FastifyReply) => {
    const { shortId } = req.params as any
    const { reason } = (req.body ?? {}) as any
    const db = getDb()

    const account = db.prepare('SELECT address FROM accounts WHERE short_id = ?').get(shortId) as any
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    db.prepare('UPDATE accounts SET frozen_at = ? WHERE short_id = ?')
      .run(new Date().toISOString(), shortId)
    db.prepare("UPDATE auth_sessions SET revoked = 1 WHERE address = ? AND revoked = 0")
      .run(account.address)

    return reply.send({ success: true, shortId, frozen: true, reason: reason ?? null })
  })

  /** POST /v1/admin/accounts/:shortId/unfreeze */
  app.post('/accounts/:shortId/unfreeze', async (req: FastifyRequest, reply: FastifyReply) => {
    const { shortId } = req.params as any
    const db = getDb()
    const account = db.prepare('SELECT frozen_at FROM accounts WHERE short_id = ?').get(shortId) as any
    if (!account) return reply.status(404).send({ error: 'Account not found' })
    if (!account.frozen_at) return reply.status(400).send({ error: 'Not frozen' })

    db.prepare('UPDATE accounts SET frozen_at = NULL WHERE short_id = ?').run(shortId)
    return reply.send({ success: true, shortId, frozen: false })
  })

  /** DELETE /v1/admin/accounts/:shortId — soft delete */
  app.delete('/accounts/:shortId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { shortId } = req.params as any
    const db = getDb()
    const existing = db.prepare('SELECT id FROM accounts WHERE short_id = ?').get(shortId)
    if (!existing) return reply.status(404).send({ error: 'Account not found' })
    db.prepare('UPDATE accounts SET deleted_at = ? WHERE short_id = ?')
      .run(new Date().toISOString(), shortId)
    return reply.send({ success: true, shortId })
  })

  /** POST /v1/admin/accounts/:shortId/restore */
  app.post('/accounts/:shortId/restore', async (req: FastifyRequest, reply: FastifyReply) => {
    const { shortId } = req.params as any
    const db = getDb()
    const existing = db.prepare('SELECT deleted_at FROM accounts WHERE short_id = ?').get(shortId) as any
    if (!existing) return reply.status(404).send({ error: 'Account not found' })
    if (!existing.deleted_at) return reply.status(400).send({ error: 'Not deleted' })
    db.prepare('UPDATE accounts SET deleted_at = NULL WHERE short_id = ?').run(shortId)
    return reply.send({ success: true, shortId, restored: true })
  })

  // ================================================================
  // 3. GIFT BOXES (TX params for admin frontend to sign)
  // ================================================================

  const giftPool = () => getGiftPoolAddress()
  const moduleAddr = () => getModuleAddress()

  function giftTxParams(functionName: string, args: Record<string, any>) {
    return {
      moduleAddress: moduleAddr(),
      moduleName: 'gift_v3',
      functionName,
      args: { pool: giftPool(), ...args },
    }
  }

  /** GET /v1/admin/gift/boxes — all boxes from chain + DB metadata merged */
  app.get('/gift/boxes', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const chainBoxes = await fetchAllBoxes()
      const db = getDb()
      // Merge chain data with off-chain metadata
      const merged = chainBoxes.map((box: any) => {
        const meta = db.prepare('SELECT * FROM gift_box_meta WHERE box_id = ?').get(box.box_id) as any
        return {
          ...box,
          meta: meta ? {
            name: meta.name,
            description: meta.description,
            collection: meta.collection,
            image_urls: JSON.parse(meta.image_urls || '[]'),
            source_url: meta.source_url || '',
            featured: meta.featured === true || meta.featured === 1,
            featured_sort: Number(meta.featured_sort ?? 0),
          } : null,
        }
      })
      return reply.send({ boxes: merged })
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  /** POST /v1/admin/gift/box/register */
  app.post('/gift/box/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId, name, amount, feeBps, urls, enabled } = req.body as any
    if (boxId === undefined || !name) return reply.status(400).send({ error: 'boxId and name required' })
    return reply.send({
      txParams: giftTxParams('register_box', {
        boxId, name, amount: amount ?? 0, feeBps: feeBps ?? 50, urls: urls ?? [], enabled: enabled ?? true,
      }),
    })
  })

  /** POST /v1/admin/gift/box/update */
  app.post('/gift/box/update', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId, name, amount, feeBps, urls, enabled } = req.body as any
    if (boxId === undefined) return reply.status(400).send({ error: 'boxId required' })
    return reply.send({ txParams: giftTxParams('update_box', { boxId, name, amount, feeBps, urls, enabled }) })
  })

  /** POST /v1/admin/gift/box/list (enable) */
  app.post('/gift/box/list', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId } = req.body as any
    if (boxId === undefined) return reply.status(400).send({ error: 'boxId required' })
    return reply.send({ txParams: giftTxParams('list_box', { boxId }) })
  })

  /** POST /v1/admin/gift/box/delist (disable) */
  app.post('/gift/box/delist', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId } = req.body as any
    if (boxId === undefined) return reply.status(400).send({ error: 'boxId required' })
    return reply.send({ txParams: giftTxParams('delist_box', { boxId }) })
  })

  /** POST /v1/admin/gift/box/remove */
  app.post('/gift/box/remove', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId } = req.body as any
    if (boxId === undefined) return reply.status(400).send({ error: 'boxId required' })
    return reply.send({ txParams: giftTxParams('remove_box', { boxId }) })
  })

  /** GET /v1/admin/gift/stats */
  app.get('/gift/stats', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.send(await fetchPoolStats())
    } catch (err: any) {
      return reply.status(500).send({ error: err.message })
    }
  })

  // ================================================================
  // 3b. GIFT BOX METADATA (off-chain DB)
  // ================================================================

  /** PUT /v1/admin/gift/meta/:boxId — upsert off-chain metadata */
  app.put('/gift/meta/:boxId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId } = req.params as { boxId: string }
    const { name, description, collection, image_urls, source_url, featured, featured_sort } = req.body as any
    const db = getDb()
    db.prepare(`
      INSERT INTO gift_box_meta (box_id, name, description, collection, image_urls, source_url, featured, featured_sort, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(box_id) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        collection = excluded.collection, image_urls = excluded.image_urls,
        source_url = excluded.source_url, featured = excluded.featured,
        featured_sort = excluded.featured_sort, updated_at = excluded.updated_at
    `).run(
      parseInt(boxId),
      name || '',
      description || '',
      collection || 'other',
      JSON.stringify(image_urls || []),
      source_url || '',
      featured ? true : false,
      parseInt(featured_sort) || 0,
      new Date().toISOString(),
    )
    return reply.send({ success: true, boxId: parseInt(boxId) })
  })

  /** GET /v1/admin/gift/meta/:boxId — get off-chain metadata */
  app.get('/gift/meta/:boxId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId } = req.params as { boxId: string }
    const db = getDb()
    const meta = db.prepare('SELECT * FROM gift_box_meta WHERE box_id = ?').get(parseInt(boxId)) as any
    if (!meta) return reply.status(404).send({ error: 'No metadata for this box' })
    return reply.send({
      box_id: meta.box_id, name: meta.name, description: meta.description,
      collection: meta.collection, image_urls: JSON.parse(meta.image_urls || '[]'),
      source_url: meta.source_url,
    })
  })

  /** DELETE /v1/admin/gift/meta/:boxId — remove off-chain metadata */
  app.delete('/gift/meta/:boxId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { boxId } = req.params as { boxId: string }
    const db = getDb()
    db.prepare('DELETE FROM gift_box_meta WHERE box_id = ?').run(parseInt(boxId))
    return reply.send({ success: true })
  })

  // ================================================================
  // 5. CONFIG — contract addresses for frontend tx building
  // ================================================================

  /** GET /v1/admin/config — contract addresses needed by frontend */
  app.get('/config', async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getContractConfig()
    return reply.send({
      moduleAddress: config.moduleAddress,
      giftPoolAddress: config.giftPoolAddress,
      payPoolAddress: config.poolAddress,
    })
  })

  // ================================================================
  // 6. URL SCRAPER — extract metadata from a URL
  // ================================================================

  /** GET /v1/admin/scrape-url?url=... — fetch title/description/images from URL */
  app.get('/scrape-url', async (req: FastifyRequest, reply: FastifyReply) => {
    const { url } = req.query as { url?: string }
    if (!url) return reply.status(400).send({ error: 'url parameter required' })

    // Special handling for Met Museum URLs
    const metMatch = url.match(/metmuseum\.org\/art\/collection\/search\/(\d+)/)
    if (metMatch) {
      try {
        const objectId = metMatch[1]
        const res = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`,
          { signal: AbortSignal.timeout(10000) })
        const d = await res.json() as any
        if (!d.objectID) throw new Error('Not found')
        const images: string[] = []
        if (d.primaryImage) images.push(d.primaryImage)
        if (d.primaryImageSmall && !images.includes(d.primaryImageSmall)) images.push(d.primaryImageSmall)
        for (const img of (d.additionalImages || [])) { if (!images.includes(img)) images.push(img) }
        return reply.send({
          title: d.title || '',
          description: [d.artistDisplayName, d.objectDate, d.medium, d.culture].filter(Boolean).join(' · '),
          images,
        })
      } catch (err: any) {
        return reply.status(500).send({ error: `Met API failed: ${err.message}` })
      }
    }

    // Generic HTML scraper
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; iPay-Admin/1.0)' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()

      const getTag = (name: string): string => {
        const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
          ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'))
        return m?.[1] ?? ''
      }

      const title = getTag('og:title') || getTag('twitter:title')
        || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
      const description = getTag('og:description') || getTag('description') || getTag('twitter:description') || ''

      // Collect all images: og:image, twitter:image, and large <img> tags
      const images: string[] = []
      const ogImg = getTag('og:image'); if (ogImg) images.push(ogImg)
      const twImg = getTag('twitter:image'); if (twImg && !images.includes(twImg)) images.push(twImg)
      // Extract <img src="..."> from HTML (skip tiny icons/tracking pixels by looking at common patterns)
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
      let m
      while ((m = imgRegex.exec(html)) !== null) {
        const src = m[1]
        if (src && !images.includes(src) && !src.includes('tracking') && !src.includes('pixel')
            && !src.endsWith('.gif') && images.length < 20) {
          const full = src.startsWith('http') ? src : new URL(src, url).href
          images.push(full)
        }
      }

      return reply.send({ title, description, images })
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to fetch URL: ${err.message}` })
    }
  })

  // ================================================================
  // 7. IMAGE UPLOAD — save to static directory
  // ================================================================

  /** POST /v1/admin/upload — multipart image upload, returns public URL */
  app.post('/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const contentType = req.headers['content-type'] || ''

    // Handle base64 JSON upload (simpler for frontend)
    if (contentType.includes('application/json')) {
      const { data, filename } = req.body as { data?: string; filename?: string }
      if (!data) return reply.status(400).send({ error: 'data (base64) required' })

      const match = data.match(/^data:image\/(\w+);base64,(.+)$/)
      if (!match) return reply.status(400).send({ error: 'Invalid base64 image data' })

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
      const buffer = Buffer.from(match[2], 'base64')
      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12)
      const safeName = (filename || 'img').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)
      const fname = `${safeName}_${hash}.${ext}`

      fs.mkdirSync(UPLOAD_DIR, { recursive: true })
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), buffer)

      return reply.send({ url: `${PUBLIC_URL_BASE}/${fname}`, filename: fname })
    }

    return reply.status(400).send({ error: 'Send JSON with { data: "data:image/...;base64,...", filename: "name" }' })
  })

  /** POST /v1/admin/import-image — download external image URL to local CDN */
  app.post('/import-image', async (req: FastifyRequest, reply: FastifyReply) => {
    const { url, boxId, index } = req.body as { url?: string; boxId?: number; index?: number }
    if (!url) return reply.status(400).send({ error: 'url required' })

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < 100) throw new Error('Image too small')

      const contentType = response.headers.get('content-type') || ''
      let ext = 'jpg'
      if (contentType.includes('png')) ext = 'png'
      else if (contentType.includes('gif')) ext = 'gif'
      else if (contentType.includes('webp')) ext = 'webp'
      else {
        const urlExt = url.split('.').pop()?.split('?')[0]?.toLowerCase() || ''
        if (['png','gif','webp','svg'].includes(urlExt)) ext = urlExt
      }

      const fname = boxId != null
        ? `box_${boxId}_${index ?? 0}.${ext}`
        : `img_${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12)}.${ext}`

      fs.mkdirSync(UPLOAD_DIR, { recursive: true })
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), buffer)

      return reply.send({ url: `${PUBLIC_URL_BASE}/${fname}`, filename: fname })
    } catch (e: any) {
      return reply.status(500).send({ error: `Import failed: ${e.message}` })
    }
  })

  // ================================================================
  // 4. MONITORING — balances
  // ================================================================

  /** GET /v1/admin/system-status — alias for monitor */
  app.get('/system-status', async (req: FastifyRequest, reply: FastifyReply) => {
    const config = getContractConfig()
    const db = getDb()

    // Balances
    const [deployerBal, relayerBal, treasuryBal] = await Promise.all([
      getBalance(DEPLOYER_ADDRESS),
      getBalance(RELAYER_ADDRESS),
      getBalance(TREASURY_ADDRESS),
    ])

    // Stats from DB
    const totalPayments = (db.prepare('SELECT COUNT(*) as c FROM payment_intents').get() as any)?.c ?? 0
    const totalVolumeMicro = (db.prepare('SELECT COALESCE(SUM(CAST(amount_micro AS INTEGER)), 0) as s FROM payment_intents').get() as any)?.s ?? 0
    const pendingPayments = (db.prepare("SELECT COUNT(*) as c FROM payment_intents WHERE auto_claim_status IN ('created','processing','pending_claim')").get() as any)?.c ?? 0

    return reply.send({
      timestamp: new Date().toISOString(),
      services: {
        contract: { name: 'Smart Contract', status: 'online', details: { module: MODULE_ADDRESS, pool: config.poolAddress } },
        database: { name: 'Database', status: 'online' },
        backend:  { name: 'Backend API', status: 'online', url: 'https://api.iusd-pay.xyz' },
        admin:    { name: 'Admin Panel', status: 'online', url: 'https://admin.iusd-pay.xyz' },
        relayer:  { name: 'Relayer', status: 'online', details: { address: RELAYER_ADDRESS } },
        frontend: { name: 'Frontend App', status: 'online', url: 'https://iusd-pay.xyz' },
      },
      balances: {
        deployer: deployerBal.init,
        relayer: relayerBal.init,
        treasury: treasuryBal.init,
        treasuryIusd: treasuryBal.iusd,
      },
      stats: {
        totalPayments,
        totalVolume: (totalVolumeMicro / 1_000_000).toFixed(2),
        totalFees: '0',
        pendingPayments,
      },
    })
  })

  /** GET /v1/admin/monitor — full system status: addresses, balances, chain config */
  app.get('/monitor', async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getContractConfig()
    const moduleAddr = MODULE_ADDRESS

    // Balances
    const [payPoolBal, giftPoolBal, deployerBal, relayerBal, treasuryBal] = await Promise.all([
      getBalance(config.poolAddress),
      getBalance(config.giftPoolAddress),
      getBalance(DEPLOYER_ADDRESS),
      getBalance(RELAYER_ADDRESS),
      getBalance(TREASURY_ADDRESS),
    ])

    // Chain config queries (best effort)
    let payPoolConfig = null
    let giftPoolConfig = null
    let payRelayerSponsor = null
    let giftRelayerSponsor = null
    let freezeAdmin = null

    try {
      payPoolConfig = await queryChainView('pay_v3', 'get_pool_config', config.poolAddress)
    } catch {}
    try {
      giftPoolConfig = await queryChainView('gift_v3', 'get_pool_config', config.giftPoolAddress)
    } catch {}
    try {
      payRelayerSponsor = await queryChainView2('pay_v3', 'is_sponsor', config.poolAddress, RELAYER_ADDRESS)
    } catch {}
    try {
      giftRelayerSponsor = await queryChainView2('gift_v3', 'is_sponsor', config.giftPoolAddress, RELAYER_ADDRESS)
    } catch {}
    try {
      freezeAdmin = await queryChainViewAddr('pay_v3', 'is_freeze_admin', DEPLOYER_ADDRESS)
    } catch {}

    // Gift pool stats
    let giftStats = null
    try {
      giftStats = await fetchPoolStats()
    } catch {}

    return reply.send({
      module: moduleAddr,
      payPool:  { address: config.poolAddress, balance: payPoolBal, chainConfig: payPoolConfig },
      giftPool: { address: config.giftPoolAddress, balance: giftPoolBal, chainConfig: giftPoolConfig, stats: giftStats },
      deployer: { address: DEPLOYER_ADDRESS, balance: deployerBal },
      relayer:  { address: RELAYER_ADDRESS, balance: relayerBal, sponsor: { pay: payRelayerSponsor, gift: giftRelayerSponsor } },
      treasury: { address: TREASURY_ADDRESS, balance: treasuryBal },
      freeze:   { adminCheck: freezeAdmin },
    })
  })
  // ================================================================
  // POOL MANAGEMENT — balance, locked funds, emergency withdraw
  // ================================================================

  /** GET /v1/admin/pool/balance — pool balances + locked amounts */
  app.get('/pool/balance', { preHandler: verifyAdminJWT }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getContractConfig()
    const db = getDb()

    // Get pool balances from chain
    const [payBal, giftBal] = await Promise.all([
      getBalance(config.poolAddress),
      getBalance(config.giftPoolAddress),
    ])

    // Get pool stats from chain
    const [payStats, giftStats] = await Promise.all([
      queryChainView('pay_v3', 'get_pool_stats', config.poolAddress),
      queryChainView('gift_v3', 'get_pool_stats', config.giftPoolAddress),
    ])

    // Calculate locked amounts from DB (active packets)
    const payLocked = db.prepare(`
      SELECT COALESCE(SUM(CAST(amount_micro AS BIGINT)), 0) as total
      FROM payment_intents
      WHERE auto_claim_status IN ('pending', 'failed', 'processing')
    `).get() as any

    const giftLocked = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM gift_v3_packets
      WHERE status = 'active'
    `).get() as any

    const payLockedIusd = Number(payLocked?.total ?? 0) / 1e6
    const giftLockedIusd = Number(giftLocked?.total ?? 0) / 1e6
    const payBalIusd = parseFloat(payBal.iusd) || 0
    const giftBalIusd = parseFloat(giftBal.iusd) || 0

    return reply.send({
      pay: {
        pool: config.poolAddress,
        balance: payBal,
        balanceIusd: payBalIusd,
        lockedIusd: payLockedIusd,
        withdrawableIusd: Math.max(0, payBalIusd - payLockedIusd),
        stats: payStats ? {
          totalPayments: Number(payStats[0] ?? 0),
          totalVolume: Number(payStats[1] ?? 0) / 1e6,
          totalFees: Number(payStats[2] ?? 0) / 1e6,
        } : null,
      },
      gift: {
        pool: config.giftPoolAddress,
        balance: giftBal,
        balanceIusd: giftBalIusd,
        lockedIusd: giftLockedIusd,
        withdrawableIusd: Math.max(0, giftBalIusd - giftLockedIusd),
        stats: giftStats ? {
          owner: giftStats[0],
          treasury: giftStats[1],
          cap: Number(giftStats[2] ?? 0) / 1e6,
          totalGifts: Number(giftStats[3] ?? 0),
          totalVolume: Number(giftStats[4] ?? 0) / 1e6,
          totalFees: Number(giftStats[5] ?? 0) / 1e6,
        } : null,
      },
    })
  })

  /** POST /v1/admin/pool/withdraw — build emergency_withdraw TX params */
  app.post('/pool/withdraw', { preHandler: verifyAdminJWT }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { poolType, amount, toAddress } = req.body as {
      poolType: 'pay' | 'gift'
      amount: number       // iUSD (not micro)
      toAddress?: string   // defaults to treasury
    }

    if (!poolType || !amount || amount <= 0) {
      return reply.status(400).send({ error: 'poolType and amount required' })
    }

    const config = getContractConfig()
    const pool = poolType === 'pay' ? config.poolAddress : config.giftPoolAddress
    const moduleName = poolType === 'pay' ? 'pay_v3' : 'gift_v3'
    const to = toAddress || TREASURY_ADDRESS
    const amountMicro = Math.round(amount * 1e6)

    return reply.send({
      ok: true,
      txParams: {
        moduleAddress: MODULE_ADDRESS,
        moduleName,
        functionName: 'emergency_withdraw',
        args: {
          pool,
          to,
          amount: amountMicro,
        },
      },
      summary: {
        from: `${poolType} pool (${pool.slice(0, 10)}...)`,
        to: to.startsWith('init1') ? to : `0x${to.slice(0, 10)}...`,
        amount: `${amount.toFixed(2)} iUSD`,
        amountMicro,
      },
    })
  })
}

export default adminRoutes
