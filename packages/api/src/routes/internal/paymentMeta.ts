import { FastifyInstance } from 'fastify'
import { getDb } from '../../db'

function ensureTable() {
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS order_meta (
        order_id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        sender TEXT,
        created_at BIGINT DEFAULT (extract(epoch from now())::bigint)
      );
      CREATE INDEX IF NOT EXISTS idx_order_meta_recipient ON order_meta(recipient);
    `)
  } catch { /* table may already exist from migration */ }
}

function storePaymentMeta(id: string, recipient: string, sender?: string): void {
  getDb().prepare(`
    INSERT INTO order_meta (order_id, recipient, sender)
    VALUES (?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      recipient = EXCLUDED.recipient,
      sender = EXCLUDED.sender
  `).run(id.toLowerCase(), recipient.toLowerCase(), sender?.toLowerCase() || null)
}

function getPaymentMeta(id: string): { recipient: string; sender: string | null } | null {
  const row = getDb().prepare('SELECT recipient, sender FROM order_meta WHERE order_id = ?')
    .get(id.toLowerCase()) as { recipient: string; sender: string | null } | undefined
  return row || null
}

function getPaymentsByRecipient(recipient: string): string[] {
  const rows = getDb().prepare('SELECT order_id FROM order_meta WHERE recipient = ?')
    .all(recipient.toLowerCase()) as { order_id: string }[]
  return rows.map((r) => r.order_id)
}

export async function paymentMetaRoutes(app: FastifyInstance) {
  ensureTable()

  app.post('/payments/meta', async (request, reply) => {
    const { id, recipient, sender } = request.body as { id?: string; recipient?: string; sender?: string }
    if (!id || !recipient) {
      return reply.status(400).send({ error: 'MISSING_FIELDS', message: 'id and recipient required' })
    }
    if (!recipient.startsWith('init1') && !recipient.startsWith('0x')) {
      return reply.status(400).send({ error: 'INVALID_RECIPIENT', message: 'Invalid recipient address' })
    }

    try {
      storePaymentMeta(id, recipient, sender)
      return { success: true }
    } catch (e: any) {
      return reply.status(500).send({ error: 'STORE_FAILED', message: e.message })
    }
  })

  app.get('/payments/meta/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const meta = getPaymentMeta(id)
    if (!meta) return reply.status(404).send({ error: 'NOT_FOUND' })
    return meta
  })
}

export { getPaymentMeta, getPaymentsByRecipient, storePaymentMeta }
