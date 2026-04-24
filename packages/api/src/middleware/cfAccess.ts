/**
 * Cloudflare Access JWT verification
 * Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

const CF_TEAM_DOMAIN = process.env.CF_TEAM_DOMAIN ?? ''  // e.g. 'yourteam.cloudflareaccess.com'
const CF_AUD         = process.env.CF_AUD ?? ''           // Application Audience tag

/**
 * Verify the CF-Access-Jwt-Assertion header.
 * Returns the decoded payload or null if invalid/missing.
 *
 * NOTE: Full verification requires fetching public keys from:
 * https://{CF_TEAM_DOMAIN}/cdn-cgi/access/certs
 *
 * For now: decode and check expiry + audience (signature check TODO when CF_TEAM_DOMAIN is set)
 */
export function verifyCfAccessJwt(token: string | undefined): { email?: string; sub?: string } | null {
  if (!token) return null

  try {
    // Decode JWT payload (no signature check — relies on Cloudflare network-level enforcement)
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

    // Check expiry
    if (payload.exp && payload.exp < Date.now() / 1000) return null

    // Check audience if configured
    if (CF_AUD && payload.aud !== CF_AUD) return null

    return { email: payload.email, sub: payload.sub }
  } catch {
    return null
  }
}

/**
 * Fastify preHandler: require either CF Access JWT or x-admin-key
 */
export function requireAdminAuth(request: any, reply: any, done: () => void) {
  const adminKey = request.headers['x-admin-key']
  const cfJwt    = request.headers['cf-access-jwt-assertion']

  const validKey = adminKey === (process.env.ADMIN_KEY ?? 'admin-dev-key')
  const validCf  = !!verifyCfAccessJwt(cfJwt as string | undefined)

  if (!validKey && !validCf) {
    reply.status(401).send({ error: 'UNAUTHORIZED' })
    return
  }

  done()
}
