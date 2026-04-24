/**
 * Payment routes aligned with the current pay_v3 contract.
 *
 * Notes:
 * - pay_v3 exposes `get_payment`, `get_payment_full`, and `get_pool_stats`.
 * - Legacy list/build endpoints from the old `pay` module are intentionally
 *   deprecated here instead of silently serving incorrect data.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CHAIN_ID, REST_URL } from '../../shared/config'
import { getModuleAddress, getPoolAddress } from '../../shared/contract-config'
import { IUSD_DECIMALS } from '../../shared/networks'
import { hashPaymentId } from '../../lib/payKeyHash'

interface PaymentView {
  status: string
  amount: string
  fee: string
  sender: string
  claimedBy: string
  createdAt: string
  expiresAt: string
  ciphertext: string
  keyForSender: string
  keyForRecipient: string
  claimKeyHash: string
}

function encodeAddress(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  return Buffer.from(hex, 'hex').toString('base64')
}

function encodeVecU8FromHex(hex: string): string {
  const normalized = hex.replace(/^0x/i, '').toLowerCase()
  return Buffer.from(normalized, 'hex').toString('base64')
}

async function queryPayView(functionName: string, args: string[]): Promise<any> {
  const url = `${REST_URL}/initia/move/v1/accounts/${getModuleAddress()}/modules/pay_v3/view_functions/${functionName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type_args: [], args }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`pay_v3::${functionName} failed: ${res.status} ${text}`)
  }

  const data = await res.json() as any
  return data.data
}

function microToDisplay(amount: string): string {
  return (Number(BigInt(amount)) / 10 ** IUSD_DECIMALS).toFixed(2)
}

function isZeroAddress(addr: string): boolean {
  return /^0x0+$/i.test(addr)
}

function mapStatusName(status: number): string {
  switch (status) {
    case 2: return 'pending_claim'
    case 3: return 'confirmed'
    case 5: return 'revoked'
    case 6: return 'refunded'
    case 7: return 'expired'
    default: return 'unknown'
  }
}

function parsePaymentView(tuple: any[]): PaymentView | null {
  if (!Array.isArray(tuple) || tuple.length < 11) return null

  const [
    status,
    amount,
    fee,
    sender,
    claimedBy,
    createdAt,
    expiresAt,
    ciphertext,
    keyForSender,
    keyForRecipient,
    claimKeyHash,
  ] = tuple

  if (Number(status) === 0 && Number(amount) === 0 && isZeroAddress(String(sender))) {
    return null
  }

  return {
    status: mapStatusName(Number(status)),
    amount: String(amount),
    fee: String(fee),
    sender: String(sender),
    claimedBy: String(claimedBy),
    createdAt: String(createdAt),
    expiresAt: String(expiresAt),
    ciphertext: String(ciphertext),
    keyForSender: String(keyForSender),
    keyForRecipient: String(keyForRecipient),
    claimKeyHash: String(claimKeyHash),
  }
}

function deprecated(reply: FastifyReply, replacement: string) {
  return reply.status(410).send({
    error: 'DEPRECATED_ROUTE',
    message: `This endpoint depended on the legacy pay module and is no longer supported. Use ${replacement}.`,
  })
}

export async function paymentsRoutes(app: FastifyInstance) {
  app.get('/payments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string }

    try {
      // Chain-side payment_id is sha256(plain) — see lib/payKeyHash.ts
      const result = await queryPayView('get_payment_full', [
        encodeAddress(getPoolAddress()),
        encodeVecU8FromHex(hashPaymentId(id)),
      ])

      const payment = parsePaymentView(result)
      if (!payment) {
        return reply.status(404).send({ error: 'Payment not found' })
      }

      return {
        paymentId: id,
        chainId: CHAIN_ID,
        moduleName: 'pay_v3',
        poolAddress: getPoolAddress(),
        payment,
        amountFormatted: microToDisplay(payment.amount),
        feeFormatted: microToDisplay(payment.fee),
      }
    } catch (err: any) {
      app.log.error({ err, id }, '[Payments] Failed to get payment')
      return reply.status(500).send({ error: err.message })
    }
  })

  app.get('/payments/user/:addr', async (_request: FastifyRequest, reply: FastifyReply) => {
    return deprecated(reply, '/v1/account/history/sent and /v1/account/history/received')
  })

  app.get('/payments/sent/:addr', async (_request: FastifyRequest, reply: FastifyReply) => {
    return deprecated(reply, '/v1/account/history/sent')
  })

  app.get('/payments/received/:addr', async (_request: FastifyRequest, reply: FastifyReply) => {
    return deprecated(reply, '/v1/account/history/received')
  })

  app.post('/payments/build', async (_request: FastifyRequest, reply: FastifyReply) => {
    return deprecated(reply, 'the frontend orderBuilder / pay_v3 transaction builder')
  })

  app.get('/payments/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await queryPayView('get_pool_stats', [encodeAddress(getPoolAddress())])
      const stats = Array.isArray(result) ? result : ['0', '0', '0']

      return {
        totalPayments: parseInt(String(stats[0] ?? '0'), 10),
        totalVolume: String(stats[1] ?? '0'),
        totalFees: String(stats[2] ?? '0'),
        poolAddress: getPoolAddress(),
        moduleName: 'pay_v3',
        initialized: true,
      }
    } catch (err: any) {
      if (
        err.message?.includes('not found') ||
        err.message?.includes('ABORTED') ||
        err.message?.includes('MISSING_DATA')
      ) {
        return {
          totalPayments: 0,
          totalVolume: '0',
          totalFees: '0',
          poolAddress: getPoolAddress(),
          moduleName: 'pay_v3',
          initialized: false,
        }
      }

      app.log.error({ err }, '[Payments] Failed to get stats')
      return reply.status(500).send({ error: err.message })
    }
  })

  app.post('/payments/save', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, sender, recipient, amount, memo, txHash, status } = request.body as any

    if (!id || !sender || !recipient || !amount) {
      return reply.status(400).send({ error: 'Missing required fields' })
    }

    try {
      const db = (await import('../../db/index')).getDb()
      const amountNum = parseFloat(amount)
      const amountMicro = Math.round(amountNum * 1_000_000)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      db.prepare(`
        INSERT INTO payments (
          payment_id, sender, recipient, amount, amount_micro, memo,
          status, tx_hash, created_at, expires_at, chain
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now()::text, ?, ?)
        ON CONFLICT(payment_id) DO UPDATE SET
          status = excluded.status,
          tx_hash = excluded.tx_hash,
          updated_at = now()::text
      `).run(
        id,
        sender.toLowerCase(),
        recipient.toLowerCase(),
        amountNum.toFixed(6),
        amountMicro,
        memo || null,
        status || 'created',
        txHash || null,
        expiresAt,
        CHAIN_ID
      )

      return { success: true, id }
    } catch (err: any) {
      app.log.error({ err, id }, '[Payments] Failed to save payment')
      return reply.status(500).send({ error: err.message })
    }
  })
}
