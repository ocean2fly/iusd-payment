/**
 * auth.ts — session management
 *
 * Sessions are stored per-address in localStorage.
 * On disconnect: call clearSession(address) to wipe everything.
 */
import { API_BASE } from '../config'

// V2 prefix — isolated from V1 sessions (V1 used 'ipay_session_')
const SESSION_PREFIX = 'ipay2_session_'

interface Session {
  token: string
  expires_at: string
}

export function getSession(address: string): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + address.toLowerCase())
    if (!raw) return null
    const s: Session = JSON.parse(raw)
    if (new Date() >= new Date(s.expires_at)) {
      localStorage.removeItem(SESSION_PREFIX + address.toLowerCase())
      return null
    }
    return s
  } catch {
    return null
  }
}

export function hasValidSession(address: string): boolean {
  return getSession(address) !== null
}

export function saveSession(address: string, token: string, expires_at: string) {
  const s: Session = { token, expires_at }
  localStorage.setItem(SESSION_PREFIX + address.toLowerCase(), JSON.stringify(s))
}

/** Clear all local data for this address (called on disconnect) */
export function clearSession(address: string) {
  const key = address.toLowerCase()
  // V2 keys
  localStorage.removeItem(SESSION_PREFIX + key)
  localStorage.removeItem('ipay2_vk_' + key)
  // V1 legacy keys — clean up on disconnect too
  localStorage.removeItem('ipay_session_' + key)
  localStorage.removeItem('ipay_vk_' + key)
  localStorage.removeItem('ipay_account_' + key)
  sessionStorage.clear()
}

/**
 * Sign in: EIP-191 signature → session token.
 *
 * When `prefetchedNonce` is provided, the nonce fetch is skipped entirely so
 * signMessage() is called in the same synchronous frame as the caller's
 * click handler. That matters on iOS Safari: `window.open()` inside Web3Auth
 * must fire while the user-gesture "transient activation" window is still
 * open, or Safari treats it as a blocked popup even with settings=Allow.
 * Any `await` before signMessage (nonce fetch, dynamic import) closes that
 * window. Callers that can pre-fetch should.
 */
export async function login(
  address: string,
  signMessage: (msg: string) => Promise<string>,
  prefetchedNonce?: string,
): Promise<string> {
  // 1. Nonce — use prefetched if given (no await), else fetch.
  let nonce: string
  if (prefetchedNonce) {
    nonce = prefetchedNonce
  } else {
    try {
      const nonceRes = await fetch(`${API_BASE}/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      if (!nonceRes.ok) {
        let bodyErr = ''
        try { bodyErr = (await nonceRes.json())?.error ?? '' } catch {}
        throw new Error(`status ${nonceRes.status}${bodyErr ? ' ' + bodyErr : ''}`)
      }
      const data = await nonceRes.json()
      nonce = data.nonce
    } catch (e: any) {
      throw new Error(`[nonce] ${e?.message ?? e}`)
    }
  }

  // 2. Sign the nonce. With a prefetched nonce this is the first await in
  //    the function body, so iOS Safari transient activation is preserved.
  let signature: string
  try {
    signature = await signMessage(nonce)
  } catch (e: any) {
    throw new Error(`[sign] ${e?.message ?? e}`)
  }

  // 3. Verify signature → get session token. On INVALID_NONCE / NONCE_EXPIRED
  //    the server's cached challenge doesn't match what we signed — usually
  //    because a concurrent prefetch race swapped the DB row. Transparently
  //    refetch a fresh nonce, re-sign, and re-verify so the user doesn't
  //    have to click Retry. The second sign may lose iOS Safari transient
  //    activation; if it does, we surface a meaningful error.
  async function tryVerify(n: string, sig: string): Promise<{ ok: true; body: any } | { ok: false; status: number; error: string }> {
    const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, nonce: n, signature: sig }),
    })
    if (verifyRes.ok) return { ok: true, body: await verifyRes.json() }
    let err = ''
    try { err = (await verifyRes.json())?.error ?? '' } catch {}
    return { ok: false, status: verifyRes.status, error: err }
  }

  let data: any
  try {
    let result = await tryVerify(nonce, signature)
    if (!result.ok && result.status === 400 && (result.error === 'INVALID_NONCE' || result.error === 'NONCE_EXPIRED')) {
      // Refetch nonce + re-sign + re-verify. One attempt only — if this
      // fails too, the error surfaces for real.
      const nonceRes2 = await fetch(`${API_BASE}/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      if (!nonceRes2.ok) throw new Error(`status ${nonceRes2.status}`)
      const freshNonce: string = (await nonceRes2.json()).nonce
      let signature2: string
      try {
        signature2 = await signMessage(freshNonce)
      } catch (e: any) {
        throw new Error(`[sign-retry] ${e?.message ?? e}`)
      }
      result = await tryVerify(freshNonce, signature2)
    }
    if (!result.ok) throw new Error(`status ${result.status}${result.error ? ' ' + result.error : ''}`)
    data = result.body
  } catch (e: any) {
    throw new Error(`[verify] ${e?.message ?? e}`)
  }

  // API returns { sessionToken, expiresAt } per shared types (camelCase)
  const token: string = data.sessionToken
  const expires_at: string = data.expiresAt

  saveSession(address, token, expires_at)
  return token
}
