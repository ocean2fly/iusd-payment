/**
 * PromoBanner — Auto-rotating promotional banner carousel for Dashboard.
 *
 * Each banner advertises a specific gift box by id. Clicking navigates
 * to /app/gift?box=<boxId> which auto-opens the SendGiftModal for that
 * box (see Gift.tsx — effect reads ?box from searchParams once the box
 * list finishes loading).
 *
 * Styling philosophy (v2):
 *   - Transparent background, no per-banner gradient
 *   - Surface card with subtle border
 *   - Title text rendered in the banner's theme color (green/pink/gold)
 *   - Subtitle stays muted so the theme color pops
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface BannerDef {
  /** Backend gift box id — must match one of the live /gift/configs rows. */
  boxId: number
  /** i18n key suffix — resolved at render time with t('promoBanner.<id>.title' / '.subtitle'). */
  id: string
  /** Accent color for the title — should contrast against var(--surface). */
  accent: string
  /** Optional secondary accent, used for emoji glow + arrow. */
  accentSoft?: string
  emoji: string
}

const BANNERS: BannerDef[] = [
  { boxId: 2, id: 'coffee', accent: '#22c55e', accentSoft: 'rgba(34,197,94,0.12)', emoji: '☕' },
  { boxId: 1, id: 'rose',   accent: '#ec4899', accentSoft: 'rgba(236,72,153,0.12)', emoji: '🌹' },
  { boxId: 3, id: 'boss',   accent: '#d4a017', accentSoft: 'rgba(212,160,23,0.14)', emoji: '👔' },
]

export function PromoBanner() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(0)
  const navigate = useNavigate()
  const touchStartX = useRef(0)

  // Auto-rotate every 5s
  useEffect(() => {
    const timer = setInterval(() => setCurrent(c => (c + 1) % BANNERS.length), 5000)
    return () => clearInterval(timer)
  }, [])

  const b = BANNERS[current]

  return (
    <div style={{ width: '100%', marginBottom: 12 }}>
      <div
        onClick={() => navigate(`/app/gift?box=${b.boxId}`)}
        onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - touchStartX.current
          if (dx > 40) setCurrent(c => (c - 1 + BANNERS.length) % BANNERS.length)
          else if (dx < -40) setCurrent(c => (c + 1) % BANNERS.length)
        }}
        style={{
          // Transparent-ish surface card with the active theme color
          // tinting the border and a very faint radial glow from the
          // emoji side. Content is fully readable against var(--bg).
          background: 'var(--surface)',
          borderRadius: 14,
          padding: '16px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          cursor: 'pointer',
          minHeight: 80,
          overflow: 'hidden',
          position: 'relative',
          border: `1px solid ${b.accentSoft ?? 'var(--border)'}`,
          transition: 'border-color 0.4s ease',
        }}>
        {/* Subtle theme-color glow anchored to the emoji */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: 18,
            width: 120,
            height: 120,
            transform: 'translateY(-50%)',
            background: `radial-gradient(circle at center, ${b.accentSoft ?? 'transparent'} 0%, transparent 70%)`,
            pointerEvents: 'none',
            transition: 'background 0.5s ease',
          }}
        />

        <span style={{
          fontSize: 36,
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
          filter: `drop-shadow(0 0 8px ${b.accentSoft ?? 'transparent'})`,
        }}>{b.emoji}</span>

        <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
          <div style={{
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1.3,
            color: b.accent,
            letterSpacing: '0.01em',
          }}>
            {t(`promoBanner.${b.id}.title`)}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--muted)',
            marginTop: 3,
          }}>
            {t(`promoBanner.${b.id}.subtitle`)}
          </div>
        </div>

        <span style={{
          fontSize: 18,
          color: b.accent,
          opacity: 0.7,
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
        }}>→</span>
      </div>

      {/* Dots — active dot uses current banner's accent color */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 8 }}>
        {BANNERS.map((def, i) => (
          <div key={i} onClick={() => setCurrent(i)} style={{
            width: i === current ? 16 : 6,
            height: 6,
            borderRadius: 3,
            background: i === current ? def.accent : 'var(--border)',
            transition: 'all 0.3s ease',
            cursor: 'pointer',
          }} />
        ))}
      </div>
    </div>
  )
}
