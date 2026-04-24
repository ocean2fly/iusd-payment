/**
 * PullToRefresh — global pull-down-to-refresh gesture for PWA / mobile.
 * Triggers window.location.reload() when user pulls past threshold at top of page.
 * Works on any page — attaches to window scroll/touch events.
 */
import { useEffect, useState, useRef } from 'react'
import { playRefresh } from '../lib/sound'

const THRESHOLD = 70
const MAX_PULL = 120

export function PullToRefresh() {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const canPull = useRef(false)

  useEffect(() => {
    // Walk ancestors from the touch target up to <body>. If any ancestor is
    // a fixed-position overlay (modal backdrop, sticky nav) OR has its own
    // vertical scroll container with scrollable content, the gesture
    // belongs to that element — not a page-level refresh.
    function isInsideOverlayOrScroll(target: EventTarget | null): boolean {
      let el = target as HTMLElement | null
      while (el && el !== document.body && el !== document.documentElement) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed') return true
        const oy = cs.overflowY
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return true
        el = el.parentElement
      }
      return false
    }

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0) { canPull.current = false; return }
      if (isInsideOverlayOrScroll(e.target)) { canPull.current = false; return }
      canPull.current = true
      startY.current = e.touches[0].clientY
    }
    function onTouchMove(e: TouchEvent) {
      if (!canPull.current || startY.current === null) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPull(0); return }
      // Apply resistance — feels natural
      const resisted = Math.min(MAX_PULL, dy * 0.5)
      setPull(resisted)
      if (dy > 10) {
        // Prevent browser's native overscroll taking over
        if (e.cancelable) e.preventDefault()
      }
    }
    function onTouchEnd() {
      if (!canPull.current) return
      canPull.current = false
      startY.current = null
      if (pull >= THRESHOLD) {
        setRefreshing(true)
        playRefresh()  // whoosh sound as the reload kicks in
        setTimeout(() => window.location.reload(), 450)
      } else {
        setPull(0)
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [pull])

  if (pull === 0 && !refreshing) return null

  const progress = Math.min(1, pull / THRESHOLD)
  const ready = pull >= THRESHOLD

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999,
      pointerEvents: 'none',
      display: 'flex', justifyContent: 'center',
      transform: `translateY(${refreshing ? 20 : pull - 40}px)`,
      transition: refreshing ? 'transform 0.2s' : 'none',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: 'var(--surface)', border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            color: ready ? '#22c55e' : 'var(--muted)',
            transform: refreshing ? 'rotate(0deg)' : `rotate(${progress * 360}deg)`,
            transition: 'color 0.15s',
            animation: refreshing ? 'ptrSpin 0.8s linear infinite' : undefined,
          }}>
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        <style>{`@keyframes ptrSpin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )
}
