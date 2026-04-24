/**
 * DNA Color System — unified FNV-1a hash → HSL hue for user identity colors.
 *
 * Used across: IdentityCard, StyledQR, ProfileCard, Scan, Gift, Transfer
 * Always hash the wallet address (lowercase) for consistent colors.
 */

/** FNV-1a hash — deterministic 32-bit hash from string */
export function fnvHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Get DNA hue (0-359) from a wallet address or shortId */
export function dnaHue(addressOrId: string): number {
  if (!addressOrId) return 200
  return fnvHash(addressOrId.toLowerCase()) % 360
}

/** Get the primary DNA color as an HSL string */
export function dnaColor(addressOrId: string, saturation = 55, lightness = 55): string {
  return `hsl(${dnaHue(addressOrId)}, ${saturation}%, ${lightness}%)`
}

/** Privacy-masked ID: HEAD◆◆◆TAIL */
export function privacyId(shortId?: string | null): string {
  if (!shortId || shortId.length < 8) return shortId ?? '—'
  return `${shortId.slice(0, 4)}◆◆◆${shortId.slice(-4)}`
}

/** Format nickname@HEAD◆◆◆TAIL */
export function formatIdDna(nickname: string, shortId: string): string {
  return `${nickname}@${privacyId(shortId)}`
}
