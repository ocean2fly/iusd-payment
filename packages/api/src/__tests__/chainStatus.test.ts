import { describe, expect, it } from 'vitest'
import { chainStatusLabel, chainStatusShort } from '../lib/chainStatus'

describe('chainStatus mapping', () => {
  it('maps known statuses consistently', () => {
    expect(chainStatusLabel(2)).toBe('PENDING_CLAIM')
    expect(chainStatusLabel(3)).toBe('CLAIMED')
    expect(chainStatusLabel(5)).toBe('REVOKED')
    expect(chainStatusLabel(7)).toBe('EXPIRED')

    expect(chainStatusShort(2)).toBe('pending')
    expect(chainStatusShort(3)).toBe('confirmed')
    expect(chainStatusShort(6)).toBe('refunded')
  })

  it('handles unknown/null safely', () => {
    expect(chainStatusLabel(null)).toBeNull()
    expect(chainStatusShort(undefined)).toBeNull()
    expect(chainStatusLabel(99)).toBe('UNKNOWN')
    expect(chainStatusShort(99)).toBe('unknown')
  })
})
