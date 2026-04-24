/**
 * UserSeal — renders a user's Identity Seal (shortSealSvg) as a full-width banner.
 * Module-level cache: fetches once per shortId, shared across all instances.
 *
 * Usage:
 *   <UserSeal shortId="5K6JNVZD9M5JJYG2" />              ← full banner
 *   <UserSeal shortId="..." fallbackNickname="boldfalcon" /> ← shows nick while loading
 */
import { useState, useEffect } from 'react'
import { API_BASE } from '../config'

// ── Module-level cache (survives re-renders, shared across all UserSeal instances) ──
type CacheEntry =
  | { status: 'loading' }
  | { status: 'done'; svg: string | null; nickname: string }

const cache = new Map<string, CacheEntry>()
const listeners = new Map<string, Set<() => void>>()

function subscribe(shortId: string, cb: () => void) {
  if (!listeners.has(shortId)) listeners.set(shortId, new Set())
  listeners.get(shortId)!.add(cb)
  return () => listeners.get(shortId)?.delete(cb)
}

function notify(shortId: string) {
  listeners.get(shortId)?.forEach(cb => cb())
}

async function fetchSeal(shortId: string) {
  if (cache.has(shortId)) return
  cache.set(shortId, { status: 'loading' })
  try {
    const res = await fetch(`${API_BASE}/account/${shortId.toUpperCase()}`)
    const d = await res.json()
    const acct = d?.account
    cache.set(shortId, {
      status: 'done',
      svg:      acct?.shortSealSvg ?? null,
      nickname: acct?.nickname ?? shortId,
    })
  } catch {
    cache.set(shortId, { status: 'done', svg: null, nickname: shortId })
  }
  notify(shortId)
}

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  shortId:          string
  fallbackNickname?: string
  /** If true, renders a slim 28px-tall strip instead of the natural SVG height */
  compact?:         boolean
  /** Called when clicked (e.g. navigate to send) */
  onClick?:         () => void
  style?:           React.CSSProperties
}

export function UserSeal({ shortId, fallbackNickname, compact, onClick, style }: Props) {
  const [, forceRender] = useState(0)
  const id = shortId?.toUpperCase()

  useEffect(() => {
    if (!id) { return undefined }
    fetchSeal(id)
    const unsub = subscribe(id, () => forceRender(n => n + 1))
    return () => { unsub() }
  }, [id])

  if (!id) return null

  const entry = cache.get(id)
  const nick  = (entry?.status === 'done' ? entry.nickname : null) ?? fallbackNickname ?? id.slice(0,4) + '…'

  const wrapStyle: React.CSSProperties = {
    width: '100%', display: 'block', lineHeight: 0,
    borderRadius: 8, overflow: 'hidden',
    cursor: onClick ? 'pointer' : 'default',
    ...(compact ? { maxHeight: 28 } : {}),
    ...style,
  }

  // ── SVG available — compose nickname@ prefix + DNA seal strip ──
  if (entry?.status === 'done' && entry.svg) {
    // Extract DNA hue from SVG for consistent background
    const hueMatch = entry.svg.match(/hsl\((\d+),/)
    const hue = hueMatch ? parseInt(hueMatch[1]) : 200
    const accent = `hsl(${hue},70%,72%)`
    const bg     = `hsl(${hue},40%,12%)`

    return (
      <div style={{ ...wrapStyle, display:'flex', alignItems:'stretch',
                    background: bg, overflow:'hidden' }}
           onClick={onClick}>
        {/* Nickname prefix */}
        <div style={{
          padding: compact ? '0 7px' : '0 10px',
          display: 'flex', alignItems: 'center',
          fontSize: compact ? 9 : 12, fontWeight: 700,
          color: accent, flexShrink: 0, whiteSpace: 'nowrap',
          letterSpacing: '0.01em',
        }}>
          {nick}<span style={{ opacity:0.5, margin:'0 1px' }}>@</span>
        </div>
        {/* DNA ID strip */}
        <div style={{ flex:1, lineHeight:0, overflow:'hidden', minWidth:0,
                      display:'flex', alignItems:'center' }}
             dangerouslySetInnerHTML={{ __html: entry.svg }} />
      </div>
    )
  }

  // ── Loading / no SVG fallback ──
  const hue = id ? (id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360) : 200
  return (
    <div style={{
      ...wrapStyle,
      padding: compact ? '4px 10px' : '8px 14px',
      background: `hsl(${hue},40%,22%)`,
      display: 'flex', alignItems: 'center', gap: 8,
      lineHeight: 'normal',
    }} onClick={onClick}>
      <div style={{
        width: compact ? 16 : 24, height: compact ? 16 : 24,
        borderRadius: '50%',
        background: `hsl(${hue},50%,40%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: compact ? 8 : 11, fontWeight: 700, color: 'white', flexShrink: 0,
      }}>
        {nick[0]?.toUpperCase() ?? '?'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: compact ? 9 : 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
          {nick}
        </span>
        {!compact && (
          <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>
            {id.slice(0,4)} ◆◆◆ [{id.slice(-4)}]
          </span>
        )}
      </div>
      {!entry && <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>⟳</span>}
    </div>
  )
}
