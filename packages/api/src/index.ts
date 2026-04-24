import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({
  path: fs.existsSync('.env.api') ? '.env.api' : '.env',
  override: true,
})
import { requireAdminAuth, verifyCfAccessJwt } from './middleware/cfAccess'
import { getDb } from './db/index'
import { initContractConfig, getContractConfig } from './shared/contract-config'
import { getRelayerServiceAddress } from './services/relayer'
/**
 * iPay API Server — Fastify v4
 *
 * Base URL: https://api.iusd-pay.xyz/v1
 *
 * Routes:
 *   GET  /health                    health check
 *   GET  /v1/chains                 supported chains
 *   GET  /v1/address/resolve        INS name resolution
 *   POST /v1/payments               create ZK payment
 *   GET  /v1/payments/:id           payment status
 *   POST /v1/support/tickets        submit dispute ticket
 *   GET  /v1/support/tickets/:id    ticket status
 *   POST /v1/audit/packages         generate audit package
 *   GET  /v1/audit/packages/:id     retrieve audit package
 *   POST /v1/audit/verify           verify package integrity
 *   GET  /v1/audit/compliance/:id   on-chain compliance record
 */

import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

import { sponsorV2Routes } from './routes/user/sponsor'
import { getVerifierPublicKey } from './services/security/zkVerifier'
// OLD: import { poolRoutes }        from './routes/pool'
// OLD: import { chainRoutes }    from './routes/chains'
// OLD: import { addressRoutes }  from './routes/address'
// OLD: import { supportRoutes }  from './routes/support'
// OLD: import { auditRoutes }    from './routes/audit'
import { scanRelayRoutes } from './routes/internal/scanRelay'
import { paySessionRoutes } from './routes/internal/paySessionRoutes'
import { invoiceRoutes } from './routes/internal/invoiceRoutes'
import { invoiceChainRoutes } from './routes/internal/invoiceChain'
import { giftRoutes }      from './routes/user/gift'
import { ogRoutes }        from './routes/og'
// OLD: import { merchantRoutes }  from './routes/merchants'
// OLD: import { travelRuleRoutes } from './routes/travel-rule'
import { historyRoutes }       from './routes/user/history'
// OLD: import { subscriptionRoutes }  from './routes/subscriptions'
import { viewingKeyRoutes }    from './routes/user/viewingKeys'
import { authRoutes }          from './routes/user/auth'
// OLD: import { contactRoutes }       from './routes/contacts'
import { usernamesRoutes }     from './routes/internal/usernames'
// OLD: import { approvalRoutes }      from './routes/approvals'
// OLD: import { autoClaimSettingsRoutes } from './routes/autoClaimSettings'
// OLD: import relayRoutes from './routes/relay'
import { adminRoutes } from './routes/admin/routes'
import { adminAuthRoutes } from './routes/admin/auth'
import { accountRoutes }   from './routes/user/account'
import { activityRoutes }  from './routes/user/activity'
import { registerRoutes }  from './routes/user/register'
import { directoryRoutes } from './routes/public/directory'
import { paymentsRoutes } from './routes/user/payments'
import { paymentMetaRoutes } from './routes/internal/paymentMeta'
import { contactsRoutes } from './routes/user/contacts'
// notifyRoutes removed — SSE + push endpoints retired (see notify.ts header)
import configRoutes from './routes/public/config'
// WC Proxy disabled - using Privy for wallet connections
// import { wcProxyRoutes } from './routes/wcProxy'
import { registerStream, unregisterStream } from './lib/notifications'
import { errorHandler }   from './middleware/error-handler'
import { registerSanctionsPlugin } from './middleware/sanctions'
import { initOfacService } from './services/security/ofac'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  })

  // ── Resilient JSON body parser (tolerates empty body with Content-Type: application/json) ──
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (body as string).trim() === '') return done(null, {})
    try { done(null, JSON.parse(body as string)) } catch (e: any) { done(e) }
  })

  // ── Error handler ──────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler)

  // ── Auto-localize route-level error responses ─────────────────────────────
  // Routes that reply `{ error: 'CODE' }` without a `message` get one
  // injected here based on Accept-Language. Zero route changes needed.
  const { pickLocale: _pickLocale, hasTranslation, translateMessage: _tr } = await import('./lib/i18n')
  app.addHook('preSerialization', async (req, reply, payload: any) => {
    const status = reply.statusCode
    if (status < 400 || status >= 600) return payload
    if (!payload || typeof payload !== 'object') return payload
    const code = (payload as any).error
    if (typeof code !== 'string' || !hasTranslation(code)) return payload
    if ((payload as any).message) return payload
    const locale = _pickLocale(req.headers['accept-language'] as string | undefined)
    return { ...payload, message: _tr(code, locale, code) }
  })

  // ── CORS ───────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: [
      'https://iusd-pay.xyz',
      'https://www.iusd-pay.xyz',
      'https://app.iusd-pay.xyz',
      'https://admin.iusd-pay.xyz',  // Admin dashboard
      'https://i18n.iusd-pay.xyz',   // i18n preview (feat/i18n branch)
      // Dev origins
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://localhost:3201',  // serve -s . port
    ],
    credentials: true,
  })

  // ── Swagger / OpenAPI docs ─────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'iPay REST API',
        version: '1.0.0',
        description: 'ZK-private iUSD payment protocol on Initia blockchain.\n\n' +
          'All transaction endpoints require:\n' +
          '- `X-IPay-ToS-Accepted: 1` header\n' +
          '- `X-Wallet-Address` header (wallet address for OFAC screening)\n\n' +
          'Base URL: `https://api.iusd-pay.xyz/v1`',
      },
      servers: [
        { url: 'https://api.iusd-pay.xyz', description: 'Production' },
        { url: 'http://localhost:3000',     description: 'Development' },
      ],
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  })

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // ── Block all crawlers ────────────────────────────────────────────────────
  app.get('/robots.txt', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain')
    return reply.send('User-agent: *\nDisallow: /\n')
  })

  // ── OG preview — served to link crawlers by the Cloudflare Worker ─────────
  app.get('/v1/og/claim/:paymentId', async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string }
    const db = getDb()

    const payment = db.prepare(
      'SELECT status, created_at, expires_at FROM payments WHERE payment_id = ?'
    ).get(paymentId) as any | undefined

    const claimUrl = `https://iusd-pay.xyz/claim/${paymentId}`
    const ogImage  = 'https://iusd-pay.xyz/og-preview.png'

    let title       = 'iUSD Payment Waiting For You'
    let description = 'You have a private iUSD payment. Connect your wallet to claim it.'
    let isTerminal  = false

    if (!payment || payment.status === 'expired' || payment.status === 'revoked' || payment.status === 'failed') {
      title       = 'iUSD Pay — Payment Unavailable'
      description = 'This payment link has expired or been cancelled.'
      isTerminal  = true
    } else if (payment.status === 'confirmed') {
      title       = 'iUSD Pay — Payment Already Claimed'
      description = 'This payment has already been claimed.'
      isTerminal  = true
    } else if (payment.status === 'refunded') {
      title       = 'iUSD Pay — Payment Refunded'
      description = 'This payment was refunded to the sender.'
      isTerminal  = true
    } else if (payment.expires_at) {
      const msLeft   = new Date(payment.expires_at).getTime() - Date.now()
      const daysLeft = Math.ceil(msLeft / 86_400_000)
      if (msLeft <= 0) {
        description = 'This payment has expired.'
        isTerminal  = true
      } else if (daysLeft <= 1) {
        const hoursLeft = Math.ceil(msLeft / 3_600_000)
        description = `You have a private iUSD payment waiting. Expires in ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}.`
      } else {
        description = `You have a private iUSD payment waiting. Expires in ${daysLeft} days.`
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${claimUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="iUSD Pay">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${ogImage}">
<meta http-equiv="refresh" content="0;url=${claimUrl}">
</head>
<body><a href="${claimUrl}">Click here if not redirected</a></body>
</html>`

    // Terminal states (claimed/expired/revoked): short cache so update propagates quickly
    // Active payments: 60s cache
    const cacheSeconds = isTerminal ? 10 : 60

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', `public, max-age=${cacheSeconds}`)
      .send(html)
  })

  // /v1/og/pay/:paymentId — OG preview for /pay/* links (primary shareable URL)
  app.get('/v1/og/pay/:paymentId', async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string }
    const db = getDb()

    const payment = db.prepare(
      'SELECT status, created_at, expires_at FROM payments WHERE payment_id = ?'
    ).get(paymentId) as any | undefined

    const payUrl  = `https://iusd-pay.xyz/pay/${paymentId}`
    const ogImage = 'https://iusd-pay.xyz/og-preview.png'

    let title       = 'iUSD Pay — Payment Waiting For You'
    let description = 'Receive a transfer through iUSD Pay. Connect your wallet to claim it.'
    let isTerminal  = false

    if (!payment || payment.status === 'expired' || payment.status === 'revoked' || payment.status === 'failed') {
      title       = 'iUSD Pay — Payment Unavailable'
      description = 'This payment link has expired or been cancelled.'
      isTerminal  = true
    } else if (payment.status === 'confirmed') {
      title       = 'iUSD Pay — Payment Already Claimed'
      description = 'This payment has already been claimed.'
      isTerminal  = true
    } else if (payment.status === 'refunded') {
      title       = 'iUSD Pay — Payment Refunded'
      description = 'This payment was refunded to the sender.'
      isTerminal  = true
    } else if (payment.expires_at) {
      const msLeft   = new Date(payment.expires_at).getTime() - Date.now()
      const daysLeft = Math.ceil(msLeft / 86_400_000)
      if (msLeft <= 0) {
        description = 'This payment has expired.'
        isTerminal  = true
      } else if (daysLeft <= 1) {
        const hoursLeft = Math.ceil(msLeft / 3_600_000)
        description = `Receive a transfer through iUSD Pay. Expires in ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}. Sign to claim it.`
      } else {
        description = `Receive a transfer through iUSD Pay. Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. Sign to claim it.`
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${payUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="iUSD Pay">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${ogImage}">
<meta http-equiv="refresh" content="0;url=${payUrl}">
</head>
<body><a href="${payUrl}">Click here if not redirected</a></body>
</html>`

    const cacheSeconds = isTerminal ? 10 : 60
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', `public, max-age=${cacheSeconds}`)
      .send(html)
  })


  // ── Sanctions middleware (all /v1/... POST endpoints) ──────────────────────
  // ── Global privacy guard ───────────────────────────────────────────────
  // Reject any request whose URL path contains an init1 bech32 wallet
  // address. Wallet addresses are private identifiers; the public handle
  // is the shortId. No allowlist — every route MUST either use a shortId
  // path param or rely on the Bearer token for the caller's own address.
  const INIT_ADDR_RE = /\/init1[a-z0-9]{20,}/i
  app.addHook('onRequest', async (request, reply) => {
    if (!INIT_ADDR_RE.test(request.url)) return
    return reply.status(400).send({
      error: 'PRIVACY_VIOLATION',
      message: 'URL contains a wallet address. Use shortId or rely on the Bearer token instead.',
    })
  })

  // Skip OFAC network call in test environment
  if (process.env.NODE_ENV !== 'test') {
    registerSanctionsPlugin(app)
  } else {
    // Test mode: lightweight check only (no OFAC network calls)
    // Gifts, invoices, support: no ToS check needed in tests
    app.addHook('preHandler', async (request, reply) => {
      const strictRoutes = ['/v1/payments']
      const isTxRoute = strictRoutes.some(r => request.url.startsWith(r) && request.method === 'POST')
      if (isTxRoute) {
        const tos = request.headers['x-ipay-tos-accepted']
        if (!tos) return reply.status(403).send({ error: 'TOS_REQUIRED' })
      }
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // V1 API - Chain-First Architecture (New Design)
  // ══════════════════════════════════════════════════════════════════════════
  
  // Core routes
  await app.register(authRoutes,     { prefix: '/v1' })
  await app.register(paymentsRoutes,   { prefix: '/v1' })
  await app.register(paymentMetaRoutes, { prefix: '/v1' })
  await app.register(contactsRoutes, { prefix: '/v1' })
  
  // Legacy routes (still used by frontend)
  await app.register(historyRoutes,    { prefix: '/v1' })
  await app.register(viewingKeyRoutes, { prefix: '/v1' })
  await app.register(usernamesRoutes,  { prefix: '/v1' })
  
  // Gift / Museum Box system
  const { registerAccountInvoiceRoutes } = await import('./routes/internal/invoiceRoutes')
  await app.register(async (subApp) => {
    await registerAccountInvoiceRoutes(subApp)
  }, { prefix: '/v1' })
  await app.register(giftRoutes,       { prefix: '/v1' })
  await app.register(ogRoutes,         { prefix: '/v1' })
  await app.register(invoiceRoutes,     { prefix: '/v1' })
  await app.register(invoiceChainRoutes, { prefix: '/v1' })
  await app.register(scanRelayRoutes,   { prefix: '/v1' })
  await app.register(paySessionRoutes,  { prefix: '/v1' })

  // Config & utility
  await app.register(configRoutes, { prefix: '/v1/config' })
  
  // Admin routes
  await app.register(adminAuthRoutes,  { prefix: '/v1/admin' })
  await app.register(adminRoutes,      { prefix: '/v1/admin' })

  // Serve uploaded files
  const uploadsDir = process.env.UPLOAD_DIR || require('path').join(process.cwd(), 'uploads')
  app.get('/uploads/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string }
    const safe = filename.replace(/[^a-z0-9_.\-]/gi, '')
    const filePath = require('path').join(uploadsDir, safe)
    if (!require('fs').existsSync(filePath)) return reply.status(404).send({ error: 'Not found' })
    const ext = safe.split('.').pop()?.toLowerCase()
    const mime: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
    reply.header('Content-Type', mime[ext || ''] || 'application/octet-stream')
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    return reply.send(require('fs').readFileSync(filePath))
  })

  // Sponsor routes
  await app.register(sponsorV2Routes,  { prefix: '/v1' })

  // User routes
  await app.register(accountRoutes,    { prefix: '/v1' })
  await app.register(activityRoutes,   { prefix: '/v1' })
  await app.register(registerRoutes,   { prefix: '/v1' })
  await app.register(directoryRoutes,  { prefix: '/v1' })
  // WC Proxy disabled - using Privy for wallet connections
  // await app.register(wcProxyRoutes,            { prefix: '/v1' })

  // SSE notifications — inlined (not wrapped in register) to avoid avvio plugin timeout
  app.get<{ Querystring: { address?: string } }>('/v1/notifications/stream', {}, (request, reply) => {
    const address = (request.query as any).address?.trim().toLowerCase() as string | undefined
    if (!address) { reply.status(400).send({ error: 'MISSING_ADDRESS' }); return }
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    })
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
    registerStream(address, res)
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { clearInterval(ping) } }, 25_000)
    request.raw.on('close', () => { clearInterval(ping); unregisterStream(address, res) })
  })

  // ── 404 handler ────────────────────────────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error:   'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
      docs:    'https://api.iusd-pay.xyz/docs',
    })
  })

  return app
}

// ── Start ───────────────────────────────────────────────────────────────────
async function start() {
  // Initialize contract config from environment
  try {
    initContractConfig()
  } catch (err) {
    console.error('[startup] Contract config init failed:', err)
    process.exit(1)
  }

  // Initialize OFAC sanctions list (non-blocking, runs in background)
  initOfacService().catch(err =>
    console.warn('[startup] OFAC init failed (non-fatal):', err.message)
  )

  // Migrate short_id to 16 chars + backfill avatar_svg + short_seal_svg on startup
  try {
    const { generateIdentitySeal } = await import('./services/core/identity-seal')
    const { generateShortId, generateChecksum } = await import('./routes/user/account')
    const db = getDb()
    const rows = db.prepare("SELECT address, nickname, short_id FROM accounts").all() as any[]
    let migrated = 0
    for (const row of rows) {
      const newShortId  = generateShortId(row.address)
      const newChecksum = generateChecksum(row.address)
      const avatarSvg    = generateIdentitySeal({ address: row.address, nickname: row.nickname ?? '', fontSize: 16 })
      const shortSealSvg = generateIdentitySeal({ address: row.address, nickname: '', fontSize: 14, showNickname: false })
      db.prepare("UPDATE accounts SET short_id = ?, checksum = ?, avatar_svg = ?, short_seal_svg = ? WHERE address = ?")
        .run(newShortId, newChecksum, avatarSvg, shortSealSvg, row.address)
      if (row.short_id !== newShortId) migrated++
    }
    console.log(`[startup] Backfilled seals + migrated shortId (${migrated} upgraded to 16 chars) for ${rows.length} accounts`)
  } catch (e: any) { console.warn('[startup] seal/shortId backfill skipped:', e.message) }

  const app = await buildApp()
  const port = parseInt(process.env.PORT ?? '3001', 10)
  const host = process.env.HOST ?? '0.0.0.0'

  try {
    await app.listen({ port, host })
    
    // Print startup summary
    const contractConfig = getContractConfig()

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  iPay API Server v1.0.0                                         ║
╠══════════════════════════════════════════════════════════════════╣
║  Server:      http://${host}:${port}                              ║
║  Docs:        http://${host}:${port}/docs                         ║
║  Health:      http://${host}:${port}/health                       ║
╠══════════════════════════════════════════════════════════════════╣
║  ADDRESSES (from Environment)                                    ║
╠══════════════════════════════════════════════════════════════════╣
║  Contract:    ${contractConfig.poolAddress.padEnd(46)}║
║  Module:      ${contractConfig.moduleAddress.padEnd(46)}║
╚══════════════════════════════════════════════════════════════════╝
    `.trim())
  } catch (err) {
    console.error('[startup] Failed to start server:', err)
    process.exit(1)
  }
}

// Only start when run directly (not imported by tests)
if (require.main === module) {
  start()
}
