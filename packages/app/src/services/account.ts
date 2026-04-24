/**
 * account.ts — registration & profile
 * Uses shared types from @ipay/shared for type safety.
 */
import { API_BASE } from '../config'
import type { ApiAccount } from '@ipay/shared'

// Re-export for component use
export type { ApiAccount as Account }

function parseAccount(data: any): ApiAccount {
  const a: ApiAccount = data?.account ?? data
  return {
    shortId:             a.shortId ?? '',
    checksum:            a.checksum ?? '',
    nickname:            a.nickname ?? '',
    address:             a.address ?? '',
    display:             a.display ?? a.nickname ?? '',
    avatarSeed:          a.avatarSeed          ?? null,
    avatarSvg:           a.avatarSvg            ?? null,
    shortSealSvg:        a.shortSealSvg         ?? null,
    defaultClaimAddress: a.defaultClaimAddress ?? null,
    autoClaimEnabled:    a.autoClaimEnabled    ?? false,
    merchantName:        a.merchantName        ?? null,
    merchantData:        a.merchantData        ?? null,
    bio:                 a.bio                 ?? '',
    createdAt:           a.createdAt           ?? '',
  }
}

export async function getMyAccount(token: string): Promise<ApiAccount | null> {
  const res = await fetch(`${API_BASE}/account/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`getMyAccount: ${res.status}`)
  return parseAccount(await res.json())
}

export async function registerAccount(token: string, nickname: string): Promise<ApiAccount> {
  const res = await fetch(`${API_BASE}/account/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ nickname }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `register: ${res.status}`)
  }
  return parseAccount(await res.json())
}
