export type UiPayStatus = 'awaiting' | 'paying' | 'paid' | 'refunded' | 'revoked' | 'expired'

/**
 * Canonical interpretation layer for payment/invoice chain states.
 * Keeps UI/API contract unchanged while making status logic consistent.
 */
export function uiPayStatusFromChain(chainStatus: number | null | undefined): UiPayStatus {
  if (chainStatus === 3) return 'paid'
  if (chainStatus === 6 || chainStatus === 4) return 'refunded'
  if (chainStatus === 5) return 'revoked'
  if (chainStatus === 7) return 'expired'
  if (chainStatus === 2 || chainStatus === 1) return 'paying'
  return 'awaiting'
}

export function invoiceVisualStatus(input: {
  status?: string | null
  chainStatus?: number | null
  revokedAt?: string | null
}): 'paid' | 'cancelled' | 'pending' {
  if (input.revokedAt || input.status === 'cancelled' || input.status === 'revoked') return 'cancelled'
  if (input.status === 'paid' || input.chainStatus === 3) return 'paid'
  return 'pending'
}

export function verifyBadge(inputStatus?: string | null): { color: string; label: string } {
  if (inputStatus === 'paid') return { color: '#22c55e', label: 'Paid' }
  if (inputStatus === 'revoked') return { color: '#6b7280', label: 'Revoked' }
  if (inputStatus === 'expired') return { color: '#6b7280', label: 'Expired' }
  if (inputStatus === 'refunded') return { color: '#8b5cf6', label: 'Refunded' }
  return { color: '#f59e0b', label: 'Pending' }
}
