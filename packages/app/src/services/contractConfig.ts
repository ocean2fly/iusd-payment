/**
 * Contract address resolution from VITE_* environment variables.
 */

function normalizeHexAddress(raw: string): string {
  const normalized = raw.trim()
  if (!normalized) return ''
  if (!normalized.startsWith('0x') && !normalized.startsWith('0X')) return normalized
  return `0x${normalized.slice(2).toLowerCase()}`
}

const MODULE_ADDRESS = normalizeHexAddress(import.meta.env.VITE_MODULE_ADDRESS || '')
const PAY_POOL_ADDRESS = normalizeHexAddress(import.meta.env.VITE_IPAY_POOL_ADDRESS || '')

function requireAddress(kind: 'module' | 'pool', value: string): string {
  if (!value) {
    throw new Error(
      `Missing VITE_${kind === 'module' ? 'MODULE_ADDRESS' : 'IPAY_POOL_ADDRESS'} in frontend config`
    )
  }
  return value
}

export function getPayPoolAddress(): string {
  return requireAddress('pool', PAY_POOL_ADDRESS)
}

export function getModuleAddress(): string {
  return requireAddress('module', MODULE_ADDRESS)
}
