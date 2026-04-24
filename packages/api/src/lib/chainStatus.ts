export type ChainStatusCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Canonical chain status labels used across API routes.
 * NOTE: Keep wire fields unchanged; this only centralizes mapping.
 */
export const CHAIN_STATUS_LABEL: Record<ChainStatusCode, string> = {
  0: 'NOT_FOUND',
  1: 'PENDING_SEND',
  2: 'PENDING_CLAIM',
  3: 'CLAIMED',
  4: 'REFUNDED',
  5: 'REVOKED',
  6: 'REFUNDED',
  7: 'EXPIRED',
}

export const CHAIN_STATUS_SHORT: Record<ChainStatusCode, string> = {
  0: 'not_found',
  1: 'pending_send',
  2: 'pending',
  3: 'confirmed',
  4: 'refunded',
  5: 'revoked',
  6: 'refunded',
  7: 'expired',
}

export function chainStatusLabel(code: number | null | undefined): string | null {
  if (code == null) return null
  return CHAIN_STATUS_LABEL[code as ChainStatusCode] ?? 'UNKNOWN'
}

export function chainStatusShort(code: number | null | undefined): string | null {
  if (code == null) return null
  return CHAIN_STATUS_SHORT[code as ChainStatusCode] ?? 'unknown'
}
