/**
 * Invoice token system
 * POST /v1/invoice/register            — register token + all invoice data (auth)
 * POST /v1/invoice/:token/revoke       — revoke token (auth, owner only)
 * GET  /v1/invoice/:token              — get full invoice data (public)
 *
 * Invoice → Payment mapping (Fix ①):
 * POST /v1/invoice/:token/link-payment — record payment_id for this invoice (auth)
 * GET  /v1/invoice/:token/payment      — get linked payment_id + chain status (auth, owner)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createHash, randomBytes } from 'crypto'
import { getDb } from '../../db'
import { requireAuth } from '../../middleware/auth'
import { triggerClaimNow } from '../../services/relayer/autoClaim'
import { chainStatusLabel, chainStatusShort } from '../../lib/chainStatus'
import { IPAY_POOL_ADDRESS, MODULE_ADDRESS, REST_URL } from '../../shared/config'
import { hashPaymentId } from '../../lib/payKeyHash'

function uleb128(n: number): Buffer {
  const bytes: number[] = []
  do { let b = n & 0x7f; n >>= 7; if (n > 0) b |= 0x80; bytes.push(b) } while (n > 0)
  return Buffer.from(bytes)
}

async function queryChainStatus(paymentId: string): Promise<number | null> {
  try {
    // Chain-side payment_id is sha256(plain) — see lib/payKeyHash.ts
    const idBytes = Buffer.from(hashPaymentId(paymentId), 'hex')
    const bcsId = Buffer.concat([uleb128(idBytes.length), idBytes]).toString('base64')
    const bcsPay = Buffer.from(IPAY_POOL_ADDRESS.replace(/^0x/i, '').padStart(64, '0'), 'hex').toString('base64')
    const viewUrl = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/pay_v3/view_functions/get_payment`
    const resp = await fetch(viewUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [bcsPay, bcsId] }),
    })
    if (!resp.ok) return null
    const data = await resp.json() as any
    try {
      const raw = JSON.parse(data?.data)
      return Array.isArray(raw) ? Number(raw[0]) : Number(raw)
    } catch {
      return Number(data?.data ?? null)
    }
  } catch { return null }
}

function ensureTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_tokens (
      token              TEXT PRIMARY KEY,
      owner_short_id     TEXT NOT NULL,
      invoice_no         TEXT,
      created_at         TEXT DEFAULT (now()::text),
      revoked_at         TEXT,
      recipient_short_id TEXT,
      amount             TEXT,
      fee_mode           TEXT DEFAULT 'sender',
      note               TEXT,
      merchant           TEXT,
      due_date           TEXT
    )
  `)
  // Add new columns if table already exists (migration)
  let cols: string[]
  try {
    cols = (db.prepare(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'invoice_tokens'`
    ).all() as any[]).map((c: any) => c.column_name ?? c.name)
  } catch {
    cols = []
  }
  for (const [col, def] of [
    ['recipient_short_id', 'TEXT'],
    ['amount',             'TEXT'],
    ['fee_mode',           "TEXT DEFAULT 'sender'"],
    ['note',               'TEXT'],
    ['merchant',           'TEXT'],
    ['due_date',           'TEXT'],
    ['status',             "TEXT DEFAULT 'draft'"],
    ['paid_at',            'TEXT'],
    ['tx_hash',            'TEXT'],
    ['payment_id',         'TEXT'],
    ['claim_key',          'TEXT'],
    ['refund_key',         'TEXT'],
  ] as [string, string][]) {
    if (!cols.includes(col)) {
      try { db.exec(`ALTER TABLE invoice_tokens ADD COLUMN ${col} ${def}`) } catch {}
    }
  }

  // Invoice → Payment mapping table
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      invoice_token TEXT PRIMARY KEY,
      payment_id    TEXT NOT NULL,
      payer_address TEXT,
      amount_micro  TEXT,
      linked_at     TEXT DEFAULT (now()::text)
    )
  `)

  // Unified projection used by UI so invoice/payment are one entity
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_transactions (
      invoice_token TEXT PRIMARY KEY,
      invoice_no    TEXT,
      owner_short_id TEXT NOT NULL,
      recipient_short_id TEXT,
      amount        TEXT,
      fee_mode      TEXT DEFAULT 'recipient',
      status        TEXT DEFAULT 'draft',
      payment_id    TEXT,
      payer_address TEXT,
      amount_micro  TEXT,
      chain_status  INTEGER,
      created_at    TEXT DEFAULT (now()::text),
      updated_at    TEXT DEFAULT (now()::text),
      paid_at       TEXT,
      revoked_at    TEXT,
      tx_hash       TEXT,
      note          TEXT,
      merchant      TEXT,
      due_date      TEXT
    )
  `)
}

function pick<T extends Record<string, any>>(obj: T, keys: string[]) {
  const out: Record<string, any> = {}
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  return out
}

function sanitizeMerchant(merchant: any) {
  if (!merchant || typeof merchant !== 'object') return null
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

export async function invoiceRoutes(app: FastifyInstance) {

  // ── Token registration ──────────────────────────────────────────────────

  /**
   * POST /v1/invoice/register
   * Stores invoice token + all display data server-side.
   * PayLink becomes: /pay/{token} — short + tamper-proof.
   */
  app.post('/invoice/register', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const account = (req as any).account
    const {
      token, invoiceNo,
      recipientShortId, amount, feeMode, note, merchant, dueDate, invoiceMode,
    } = req.body as {
      token:            string
      invoiceNo?:       string
      recipientShortId?: string
      amount?:          string
      feeMode?:         string
      note?:            string
      merchant?:        string
      dueDate?:         string
      invoiceMode?:     string
    }
    if (!token || token.length < 8) return reply.status(400).send({ error: 'invalid token' })
    // Derive mode: explicit > merchant present > personal
    const resolvedMode = invoiceMode ?? (merchant ? 'business' : 'personal')

    // Generate fixed payment_id + keys for this invoice (prevents duplicate payments)
    const paymentIdHex = randomBytes(32).toString('hex')
    const claimKeyHex  = randomBytes(32).toString('hex')
    const refundKeyHex = randomBytes(32).toString('hex')

    db.prepare(`
      INSERT INTO invoice_tokens
        (token, owner_short_id, invoice_no, recipient_short_id, amount, fee_mode, note, merchant, due_date, invoice_mode, status, payment_id, claim_key, refund_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT status FROM invoice_tokens WHERE token=?),'sent'),?,?,?)
      ON CONFLICT(token) DO UPDATE SET
        owner_short_id = excluded.owner_short_id,
        invoice_no = excluded.invoice_no,
        recipient_short_id = excluded.recipient_short_id,
        amount = excluded.amount,
        fee_mode = excluded.fee_mode,
        note = excluded.note,
        merchant = excluded.merchant,
        due_date = excluded.due_date,
        invoice_mode = excluded.invoice_mode,
        status = excluded.status
    `).run(
      token, account?.short_id, invoiceNo ?? null,
      recipientShortId ?? account?.short_id,
      amount ?? null, feeMode ?? 'sender', note ?? null, merchant ?? null, dueDate ?? null,
      resolvedMode,
      token,
      paymentIdHex, claimKeyHex, refundKeyHex,
    )

    db.prepare(`
      INSERT INTO invoice_transactions
      (invoice_token, invoice_no, owner_short_id, recipient_short_id, amount, fee_mode, status, created_at, updated_at, note, merchant, due_date)
      VALUES (?,?,?,?,? ,?,?,now()::text,now()::text,?,?,?)
      ON CONFLICT(invoice_token) DO UPDATE SET
        invoice_no=excluded.invoice_no,
        recipient_short_id=excluded.recipient_short_id,
        amount=excluded.amount,
        fee_mode=excluded.fee_mode,
        note=excluded.note,
        merchant=excluded.merchant,
        due_date=excluded.due_date,
        updated_at=now()::text
    `).run(
      token, invoiceNo ?? null, account?.short_id,
      recipientShortId ?? account?.short_id,
      amount ?? null, feeMode ?? 'sender', 'sent',
      note ?? null, merchant ?? null, dueDate ?? null,
    )

    return reply.send({ ok: true, payLink: `https://iusd-pay.xyz/pay/${token}` })
  })

  // ── Revoke ──────────────────────────────────────────────────────────────

  app.post('/invoice/:token/revoke', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { token } = req.params as { token: string }
    const account = (req as any).account
    let row = db.prepare('SELECT * FROM invoice_tokens WHERE token = ?').get(token) as any
    if (!row) {
      // 旧发票（表创建前）自动注册再撤销
      db.prepare('INSERT INTO invoice_tokens (token, owner_short_id, invoice_no) VALUES (?,?,?) ON CONFLICT DO NOTHING')
        .run(token, account?.short_id, null)
      row = db.prepare('SELECT * FROM invoice_tokens WHERE token = ?').get(token) as any
    }
    if (row.owner_short_id !== account?.short_id) return reply.status(403).send({ error: 'forbidden' })
    if (row.revoked_at) return reply.status(410).send({ error: 'already cancelled' })
    db.prepare("UPDATE invoice_tokens SET revoked_at = now()::text, status='cancelled' WHERE token = ?").run(token)
    db.prepare("UPDATE invoice_transactions SET revoked_at=now()::text, status='cancelled', updated_at=now()::text WHERE invoice_token=?").run(token)
    return reply.send({ ok: true })
  })

  // ── Public invoice info ─────────────────────────────────────────────────

  /**
   * GET /v1/invoice/:token
   * Returns full invoice data (tamper-proof, from DB).
   * Public — payer does not need to be logged in to fetch.
   */
  app.get('/invoice/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { token } = req.params as { token: string }
    const row = db.prepare('SELECT * FROM invoice_tokens WHERE token = ?').get(token) as any
    if (!row) return reply.send({ status: 'unknown' })

    // Check if there is already a linked payment and query its on-chain status
    const payRow = db.prepare(
      'SELECT payment_id FROM invoice_payments WHERE invoice_token = ?'
    ).get(token) as any

    let chainStatus: number | null = null
    if (payRow?.payment_id) {
      chainStatus = await queryChainStatus(payRow.payment_id)
      if (chainStatus === 3) {
        db.prepare(`UPDATE invoice_tokens SET status='paid', paid_at=coalesce(paid_at, now()::text) WHERE token=?`).run(token)
        db.prepare(`UPDATE invoice_transactions SET status='paid', chain_status=3, paid_at=coalesce(paid_at, now()::text), updated_at=now()::text WHERE invoice_token=?`).run(token)
      } else if (chainStatus === 2) {
        db.prepare(`UPDATE invoice_tokens SET status='paying' WHERE token=? AND status NOT IN ('paid','cancelled')`).run(token)
        db.prepare(`UPDATE invoice_transactions SET status='paying', chain_status=2, updated_at=now()::text WHERE invoice_token=?`).run(token)
      }
    }

    return reply.send({
      status:            row.revoked_at ? 'revoked' : 'active',
      revokedAt:         row.revoked_at ?? null,
      invoiceNo:         row.invoice_no ?? null,
      recipientShortId:  row.recipient_short_id ?? null,
      amount:            row.amount ?? null,
      feeMode:           row.fee_mode ?? 'sender',
      note:              row.note ?? null,
      merchant:          row.merchant ?? null,
      dueDate:           row.due_date ?? null,
      createdAt:         row.created_at,
      chainStatus,          // null = no payment yet; 2 = pending; 3 = confirmed/paid
      paymentId:         payRow?.payment_id ?? null,
    })
  })


  /**
   * GET /v1/paylink/:token/resolve
   * Aggregated endpoint for faster PayLink first paint.
   */
  app.get('/paylink/:token/resolve', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { token } = req.params as { token: string }
    const row = db.prepare('SELECT * FROM invoice_tokens WHERE token = ?').get(token) as any
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND' })
    if (row.revoked_at) {
      // Return full invoice context even for cancelled invoices so frontend can display details
      const cancelAccount = db.prepare('SELECT short_id, nickname, avatar_svg, short_seal_svg FROM accounts WHERE short_id=?')
        .get(row.recipient_short_id) as any
      return reply.status(410).send({
        error: 'CANCELLED',
        token,
        invoiceNo: row.invoice_no ?? null,
        recipientShortId: row.recipient_short_id ?? null,
        amount: row.amount ?? null,
        feeMode: row.fee_mode ?? 'recipient',
        note: row.note ?? null,
        merchant: row.merchant ?? null,
        invoiceMode: row.invoice_mode ?? (row.merchant ? 'business' : 'personal'),
        dueDate: row.due_date ?? null,
        status: 'cancelled',
        recipient: cancelAccount ? {
          shortId: cancelAccount.short_id,
          nickname: cancelAccount.nickname,
          avatarSvg: cancelAccount.avatar_svg ?? null,
          shortSealSvg: cancelAccount.short_seal_svg ?? null,
        } : null,
      })
    }

    const account = db.prepare('SELECT short_id, nickname, avatar_svg, short_seal_svg FROM accounts WHERE short_id=?')
      .get(row.recipient_short_id) as any
    if (!account) return reply.status(404).send({ error: 'RECIPIENT_NOT_FOUND' })

    const vp = db.prepare('SELECT pubkey FROM accounts WHERE short_id=?').get(row.recipient_short_id) as any

    // Check if payment already exists (linked or pre-generated)
    let paymentId: string | null = row.payment_id ?? null
    let claimKey: string | null  = row.claim_key ?? null
    let refundKey: string | null = row.refund_key ?? null
    let chainStatus: number | null = null

    // Also check invoice_payments for legacy linkage
    const payRow = db.prepare('SELECT payment_id FROM invoice_payments WHERE invoice_token=?').get(token) as any
    if (payRow?.payment_id) {
      const linkedId = payRow.payment_id as string
      chainStatus = await queryChainStatus(linkedId)
      if (!paymentId) paymentId = linkedId
    } else if (paymentId) {
      chainStatus = await queryChainStatus(paymentId)
    }

    return reply.send({
      token,
      invoiceNo: row.invoice_no ?? null,
      recipientShortId: row.recipient_short_id ?? null,
      amount: row.amount ?? null,
      feeMode: row.fee_mode ?? 'recipient',
      note: row.note ?? null,
      merchant: row.merchant ?? null,
      invoiceMode: row.invoice_mode ?? (row.merchant ? 'business' : 'personal'),
      dueDate: row.due_date ?? null,
      recipient: {
        shortId: account.short_id,
        nickname: account.nickname,
        avatarSvg: account.avatar_svg ?? null,
        shortSealSvg: account.short_seal_svg ?? null,
      },
      viewingPubkey: vp?.pubkey ?? null,
      paymentId,
      claimKey,
      refundKey,
      chainStatus,
    })
  })

  // ── Invoice → Payment mapping ───────────────────────────────────────────

  app.post('/invoice/:token/link-payment', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { token } = req.params as { token: string }
    const { paymentId, payerAddress, amountMicro } = req.body as {
      paymentId:    string
      payerAddress: string
      amountMicro?: string
    }
    if (!paymentId || paymentId.length < 16) return reply.status(400).send({ error: 'invalid paymentId' })

    let tokenRow = db.prepare('SELECT revoked_at, owner_short_id FROM invoice_tokens WHERE token = ?').get(token) as any
    if (!tokenRow) {
      // Auto-register unknown tokens (handles DB-reset scenario + pre-table invoices)
      try {
        const account = (req as any).account
        db.prepare(`INSERT INTO invoice_tokens (token, owner_short_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
        ).run(token, account?.short_id ?? null)
        tokenRow = { revoked_at: null, owner_short_id: account?.short_id ?? null }
      } catch {
        return reply.status(404).send({ error: 'invoice token not found' })
      }
    }
    if (tokenRow.revoked_at) return reply.status(410).send({ error: 'invoice already cancelled' })

    // Look up recipient's global auto-claim preference
    const recipientAutoClaimRow = tokenRow.owner_short_id
      ? db.prepare('SELECT auto_claim_enabled FROM accounts WHERE short_id = ?').get(tokenRow.owner_short_id) as any
      : null
    const recipientAutoClaimEnabled = !!recipientAutoClaimRow?.auto_claim_enabled

    db.prepare(`
      INSERT INTO invoice_payments (invoice_token, payment_id, payer_address, amount_micro)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(invoice_token) DO UPDATE SET
        payment_id = excluded.payment_id,
        payer_address = excluded.payer_address,
        amount_micro = excluded.amount_micro,
        linked_at = now()::text
    `).run(token, paymentId, payerAddress ?? null, amountMicro ?? null)

    db.prepare(`
      UPDATE invoice_transactions
      SET payment_id=?, payer_address=?, amount_micro=?, status='paying', updated_at=now()::text
      WHERE invoice_token=?
    `).run(paymentId, payerAddress ?? null, amountMicro ?? null, token)

    // Set auto-claim timing based on recipient's GLOBAL auto_claim_enabled setting.
    // UPSERT: creates record if payment-intent hasn't arrived yet; on conflict keeps the
    // earlier auto_claim_at so the immediate 'now' is never overridden by the +90s window.
    try {
      const invoiceType = recipientAutoClaimEnabled ? 'merchant' : 'personal'
      const claimAt     = recipientAutoClaimEnabled ? "now()::text" : "(now() + interval '14 days')::text"
      db.prepare(`
        INSERT INTO payment_intents (payment_id, invoice_type, auto_claim_at, auto_claim_status)
        VALUES (?, ?, ${claimAt}, 'pending')
        ON CONFLICT(payment_id) DO UPDATE SET
          invoice_type  = ?,
          auto_claim_at = CASE
            WHEN ? = 'merchant' AND auto_claim_at::timestamp > (now() + interval '5 seconds')
              THEN now()::text
            WHEN ? = 'personal'
              THEN (now() + interval '14 days')::text
            ELSE auto_claim_at
          END
      `).run(paymentId, invoiceType, invoiceType, invoiceType, invoiceType)

      if (recipientAutoClaimEnabled) {
        triggerClaimNow(paymentId).catch(() => {})
      }
    } catch { /* non-fatal */ }

    // Immediately check chain status and update invoice/invoice_transactions
    setImmediate(async () => {
      try {
        const status = await queryChainStatus(paymentId)
        if (status === 3) {
          db.prepare(`UPDATE invoice_tokens SET status='paid', paid_at=now()::text WHERE token=?`).run(token)
          db.prepare(`UPDATE invoice_transactions SET status='paid', chain_status=3, paid_at=now()::text, updated_at=now()::text WHERE invoice_token=?`).run(token)
        } else if (status === 2) {
          db.prepare(`UPDATE invoice_tokens SET status='paying' WHERE token=? AND status NOT IN ('paid','cancelled')`).run(token)
          db.prepare(`UPDATE invoice_transactions SET status='paying', chain_status=2, updated_at=now()::text WHERE invoice_token=?`).run(token)
        }
      } catch { /* non-fatal */ }
    })

    return reply.send({ ok: true })
  })

  app.get('/invoice/:token/payment', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { token } = req.params as { token: string }

    const row = db.prepare(
      'SELECT ip.payment_id, ip.payer_address, ip.amount_micro, ip.linked_at ' +
      'FROM invoice_payments ip WHERE ip.invoice_token = ?'
    ).get(token) as any

    if (!row) return reply.send({ linked: false })

    let chainStatus: number | null = null
    try {
      chainStatus = await queryChainStatus(row.payment_id as string)
    } catch {}

    return reply.send({
      linked:         true,
      paymentId:      row.payment_id,
      payerAddress:   row.payer_address,
      amountMicro:    row.amount_micro,
      linkedAt:       row.linked_at,
      chainStatus,
      chainStatusStr: chainStatusShort(chainStatus),
    })
  })
}


// ── Account invoice list (DB-backed, replaces localStorage) ──────────────

/**
 * GET /v1/account/invoices
 * Returns all invoices owned by the authenticated user, newest first.
 */
export async function registerAccountInvoiceRoutes(app: any) {
  const { requireAuth } = await import('../../middleware/auth')
  const { getDb }       = await import('../../db/index')

  app.get('/account/invoices', { preHandler: requireAuth }, async (req: any, reply: any) => {
    const db = getDb()
    const account = req.account as any

    // backfill projection table (idempotent)
    db.prepare(`
      INSERT INTO invoice_transactions
      (invoice_token, invoice_no, owner_short_id, recipient_short_id, amount, fee_mode, status, created_at, updated_at, paid_at, revoked_at, tx_hash, note, merchant, due_date, payment_id, payer_address, amount_micro)
      SELECT it.token, it.invoice_no, it.owner_short_id, it.recipient_short_id, it.amount, it.fee_mode,
             COALESCE(it.status,'draft'), COALESCE(it.created_at, now()::text), now()::text, it.paid_at, it.revoked_at, it.tx_hash, it.note, it.merchant, it.due_date,
             ip.payment_id, ip.payer_address, ip.amount_micro
      FROM invoice_tokens it
      LEFT JOIN invoice_payments ip ON ip.invoice_token = it.token
      WHERE it.owner_short_id = ?
      ON CONFLICT DO NOTHING
    `).run(account.short_id)

    // keep payment mapping synced for existing projection rows
    db.prepare(`
      UPDATE invoice_transactions
      SET payment_id = COALESCE(payment_id, (SELECT ip.payment_id FROM invoice_payments ip WHERE ip.invoice_token = invoice_transactions.invoice_token)),
          payer_address = COALESCE(payer_address, (SELECT ip.payer_address FROM invoice_payments ip WHERE ip.invoice_token = invoice_transactions.invoice_token)),
          amount_micro = COALESCE(amount_micro, (SELECT ip.amount_micro FROM invoice_payments ip WHERE ip.invoice_token = invoice_transactions.invoice_token)),
          updated_at = now()::text
      WHERE owner_short_id = ?
    `).run(account.short_id)

    const rows = db.prepare(`
      SELECT tx.*,
             ip.sender_short_id AS payer_short_id_from_pi,
             a_payer.nickname   AS payer_nickname_from_pi
      FROM invoice_transactions tx
      LEFT JOIN payment_intents ip
        ON lower(replace(tx.payment_id,'0x','')) = lower(replace(ip.payment_id,'0x',''))
      LEFT JOIN accounts a_payer ON a_payer.short_id = ip.sender_short_id
      WHERE tx.owner_short_id = ?
      ORDER BY tx.created_at DESC
      LIMIT 200
    `).all(account.short_id) as any[]

    // refresh chain status for linked payments so UI never stays stale
    for (const r of rows) {
      if (!r.payment_id) continue
      const cs = await queryChainStatus(String(r.payment_id))
      if (cs == null) continue
      if (cs === 3 && r.status !== 'paid') {
        db.prepare(`UPDATE invoice_transactions SET status='paid', chain_status=3, paid_at=coalesce(paid_at, now()::text), updated_at=now()::text WHERE invoice_token=?`).run(r.invoice_token)
        db.prepare(`UPDATE invoice_tokens SET status='paid', paid_at=coalesce(paid_at, now()::text) WHERE token=?`).run(r.invoice_token)
        r.status = 'paid'; r.chain_status = 3; r.paid_at = r.paid_at ?? new Date().toISOString()
      } else if (cs === 2 && r.status !== 'paying' && r.status !== 'paid') {
        db.prepare(`UPDATE invoice_transactions SET status='paying', chain_status=2, updated_at=now()::text WHERE invoice_token=?`).run(r.invoice_token)
        db.prepare(`UPDATE invoice_tokens SET status='paying' WHERE token=? AND status NOT IN ('paid','cancelled')`).run(r.invoice_token)
        r.status = 'paying'; r.chain_status = 2
      }
    }

    return reply.send({
      invoices: rows.map(r => ({
        id:              r.invoice_token,
        invoiceToken:    r.invoice_token,
        invoiceNo:       r.invoice_no ?? '',
        amount:          r.amount ? parseFloat(r.amount) : 0,
        dueDate:         r.due_date ?? '',
        note:            r.note ?? '',
        taxNum:          '',
        payerShortId:    r.payer_short_id_from_pi ?? r.payer_short_id ?? null,
        payerName:       r.payer_name ?? r.payer_nickname_from_pi ?? null,
        status:          r.revoked_at ? 'cancelled' : (r.status ?? 'draft'),
        payLink:         `https://iusd-pay.xyz/pay/${r.invoice_token}`,
        createdAt:       r.created_at,
        sentAt:          null,
        paidAt:          r.paid_at ?? null,
        txHash:          r.tx_hash ?? null,
        myShortId:       r.owner_short_id,
        revokedAt:       r.revoked_at ?? null,
        invoiceMode:     r.invoice_mode ?? (r.merchant ? 'business' : 'personal'),
        feeMode:         r.fee_mode ?? 'recipient',
        merchant:        r.merchant ?? null,
        paymentId:       r.payment_id ?? null,
        amountMicro:     r.amount_micro ?? (r.amount ? String(Math.round(parseFloat(r.amount) * 1_000_000)) : null),
      }))
    })
  })

  /**
   * PATCH /v1/invoice/:token/status
   * Update invoice status, paidAt, txHash, etc.
   */
  app.patch('/invoice/:token/status', { preHandler: requireAuth }, async (req: any, reply: any) => {
    const db = getDb()
    const account = req.account as any
    const { token } = req.params as { token: string }
    const { status, paidAt, txHash, sentAt, payerShortId, payerName } = req.body as any

    const row = db.prepare('SELECT owner_short_id FROM invoice_tokens WHERE token=?').get(token) as any
    if (!row) return reply.status(404).send({ error: 'NOT_FOUND' })
    if (row.owner_short_id !== account.short_id) return reply.status(403).send({ error: 'FORBIDDEN' })

    const updates: string[] = []
    const vals: any[] = []
    if (status       !== undefined) { updates.push('status=?');        vals.push(status) }
    if (paidAt       !== undefined) { updates.push('paid_at=?');       vals.push(paidAt) }
    if (txHash       !== undefined) { updates.push('tx_hash=?');       vals.push(txHash) }
    if (sentAt       !== undefined) { updates.push('sent_at=?');       vals.push(sentAt) }
    if (payerShortId !== undefined) { updates.push('payer_short_id=?'); vals.push(payerShortId) }
    if (payerName    !== undefined) { updates.push('payer_name=?');    vals.push(payerName) }
    if (updates.length === 0) return reply.send({ ok: true })

    vals.push(token)
    db.prepare(`UPDATE invoice_tokens SET ${updates.join(',')} WHERE token=?`).run(...vals)

    const txUpdates: string[] = []
    const txVals: any[] = []
    if (status !== undefined) { txUpdates.push('status=?'); txVals.push(status) }
    if (paidAt !== undefined) { txUpdates.push('paid_at=?'); txVals.push(paidAt) }
    if (txHash !== undefined) { txUpdates.push('tx_hash=?'); txVals.push(txHash) }
    if (txUpdates.length > 0) {
      txVals.push(token)
      db.prepare(`UPDATE invoice_transactions SET ${txUpdates.join(',')}, updated_at=now()::text WHERE invoice_token=?`).run(...txVals)
    }
    return reply.send({ ok: true })
  })

  /**
   * POST /v1/invoice/sync
   * Bulk-import invoices from localStorage (one-time migration).
   * Inserts missing tokens; skips existing ones.
   */
  app.post('/invoice/sync', { preHandler: requireAuth }, async (req: any, reply: any) => {
    const db = getDb()
    const account = req.account as any
    const { invoices } = req.body as { invoices: any[] }
    if (!Array.isArray(invoices)) return reply.status(400).send({ error: 'invoices[] required' })

    let imported = 0
    const stmt = db.prepare(`
      INSERT INTO invoice_tokens
        (token, owner_short_id, invoice_no, amount, due_date, note, tax_num,
         payer_short_id, payer_name, status, pay_link, created_at, sent_at,
         paid_at, tx_hash, revoked_at, invoice_mode, fee_mode, merchant)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT DO NOTHING
    `)
    for (const inv of invoices.slice(0, 500)) {
      const token = inv.invoiceToken ?? inv.id
      if (!token || token.length < 16) continue
      try {
        stmt.run(
          token, account.short_id,
          inv.invoiceNo ?? null,
          inv.amount != null ? String(inv.amount) : null,
          inv.dueDate ?? null,
          inv.note ?? null,
          inv.taxNum ?? null,
          inv.payerShortId ?? null,
          inv.payerName ?? null,
          inv.status ?? 'draft',
          inv.payLink ?? null,
          inv.createdAt ?? new Date().toISOString(),
          inv.sentAt ?? null,
          inv.paidAt ?? null,
          inv.txHash ?? null,
          inv.revokedAt ?? null,
          inv.invoiceMode ?? 'personal',
          inv.feeMode ?? 'recipient',
          inv.merchant ?? null,
        )
        imported++
      } catch {}
    }
    return reply.send({ ok: true, imported })
  })

  /**
   * GET /v1/invoice/chain/payment-status?paymentId=<hex>
   * Lightweight no-auth endpoint: returns on-chain chainStatus for a payment_id.
   * Used by InBox to pre-check if a payment is still PENDING_CLAIM before signing.
   */
  /**
   * GET /v1/invoice/:token/public-view
   * Public (no auth) — returns all data needed to render a printable invoice page.
   * Safe: merchant profile is already public; payer shown as privacy ID only.
   */
  app.get('/invoice/:token/public-view', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(); ensureTable(db)
    const { token } = req.params as { token: string }

    const row = db.prepare('SELECT * FROM invoice_tokens WHERE token = ?').get(token) as any
    if (!row) {
      auditPublicAccess(db, req, {
        route: '/v1/invoice/:token/public-view',
        resourceId: token,
        result: 'not_found',
        fieldSetVersion: 'invoice_public_v1',
      })
      return reply.status(404).send({ error: 'NOT_FOUND' })
    }

    // Get payer info via payment_intents JOIN
    const piRow = db.prepare(`
      SELECT pi.sender_short_id, pi.amount_micro, pi.auto_claimed_at,
             a.nickname AS sender_nickname
      FROM invoice_transactions itx
      LEFT JOIN payment_intents pi
        ON lower(replace(itx.payment_id,'0x','')) = lower(replace(pi.payment_id,'0x',''))
      LEFT JOIN accounts a ON a.short_id = pi.sender_short_id
      WHERE itx.invoice_token = ?
      LIMIT 1
    `).get(token) as any

    // Merchant profile (public)
    const ownerAcct = db.prepare(
      'SELECT merchant_data, nickname FROM accounts WHERE short_id = ?'
    ).get(row.recipient_short_id ?? row.owner_short_id) as any

    let merchant: any = null
    if (ownerAcct?.merchant_data) {
      try { merchant = JSON.parse(ownerAcct.merchant_data) } catch {}
    }

    // Payment info from invoice_transactions
    const itx = db.prepare(
      'SELECT payment_id, tx_hash, paid_at, chain_status, amount_micro, payer_address FROM invoice_transactions WHERE invoice_token = ?'
    ).get(token) as any

    const fullPayload = {
      invoiceNo:        row.invoice_no ?? null,
      amount:           row.amount ?? null,
      feeMode:          row.fee_mode ?? 'recipient',
      note:             row.note ?? null,
      dueDate:          row.due_date ?? null,
      createdAt:        row.created_at ?? null,
      paidAt:           itx?.paid_at ?? row.paid_at ?? null,
      status:           row.revoked_at ? 'cancelled' : (row.status ?? 'draft'),
      chainStatus:      itx?.chain_status ?? null,
      paymentId:        itx?.payment_id ?? null,
      txHash:           itx?.tx_hash ?? null,
      amountMicro:      itx?.amount_micro ?? null,
      invoiceMode:      row.invoice_mode ?? (row.merchant ? 'business' : 'personal'),
      recipientShortId: row.recipient_short_id ?? row.owner_short_id ?? null,
      payerShortId:     piRow?.sender_short_id ?? null,
      payerNickname:    piRow?.sender_nickname ?? null,
      payerName:        row.payer_name ?? null,
      payLink:          `https://iusd-pay.xyz/pay/${token}`,
      merchant:         sanitizeMerchant(merchant),
      issuerNickname:   ownerAcct?.nickname ?? null,
    }
    const payload = pick(fullPayload, [
      'invoiceNo', 'amount', 'feeMode', 'note', 'dueDate', 'createdAt', 'paidAt', 'status',
      'chainStatus', 'paymentId', 'txHash', 'amountMicro', 'invoiceMode', 'recipientShortId',
      'payerShortId', 'payerNickname', 'payerName', 'payLink', 'merchant', 'issuerNickname',
    ])
    auditPublicAccess(db, req, {
      route: '/v1/invoice/:token/public-view',
      resourceId: token,
      result: 'ok',
      fieldSetVersion: 'invoice_public_v1',
    })
    return reply.send(payload)
  })

  app.get('/invoice/chain/payment-status', async (req: FastifyRequest, reply: FastifyReply) => {
    const { paymentId } = (req.query as any) ?? {}
    if (!paymentId || typeof paymentId !== 'string' || paymentId.length < 16)
      return reply.status(400).send({ error: 'invalid paymentId' })
    const status = await queryChainStatus(paymentId.replace(/^0x/i, ''))
    if (status === null) return reply.status(503).send({ error: 'chain unavailable' })
    return reply.send({ chainStatus: status, statusLabel: chainStatusLabel(status) })
  })
}
