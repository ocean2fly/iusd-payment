/**
 * History Routes (Compatibility Layer)
 * 
 * Provides payment history from local database.
 */

import { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index'

export async function historyRoutes(app: FastifyInstance) {
  // GET /history/:address - Get payment history
  app.get('/history/:address', async (request, reply) => {
    const { address } = request.params as { address: string }
    const { limit = 20, offset = 0, type } = request.query as any
    const normalAddr = address.toLowerCase()
    
    try {
      const db = getDb()
      let query = `
        SELECT * FROM payments 
        WHERE (sender = ? OR recipient = ?)
      `
      const params: any[] = [normalAddr, normalAddr]
      
      if (type === 'sent') {
        query = 'SELECT * FROM payments WHERE sender = ?'
        params.length = 0
        params.push(normalAddr)
      } else if (type === 'received') {
        query = 'SELECT * FROM payments WHERE recipient = ?'
        params.length = 0
        params.push(normalAddr)
      }
      
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
      params.push(parseInt(limit), parseInt(offset))
      
      const rows = db.prepare(query).all(...params)
      
      // Get total count
      let countQuery = `
        SELECT COUNT(*) as count FROM payments 
        WHERE (sender = ? OR recipient = ?)
      `
      const countParams = [normalAddr, normalAddr]
      
      if (type === 'sent') {
        countQuery = 'SELECT COUNT(*) as count FROM payments WHERE sender = ?'
        countParams.length = 0
        countParams.push(normalAddr)
      } else if (type === 'received') {
        countQuery = 'SELECT COUNT(*) as count FROM payments WHERE recipient = ?'
        countParams.length = 0
        countParams.push(normalAddr)
      }
      
      const countRow = db.prepare(countQuery).get(...countParams) as any
      
      return {
        payments: rows,
        total: countRow?.count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
      }
    } catch (err) {
      app.log.error(err, '[History] Query failed')
      return { payments: [], total: 0, limit: 20, offset: 0 }
    }
  })
}
