/**
 * ErrorBoundary — catches render errors anywhere in the app and shows a
 * recovery UI. Prevents the blank-screen state when a lazy chunk, a wallet
 * injection, or a runtime error crashes React.
 */
import React from 'react'
import i18n from 'i18next'
const t = (k: string) => i18n.t(k)

interface State { err: Error | null }

// Detect lazy-chunk load failures that happen after a deploy when the client's
// index.html still references the old chunk hashes.
function isChunkLoadError(err: Error | null): boolean {
  if (!err) return false
  const msg = String(err?.message ?? err ?? '').toLowerCase()
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('failed to fetch') ||
    msg.includes('chunkloaderror') ||
    msg.includes('loading chunk') ||
    // SPA fallback: stale index.html was served for a missing JS asset
    msg.includes('not a valid javascript mime type') ||
    msg.includes('expected a javascript module') ||
    msg.includes("'text/html' is not executable") ||
    msg.includes('mime type ("text/html")') ||
    (msg.includes('import') && msg.includes('.js'))
  )
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: any) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', err, info)
    // Auto-recover from chunk load errors (client cached old index.html).
    // Gate via sessionStorage so we only reload once per session.
    if (isChunkLoadError(err)) {
      try {
        const key = 'ipay_chunk_reload'
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1')
          setTimeout(() => window.location.reload(), 80)
        }
      } catch {}
    }
  }

  render() {
    if (!this.state.err) return this.props.children
    // Chunk-load errors trigger an auto-reload in componentDidCatch; show a
    // simple loading screen instead of the scary "Something went wrong" UI.
    if (isChunkLoadError(this.state.err)) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'var(--bg, #0a0a0a)',
          color: 'var(--muted, #888)', fontFamily: 'system-ui', fontSize: 12,
        }}>
          {t('components.errorBoundary.updating')}
        </div>
      )
    }

    const handleReload = () => {
      try { sessionStorage.removeItem('ipay_chunk_reload') } catch {}
      window.location.reload()
    }
    const handleHardReset = () => {
      try {
        const savedTheme = localStorage.getItem('ipay_theme') || 'auto'
        localStorage.clear()
        sessionStorage.clear()
        localStorage.setItem('ipay_theme', savedTheme)
      } catch {}
      window.location.href = window.location.origin + '/?v=' + Date.now()
    }

    const msg = String(this.state.err?.message ?? this.state.err ?? '')

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'var(--bg, #0a0a0a)', color: 'var(--text, #fff)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ fontSize: 42, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{t('components.errorBoundary.somethingWrong')}</div>
        <div style={{ fontSize: 11, color: 'var(--muted, #888)', marginBottom: 20, maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>
          {msg.slice(0, 200) || t('components.errorBoundary.genericErr')}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleReload} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'var(--text, #fff)', color: 'var(--bg, #000)',
            fontSize: 12, fontWeight: 700,
          }}>{t('components.errorBoundary.reload')}</button>
          <button onClick={handleHardReset} style={{
            padding: '10px 20px', borderRadius: 10, cursor: 'pointer',
            background: 'transparent', color: 'var(--muted, #888)',
            border: '1px solid var(--border, #333)', fontSize: 12, fontWeight: 600,
          }}>{t('components.errorBoundary.resetReload')}</button>
        </div>
        <div style={{ fontSize: 9, color: 'var(--muted, #666)', marginTop: 24, letterSpacing: '0.1em' }}>
          iUSD PAY
        </div>
      </div>
    )
  }
}
