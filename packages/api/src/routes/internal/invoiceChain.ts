/**
 * invoiceChain.ts -- On-chain invoice_v1 API routes
 *
 * POST /v1/invoice/chain/create       -- create on-chain invoice (gas-sponsored if free quota)
 * POST /v1/invoice/chain/pay          -- pay an on-chain invoice
 * POST /v1/invoice/chain/cancel       -- cancel invoice (merchant only, ACTIVE)
 * POST /v1/invoice/chain/expire       -- trigger expiry (anyone, overdue)
 * POST /v1/invoice/chain/refund       -- refund invoice (merchant only, PAID)
 * GET  /v1/invoice/chain/:systemId    -- get full invoice data
 * GET  /v1/invoice/chain/by-merchant/:address -- list invoice IDs for merchant
 * GET  /v1/invoice/chain/by-payer/:address    -- list invoice IDs for payer
 * GET  /v1/invoice/chain/quota/:address       -- check free quota availability
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth } from '../../middleware/auth'
import { getDb } from '../../db'
import { MODULE_ADDRESS, REST_URL } from '../../shared/config'

// Status codes
const STATUS: Record<number, string> = {
  1: 'active', 2: 'paid', 3: 'cancelled', 4: 'expired', 5: 'refunded',
}

// ── BCS helpers ─────────────────────────────────────────────────────────────

function vecU8B64(hex: string): string {
  const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex')
  const len = bytes.length
  const prefix: number[] = []
  let v = len
  do {
    let b = v & 0x7f; v >>= 7
    if (v > 0) b |= 0x80
    prefix.push(b)
  } while (v > 0)
  return Buffer.concat([Buffer.from(prefix), bytes]).toString('base64')
}

// ── Chain view helpers ───────────────────────────────────────────────────────

async function viewInvoice(systemId: string): Promise<any[] | null> {
  try {
    const sidB64 = vecU8B64(systemId)
    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/invoice_v1/view_functions/get_invoice`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [sidB64] }),
    })
    if (!res.ok) return null
    const j = await res.json() as { data?: string }
    if (!j.data) return null
    return JSON.parse(j.data)
  } catch { return null }
}

async function viewStatus(systemId: string): Promise<number | null> {
  try {
    const sidB64 = vecU8B64(systemId)
    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/invoice_v1/view_functions/get_invoice_status`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [sidB64] }),
    })
    if (!res.ok) return null
    const j = await res.json() as { data?: string }
    return j.data !== undefined ? Number(j.data) : null
  } catch { return null }
}

async function viewMerchantIds(address: string): Promise<string[]> {
  try {
    const addrBytes = Buffer.from(address.replace(/^0x/, '').padStart(64,'0'), 'hex')
    const addrB64 = addrBytes.toString('base64')
    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/invoice_v1/view_functions/get_merchant_invoice_ids`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [addrB64] }),
    })
    if (!res.ok) return []
    const j = await res.json() as { data?: string }
    return j.data ? JSON.parse(j.data) : []
  } catch { return [] }
}

async function viewQuota(address: string): Promise<boolean> {
  try {
    const addrBytes = Buffer.from(address.replace(/^0x/, '').padStart(64,'0'), 'hex')
    const addrB64 = addrBytes.toString('base64')
    const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/modules/invoice_v1/view_functions/is_free_quota_available`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_args: [], args: [addrB64] }),
    })
    if (!res.ok) return false
    const j = await res.json() as { data?: string }
    return j.data === 'true' || j.data === true as any
  } catch { return false }
}

// ── Parse invoice tuple from view function ───────────────────────────────────

function parseInvoice(systemId: string, raw: any[]) {
  // get_invoice returns tuple:
  // (merchant_invoice_id, merchant, payout_address, payer, amount, fee, net,
  //  fee_mode, status, due_at, created_at, paid_at, refunded_amount,
  //  encrypted_data, key_for_merchant, key_for_admin, key_for_payer)
  const [
    merchantInvoiceId, merchant, payoutAddress, payer,
    amount, fee, net, feeMode, status, dueAt, createdAt, paidAt, refundedAmount,
    encryptedData, keyForMerchant, keyForAdmin, keyForPayer,
  ] = raw
  return {
    systemId,
    merchantInvoiceId,
    merchant,
    payoutAddress,
    payer,
    amount:          String(amount),
    fee:             String(fee),
    net:             String(net),
    feeMode:         Number(feeMode),
    status:          Number(status),
    statusStr:       STATUS[Number(status)] ?? 'unknown',
    dueAt:           Number(dueAt),
    createdAt:       Number(createdAt),
    paidAt:          Number(paidAt),
    refundedAmount:  String(refundedAmount),
    encryptedData,
    keyForMerchant,
    keyForAdmin,
    keyForPayer,
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function invoiceChainRoutes(app: FastifyInstance) {

  /**
   * GET /v1/invoice/chain/:systemId
   * Returns full on-chain invoice data.
   */
  app.get('/invoice/chain/:systemId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { systemId } = req.params as { systemId: string }
    const raw = await viewInvoice(systemId)
    if (!raw) return reply.status(404).send({ error: 'Invoice not found' })
    return reply.send({ invoice: parseInvoice(systemId, raw) })
  })

  /**
   * GET /v1/invoice/chain/status/:systemId
   */
  app.get('/invoice/chain/status/:systemId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { systemId } = req.params as { systemId: string }
    const status = await viewStatus(systemId)
    if (status === null) return reply.status(404).send({ error: 'Not found' })
    return reply.send({ status, statusStr: STATUS[status] ?? 'unknown' })
  })

  /**
   * GET /v1/invoice/chain/by-merchant
   * Self-scoped: returns invoice IDs for the authenticated merchant.
   * PRIVACY: the caller's init1 address used to live in the URL path; it
   * is now read from the Bearer token so nothing identity-linked appears
   * in request logs.
   */
  app.get('/invoice/chain/by-merchant', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const acct = (req as any).account as any
    const userAddress = (acct?.address ?? (req as any).userAddress) as string
    if (!userAddress) return reply.status(401).send({ error: 'UNAUTHORIZED' })
    const ids = await viewMerchantIds(userAddress)
    return reply.send({ invoiceIds: ids, count: ids.length })
  })

  /**
   * GET /v1/invoice/chain/quota
   * Self-scoped: check the authenticated merchant's free quota. Address
   * sourced from the Bearer token; no path param.
   */
  app.get('/invoice/chain/quota', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const acct = (req as any).account as any
    const userAddress = (acct?.address ?? (req as any).userAddress) as string
    if (!userAddress) return reply.status(401).send({ error: 'UNAUTHORIZED' })
    const hasFree = await viewQuota(userAddress)
    return reply.send({ hasFreeQuota: hasFree })
  })

  /**
   * POST /v1/invoice/chain/create
   * Creates an on-chain invoice.
   * If merchant has free quota: relayer sponsors gas.
   * Otherwise: returns unsigned tx for frontend to sign.
   *
   * Body: { merchantInvoiceId, payoutAddress, amount, feeMode, dueAt,
   *         encryptedData, keyForMerchant, keyForAdmin }
   */
  app.post('/invoice/chain/create', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const acct = (req as any).account as any
    if (!acct) return reply.status(401).send({ error: 'UNAUTHORIZED' })

    const {
      merchantInvoiceId, payoutAddress, amount, feeMode,
      dueAt, encryptedData, keyForMerchant, keyForAdmin,
    } = req.body as {
      merchantInvoiceId: string
      payoutAddress:     string
      amount:            string
      feeMode:           number
      dueAt:             number
      encryptedData:     string
      keyForMerchant:    string
      keyForAdmin:       string
    }

    const merchantAddress = `0x${Buffer.from(acct.address.replace(/^0x/,'')).toString('hex').padStart(64,'0')}`
    const hasFree = await viewQuota(merchantAddress)

    // V1 sponsored invoice creation was removed.
    // Always return tx args for frontend to sign directly.
    return reply.send({
      ok: true,
      sponsored: false,
      txArgs: {
        moduleAddress: MODULE_ADDRESS,
        moduleName:    'invoice_v1',
        functionName:  'create_invoice',
        args: [merchantInvoiceId, payoutAddress, amount, feeMode, dueAt, encryptedData, keyForMerchant, keyForAdmin],
      },
    })
  })

  /**
   * POST /v1/invoice/chain/cancel
   * Merchant cancels invoice. Returns tx args for frontend to sign.
   */
  app.post('/invoice/chain/cancel', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { systemId } = req.body as { systemId: string }
    return reply.send({
      ok: true,
      txArgs: {
        moduleAddress: MODULE_ADDRESS,
        moduleName:    'invoice_v1',
        functionName:  'cancel_invoice',
        args: [systemId],
      },
    })
  })

  /**
   * POST /v1/invoice/chain/expire
   * Anyone can trigger expiry on an overdue invoice.
   */
  app.post('/invoice/chain/expire', async (req: FastifyRequest, reply: FastifyReply) => {
    const { systemId } = req.body as { systemId: string }
    return reply.send({
      ok: true,
      txArgs: {
        moduleAddress: MODULE_ADDRESS,
        moduleName:    'invoice_v1',
        functionName:  'expire_invoice',
        args: [systemId],
      },
    })
  })

  /**
   * POST /v1/invoice/chain/refund
   * Merchant refunds with basis points.
   */
  app.post('/invoice/chain/refund', { preHandler: requireAuth }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { systemId, refundBps } = req.body as { systemId: string; refundBps: number }
    if (refundBps < 0 || refundBps > 10000) return reply.status(400).send({ error: 'refundBps must be 0-10000' })
    return reply.send({
      ok: true,
      txArgs: {
        moduleAddress: MODULE_ADDRESS,
        moduleName:    'invoice_v1',
        functionName:  'refund_invoice',
        args: [systemId, refundBps],
      },
    })
  })
}
