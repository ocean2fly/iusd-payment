/**
 * /g/:code — short gift claim URL decoder.
 *
 * Supports two formats:
 *   - 49 bytes: packetId(16) + claimKey(32) + slotIndex(1) → legacy per-slot URL
 *   - 48 bytes: packetId(16) + claimKey(32) → single URL (server assigns slot)
 */
import { Navigate, useParams } from 'react-router-dom'

function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (b64.length % 4)) % 4
  const bin = atob(b64 + '='.repeat(pad))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export default function GiftClaimShort() {
  const { code } = useParams<{ code: string }>()
  if (!code) return <Navigate to="/" replace />

  try {
    const bytes = base64urlDecode(code)
    const p = toHex(bytes.slice(0, 16))
    const k = toHex(bytes.slice(16, 48))

    // `_g=1` query flag tells GiftClaim the visitor arrived via the /g/:code
    // short link. ✕ on that page must force-navigate to /app — navigate(-1)
    // has no valid target because <Navigate replace> collapsed the /g/ entry
    // and any QuickLogin → /app/welcome round-trip replaced the entry again.
    // A query param is used (not location.state) because Welcome restores the
    // return path as a bare URL, which strips state but preserves query.
    if (bytes.length >= 49) {
      const s = bytes[48]
      return <Navigate to={`/gift/claim?p=${p}&k=${k}&s=${s}&_g=1`} replace />
    } else if (bytes.length >= 48) {
      return <Navigate to={`/gift/claim?p=${p}&k=${k}&_g=1`} replace />
    }

    return <Navigate to="/" replace />
  } catch {
    return <Navigate to="/" replace />
  }
}
