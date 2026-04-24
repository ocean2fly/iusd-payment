/**
 * ReceivedGiftPreviewModal — iframe preview for a received gift at
 * /gift/show?p=<packetId>. Extracted from Gift.tsx so History.tsx can
 * import it without pulling in the whole Gift page module.
 */
import { useEffect } from 'react'

export function ReceivedGiftPreviewModal({
  packetId,
  onClose,
}: {
  packetId: string
  onClose: () => void
}) {
  // Close on Esc + proper iOS-friendly body scroll lock.
  //
  // Plain `body.style.overflow = 'hidden'` does NOT stop touch scroll on
  // iOS Safari — the backdrop still moves when you drag inside a modal.
  // The canonical fix is the "position: fixed" trick: save the current
  // scrollY, fix the body in place with a negative top, then restore
  // both on unmount.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)

    const scrollY = window.scrollY
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
      touchAction: document.body.style.touchAction,
    }
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.position = prev.position
      document.body.style.top = prev.top
      document.body.style.width = prev.width
      document.body.style.overflow = prev.overflow
      document.body.style.touchAction = prev.touchAction
      window.scrollTo(0, scrollY)
    }
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 12px',
        animation: 'fadeIn 0.2s ease',
        touchAction: 'none',
      }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes modalPop { from { transform: translateY(16px) scale(0.97); opacity: 0 } to { transform: translateY(0) scale(1); opacity: 1 } }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%', maxWidth: 480,
          // Full viewport height inside the modal; the iframe itself is
          // the scroll container. Much more reliable than trying to
          // resize-to-content and have an outer wrapper scroll, because
          // touches on the iframe area don't bubble out to a parent
          // scroller on mobile Safari.
          height: 'calc(100vh - 48px)',
          maxHeight: 820,
          background: 'var(--bg)',
          borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 24px 72px rgba(0,0,0,0.5)',
          animation: 'modalPop 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2)',
          display: 'flex', flexDirection: 'column',
          touchAction: 'auto',
        }}>
        {/* Close button — floats above the iframe content */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(0,0,0,0.55)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.18)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, lineHeight: 1, fontWeight: 500,
            backdropFilter: 'blur(8px)',
            transition: 'background 0.15s',
          }}>
          ×
        </button>
        <iframe
          src={`/gift/show?p=${encodeURIComponent(packetId)}`}
          title="Gift preview"
          style={{
            flex: 1, width: '100%', border: 'none', background: 'var(--bg)',
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}
