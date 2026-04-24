import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App'
import { Providers } from './providers'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installGlobalClickSound } from './lib/sound'
import { installPressFeedback } from './lib/pressable'

// ── Apply saved theme preference immediately on startup ───────────────────
// Runs synchronously before first render to avoid flash-of-wrong-theme.
// Default is 'auto' (follows OS via CSS media query) when nothing is saved.
;(function initTheme() {
  const saved = localStorage.getItem('ipay_theme') as 'auto' | 'light' | 'dark' | null
  const mode  = saved || 'auto'
  const root  = document.documentElement
  root.classList.remove('dark', 'light')
  if (mode === 'dark')  root.classList.add('dark')
  if (mode === 'light') root.classList.add('light')
  // 'auto' → no class → CSS @media (prefers-color-scheme: dark) handles it
})()

// Stability hotfix: guard DOM removeChild race (WebView/wallet injection can desync DOM)
;(function patchRemoveChildRace() {
  const proto = Node.prototype as any
  if (proto.__ipayRemoveChildPatched) return
  const original = proto.removeChild
  proto.removeChild = function patchedRemoveChild(child: Node) {
    try {
      if (!child || (child as any).parentNode !== this) return child
      return original.call(this, child)
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? '').toLowerCase()
      if (msg.includes('not a child')) return child
      throw err
    }
  }
  proto.__ipayRemoveChildPatched = true
})()

// Handle lazy chunk load failures (e.g. after deploy with new hashes)
// Auto-reload once; if still failing, show manual reload button
window.addEventListener('error', (e) => {
  if (e.message?.includes('dynamically imported module') || e.message?.includes('Failed to fetch')) {
    const k = 'ipay_chunk_reload'
    if (!sessionStorage.getItem(k)) {
      sessionStorage.setItem(k, '1')
      window.location.reload()
    }
  }
})
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message ?? e.reason ?? '')
  if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch')) {
    const k = 'ipay_chunk_reload'
    if (!sessionStorage.getItem(k)) {
      sessionStorage.setItem(k, '1')
      window.location.reload()
    } else {
      // Show manual reload UI
      const root = document.getElementById('root')
      if (root) root.innerHTML = `
        <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg,#0a0a0a);color:var(--text,#fff);gap:16px;font-family:system-ui">
          <div style="font-size:16px;font-weight:700">App Updated</div>
          <div style="font-size:12px;color:var(--muted,#888)">A new version is available.</div>
          <button onclick="sessionStorage.removeItem('ipay_chunk_reload');window.location.reload()"
            style="padding:10px 24px;border-radius:10px;border:none;background:var(--text,#fff);color:var(--bg,#000);font-size:13px;font-weight:700;cursor:pointer">
            Reload
          </button>
        </div>`
    }
  }
})
// Clear reload flag on successful load
window.addEventListener('load', () => sessionStorage.removeItem('ipay_chunk_reload'))

// Single root, no StrictMode
// Install global click sound (neutral tick on any <button>)
installGlobalClickSound()
// Install global press/tap visual feedback for clickable elements
installPressFeedback()

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Providers>
      <App />
    </Providers>
  </ErrorBoundary>
)
