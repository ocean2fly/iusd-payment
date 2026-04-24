/**
 * Sanctions Compliance Middleware
 *
 * Applied to ALL transaction endpoints:
 *   POST /v1/payments
 *   POST /v1/payments/:id/proof
 *   POST /v1/subscriptions
 *   POST /v1/checks
 *   POST /v1/gifts
 *   POST /v1/invoices/:id/pay
 *
 * Checks:
 *  1. OFAC sanctions list (wallet address)
 *  2. Country/IP block (OFAC-sanctioned jurisdictions)
 *  3. ToS acceptance header (X-IPay-ToS-Accepted)
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { screenAddresses, BLOCKED_COUNTRY_CODES, hashIp } from '../services/security/ofac'

// Countries blocked at IP level (OFAC sanctioned)
// Uses Cloudflare's CF-IPCountry header (available when behind Cloudflare)
const BLOCKED_COUNTRIES = new Set(BLOCKED_COUNTRY_CODES)

export interface SanctionsBody {
  from?: string
  to?: string
  recipient?: string
  merchant?: string
}

/**
 * Fastify hook — run before handler on all transaction routes.
 */
export async function sanctionsMiddleware(
  request: FastifyRequest<{ Body: SanctionsBody }>,
  reply: FastifyReply
): Promise<void> {
  // ── 1. ToS acceptance check ──────────────────────────────────────────────
  const tosAccepted = request.headers['x-ipay-tos-accepted']
  if (tosAccepted !== '1') {
    return reply.status(403).send({
      error: 'TERMS_NOT_ACCEPTED',
      message:
        'You must accept the iPay Terms of Service. ' +
        'Include header: X-IPay-ToS-Accepted: 1',
      docs: 'https://api.iusd-pay.xyz/docs',
    })
  }

  // ── 2. Country/jurisdiction block ────────────────────────────────────────
  // Cloudflare sets CF-IPCountry on all requests
  const countryCode =
    (request.headers['cf-ipcountry'] as string)?.toUpperCase() ?? ''

  if (countryCode && BLOCKED_COUNTRIES.has(countryCode)) {
    request.log.warn(
      { ip: hashIp(request.ip), country: countryCode },
      'Request blocked: sanctioned jurisdiction'
    )
    return reply.status(451).send({
      // 451 = Unavailable For Legal Reasons
      error: 'JURISDICTION_BLOCKED',
      message:
        'iPay is not available in your jurisdiction due to sanctions regulations.',
    })
  }

  // ── 3. OFAC address screening ────────────────────────────────────────────
  const body = request.body ?? {}
  const addressesToCheck = [
    body.from,
    body.to,
    body.recipient,
    body.merchant,
  ].filter(Boolean) as string[]

  // Also check wallet address from auth header if present
  const walletAddr = request.headers['x-wallet-address'] as string | undefined
  if (walletAddr) addressesToCheck.push(walletAddr)

  if (addressesToCheck.length > 0) {
    const screening = await screenAddresses(addressesToCheck)

    if (screening.blocked) {
      request.log.warn(
        {
          ip: hashIp(request.ip),
          // Don't log the actual address for privacy
          addressHash: hashIp(screening.blockedAddress ?? ''),
        },
        'Transaction blocked: OFAC sanctions match'
      )

      return reply.status(403).send({
        error: 'SANCTIONS_MATCH',
        message:
          'Transaction cannot be processed: address appears on a sanctions list. ' +
          'If you believe this is an error, contact compliance@iusd-pay.xyz',
      })
    }
  }

  // All checks passed — continue to handler
}

/**
 * Fastify plugin — registers sanctions middleware on transaction routes.
 *
 * Usage in routes:
 *   fastify.addHook('preHandler', sanctionsMiddleware)
 *
 * Or per-route:
 *   fastify.post('/payments', { preHandler: sanctionsMiddleware }, handler)
 */
export function registerSanctionsPlugin(fastify: any): void {
  // Apply to all transaction endpoints
  const TRANSACTION_ROUTES = [
    '/v1/payments',
    '/v1/subscriptions',
    '/v1/checks',
    '/v1/gifts',
  ]

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const isTransactionRoute = TRANSACTION_ROUTES.some(route =>
      request.url.startsWith(route) && request.method === 'POST'
    )

    if (isTransactionRoute) {
      await sanctionsMiddleware(request as any, reply)
    }
  })
}
