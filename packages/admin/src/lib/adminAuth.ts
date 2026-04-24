/**
 * Admin auth helpers — wallet sign → JWT
 */

import { API_ORIGIN } from './config'
const TOKEN_KEY = 'ipay_admin_jwt'

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAdminToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/** Returns auth header only. Add 'Content-Type': 'application/json' manually when sending a body. */
export function adminHeaders(): HeadersInit {
  const token = getAdminToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Auth + JSON content-type — use only when the request has a JSON body. */
export function adminJsonHeaders(): HeadersInit {
  const token = getAdminToken()
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

export async function verifyAdminToken(): Promise<boolean> {
  const token = getAdminToken()
  if (!token) return false
  try {
    const res = await fetch(`${API_ORIGIN}/v1/admin/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

export async function adminLogin(
  address: string,
  signMessage: (msg: string) => Promise<string>,
): Promise<string> {
  // 1. Get challenge
  const cr = await fetch(`${API_ORIGIN}/v1/admin/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  if (!cr.ok) {
    const d = await cr.json()
    throw new Error(d.message ?? d.error ?? 'Challenge failed')
  }
  const { challenge } = await cr.json()

  // 2. Sign with InterwovenKit offlineSigner
  const signature = await signMessage(challenge)

  // 3. Exchange for JWT
  const lr = await fetch(`${API_ORIGIN}/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  })
  if (!lr.ok) {
    const d = await lr.json()
    throw new Error(d.message ?? d.error ?? 'Login failed')
  }
  const { token } = await lr.json()
  setAdminToken(token)
  return address
}
