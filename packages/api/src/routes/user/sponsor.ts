/**
 * Sponsor Routes v2
 * 
 * Gas sponsorship for claims - allows users without INIT to claim payments
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { sponsorClaim, getRelayerInfo } from '../../services/relayer/payRelayer'

// Simple auth check - decode JWT to get address
async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'MISSING_AUTH', message: 'Authorization required' })
  }
  
  const token = authHeader.slice(7)
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    if (!payload.address) {
      return reply.status(401).send({ error: 'INVALID_TOKEN' })
    }
    ;(request as any).userAddress = payload.address.toLowerCase()
  } catch {
    return reply.status(401).send({ error: 'INVALID_TOKEN' })
  }
}

export async function sponsorV2Routes(app: FastifyInstance) {
  
  /**
   * POST /v1/sponsor/claim
   * Request gas sponsorship for a claim
   * 
   * Body: { paymentId: string, claimKey: string, recipientAddress?: string }
   * 
   * If recipientAddress not provided, uses authenticated user's address
   */
  app.post('/sponsor-v2/claim', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const { paymentId, claimKey, recipientAddress } = request.body as {
      paymentId: string
      claimKey: string
      recipientAddress?: string
    }
    
    if (!paymentId || !claimKey) {
      return reply.status(400).send({ 
        error: 'MISSING_PARAMS', 
        message: 'paymentId and claimKey required' 
      })
    }
    
    // Use provided recipient or authenticated user
    const recipient = recipientAddress || userAddress
    
    const result = await sponsorClaim(paymentId, claimKey, recipient)
    
    if (!result.success) {
      return reply.status(500).send({
        error: 'SPONSOR_FAILED',
        message: result.error
      })
    }
    
    return {
      success: true,
      txHash: result.txHash
    }
  })
  
  /**
   * GET /v1/sponsor/info
   * Get relayer info (for debugging)
   */
  app.get('/sponsor-v2/info', async () => {
    const info = getRelayerInfo()
    
    if (!info) {
      return { 
        enabled: false,
        message: 'Relayer not configured'
      }
    }
    
    return {
      enabled: true,
      relayer: {
        bech32: info.bech32,
        evm: info.address
      }
    }
  })
}
