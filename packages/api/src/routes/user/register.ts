/**
 * Registration Routes
 *
 * POST /v1/account/register — Create new account
 *
 * This route is separate because registration has special logic:
 * - generates shortId + checksum from address
 * - generates server-hosted viewing keypair
 * - sets default claim address
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getDb } from '../../db'
import { generateViewingKeyPair, encryptViewingPrivKey } from '../../services/security/encryption'
import { generateIdentitySeal } from '../../services/core/identity-seal'
import { requireAuth } from '../../middleware/auth'
import { formatAccountResponse, generateShortId, generateChecksum, generateRandomNickname } from './account'

export async function registerRoutes(app: FastifyInstance) {
  const db = getDb()

  // Migrate: add avatar_svg column if missing
  // Backfill short_seal_svg for existing accounts
  try {
    const missing = db.prepare("SELECT address, nickname FROM accounts WHERE short_seal_svg IS NULL").all() as any[]
    for (const row of missing) {
      const svg = generateIdentitySeal({ address: row.address, nickname: '', fontSize: 14, showNickname: false })
      db.prepare("UPDATE accounts SET short_seal_svg = ? WHERE address = ?").run(svg, row.address)
    }
  } catch { /* non-fatal */ }

  /**
   * POST /v1/account/register
   * Register a new iPay account (auth required)
   *
   * Body: { nickname?: string }
   * Returns: { success: true, account: ApiAccount }
   */
  app.post('/account/register', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userAddress = (request as any).userAddress
    const { nickname } = request.body as { nickname?: string }

    // Already registered? Return existing account (not an error)
    const existing = db.prepare('SELECT * FROM accounts WHERE address = ?').get(userAddress)
    if (existing) {
      return { success: true, account: formatAccountResponse(existing, { includeAddress: true }) }
    }

    // Nickname: any Unicode, 1–12 chars (uniqueness NOT required — shortId is the unique key)
    const finalNickname = nickname?.trim().slice(0, 12) || generateRandomNickname()
    if (finalNickname.length < 1) {
      return reply.status(400).send({ error: 'INVALID_NICKNAME', message: 'Nickname cannot be empty' })
    }

    // Generate IDs + avatar
    const shortId   = generateShortId(userAddress)
    const checksum  = generateChecksum(userAddress)
    const avatarSeed = Math.floor(Math.random() * 1_000_000)
    const avatarSvg     = generateIdentitySeal({ address: userAddress, nickname: finalNickname, fontSize: 16 })
    const shortSealSvg  = generateIdentitySeal({ address: userAddress, nickname: '', fontSize: 14, showNickname: false })

    // Server-hosted viewing keypair
    const { privKey, pubKey } = generateViewingKeyPair()
    const viewingPubkey = pubKey.toString('hex')
    const viewingPrivkeyEnc = encryptViewingPrivKey(privKey)

    // Handle short_id collision (extremely rare)
    const collision = db.prepare('SELECT 1 FROM accounts WHERE short_id = ?').get(shortId)
    const finalShortId = collision
      ? shortId.slice(0, 3) + Math.floor(Math.random() * 36).toString(36).toUpperCase()
      : shortId

    db.prepare(`
      INSERT INTO accounts (address, pubkey, short_id, checksum, nickname, avatar_seed, avatar_svg, short_seal_svg, viewing_privkey_enc, default_claim_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userAddress, viewingPubkey, finalShortId, checksum, finalNickname, avatarSeed, avatarSvg, shortSealSvg, viewingPrivkeyEnc, userAddress)

    const account = db.prepare('SELECT * FROM accounts WHERE address = ?').get(userAddress)
    console.log(`[register] ✅ New account: ${finalNickname}#${finalShortId} (${userAddress})`)

    // Grant fee allowance from relayer so user can deposit without holding INIT
    // Fire-and-forget — don't block registration if this fails
    import('../../services/relayer/payRelayer').then(({ grantFeeAllowance }) => {
      grantFeeAllowance(userAddress).catch(e => console.warn('[register] feegrant failed:', e.message))
    })

    return { success: true, account: formatAccountResponse(account, { includeAddress: true }) }
  })
}
