/**
 * UpdateBanner — proactive PWA / cached-shell updater.
 *
 * Problem: iOS PWA (standalone, home-screen installed) aggressively caches
 * the HTML shell. A plain reload often serves the old HTML, which references
 * the old hashed JS bundle — users stay on the previous deploy until the
 * shell cache happens to expire. Without a Service Worker we can't force a
 * hard refresh from the install side, so we do a version check client-side.
 *
 * Strategy:
 *   1. On mount, capture the CURRENT JS bundle filename from the DOM (the
 *      <script src="/assets/index-XXXX.js"> Vite injected into the HTML we
 *      loaded with).
 *   2. Periodically (+ on visibility / focus change) fetch "/" with
 *      cache:'no-store', extract the bundle filename from the fresh HTML,
 *      and compare.
 *   3. On mismatch, render a small top banner that lets the user reload.
 *      The reload uses a cache-busting query so iOS serves the fresh HTML.
 *
 * Safe to render always — on the first render we have no remote version
 * to compare yet, so nothing shows until a fetch finds a newer build.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CHECK_INTERVAL_MS = 5 * 60 * 1000  // 5 min while foregrounded
const FOCUS_MIN_GAP_MS  = 30 * 1000      // don't spam refocus events

function readCurrentBundle(): string | null {
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[]
    for (const s of scripts) {
      const m = s.src.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)
      if (m) return m[1]
    }
  } catch { /* noop */ }
  return null
}

async function fetchLatestBundle(): Promise<string | null> {
  try {
    // Cache-busting query defeats intermediate caches; cache:'no-store'
    // skips the HTTP cache. Both belt-and-suspenders for iOS PWA.
    const res = await fetch(`/?_u=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

export function UpdateBanner() {
  const { t } = useTranslation()
  const currentRef = useRef<string | null>(null)
  const [hasUpdate, setHasUpdate] = useState(false)
  const lastCheckRef = useRef(0)

  useEffect(() => {
    currentRef.current = readCurrentBundle()

    async function check() {
      if (!currentRef.current) return
      const latest = await fetchLatestBundle()
      if (latest && latest !== currentRef.current) {
        setHasUpdate(true)
      }
      lastCheckRef.current = Date.now()
    }

    // Initial check slightly delayed so we don't race page load
    const initTimer = setTimeout(check, 4000)
    // Periodic
    const pollTimer = setInterval(check, CHECK_INTERVAL_MS)
    // When tab becomes visible again (PWA resume)
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastCheckRef.current < FOCUS_MIN_GAP_MS) return
      check()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)

    return () => {
      clearTimeout(initTimer)
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])

  if (!hasUpdate) return null

  function reload() {
    // Cache-busting query forces iOS to refetch the shell instead of
    // serving the cached standalone copy.
    try { sessionStorage.removeItem('ipay_chunk_reload') } catch {}
    const url = new URL(window.location.href)
    url.searchParams.set('_v', String(Date.now()))
    window.location.replace(url.toString())
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'var(--surface, #1a1a1a)',
        border: '1px solid var(--border, #333)',
        borderRadius: 12,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        fontSize: 12,
        color: 'var(--text, #fff)',
        maxWidth: 'calc(100vw - 24px)',
      }}
      role="status"
      aria-live="polite"
    >
      <span>{t('update.available', 'New version available')}</span>
      <button
        onClick={reload}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          background: 'var(--text, #fff)',
          color: 'var(--bg, #000)',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {t('update.reload', 'Reload')}
      </button>
      <button
        onClick={() => setHasUpdate(false)}
        aria-label="dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted, #888)',
          fontSize: 14,
          cursor: 'pointer',
          padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  )
}
