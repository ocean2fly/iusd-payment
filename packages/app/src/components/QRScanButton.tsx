/**
 * QRScanButton — inline scan icon that opens a mini camera scanner overlay.
 * Detects profile, pay-link, invoice, gift, and bare shortId QR codes.
 * Returns the resolved shortId via onScan callback.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import jsQR from 'jsqr'

// ── QR type detection (shared with Scan.tsx) ─────────────────────────��───
function detectShortId(raw: string): string | null {
  try {
    const url = new URL(raw)
    // /pay/:token → extract recipient shortId from the invoice/pay-request
    const payMatch = url.pathname.match(/^\/pay\/([A-Z0-9]{16,32})$/i)
    if (payMatch) return payMatch[1].toUpperCase().slice(0, 16)
    // /user/:shortId or /profile/:shortId
    const userMatch = url.pathname.match(/^\/(?:user|profile)\/([A-Z0-9]{16})$/i)
    if (userMatch) return userMatch[1].toUpperCase()
    // /app/transfer?to=:shortId
    if (url.pathname.startsWith('/app/transfer')) {
      const to = url.searchParams.get('to')
      if (to && /^[A-Z0-9]{16}$/i.test(to)) return to.toUpperCase()
    }
    // /app/gift?to=:shortId
    if (url.pathname.startsWith('/app/gift')) {
      const to = url.searchParams.get('to')
      if (to && /^[A-Z0-9]{16}$/i.test(to)) return to.toUpperCase()
    }
  } catch {}
  // Bare 16-char shortId
  if (/^[A-Z0-9]{16}$/i.test(raw.trim())) return raw.trim().toUpperCase()
  return null
}

interface Props {
  onScan: (shortId: string) => void
  disabled?: boolean
  size?: number
}

export function QRScanButton({ onScan, disabled, size = 18 }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => { if (!disabled) setOpen(true) }}
        title={t('components.qrScan.scanQR')}
        style={{
          background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
          color: 'var(--muted)', padding: 4, display: 'flex', alignItems: 'center',
          opacity: disabled ? 0.3 : 0.7,
        }}
      >
        {/* QR scan icon */}
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7V5a2 2 0 012-2h2" /><path d="M17 3h2a2 2 0 012 2v2" />
          <path d="M21 17v2a2 2 0 01-2 2h-2" /><path d="M7 21H5a2 2 0 01-2-2v-2" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
      </button>
      {open && (
        <ScanOverlay
          onResult={shortId => { setOpen(false); onScan(shortId) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

// ── Scanner overlay ─────────────────────────────────���───────────────────
function ScanOverlay({ onResult, onClose }: { onResult: (shortId: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const barcodeRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    let ok = false
    try { await track.applyConstraints({ advanced: [{ torch: next } as any] } as any); ok = true } catch {}
    if (!ok) { try { await track.applyConstraints({ torch: next } as any); ok = true } catch {} }
    if (!ok) {
      try {
        const IC = (window as any).ImageCapture
        if (IC) { await new IC(track).setOptions?.({ fillLightMode: next ? 'flash' : 'off' }); ok = true }
      } catch {}
    }
    if (ok) setTorchOn(next)
    else console.warn('[QRScanButton] torch unsupported')
  }

  // Init native BarcodeDetector if available
  useEffect(() => {
    if (typeof (window as any).BarcodeDetector !== 'undefined') {
      barcodeRef.current = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
    }
  }, [])

  // Start camera. iOS PWA standalone can throw AbortError
  // ("The operation was aborted.") on the first getUserMedia call — retry
  // once with the minimal {video:true} constraint, which consistently works.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const attempt = async (constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints)
      try {
        let stream: MediaStream
        try {
          stream = await attempt({
            video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 720 } },
          })
        } catch (e: any) {
          const aborted = e?.name === 'AbortError' || /operation was aborted/i.test(e?.message ?? '')
          if (!aborted) throw e
          await new Promise(r => setTimeout(r, 250))
          stream = await attempt({ video: true })
        }
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      } catch {
        setError(t('components.qrScan.cameraUnavailable'))
      }
    })()
    return () => { mounted = false; stopCamera() }
  }, [stopCamera])

  // Scan loop
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    let scanning = true
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    async function tick() {
      if (!scanning || !video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      // Try native BarcodeDetector first
      if (barcodeRef.current) {
        try {
          const results = await barcodeRef.current.detect(video)
          if (results.length > 0) {
            const shortId = detectShortId(results[0].rawValue)
            if (shortId) { scanning = false; stopCamera(); onResult(shortId); return }
          }
        } catch {}
      }

      // Fallback: jsQR
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' })
      if (code?.data) {
        const shortId = detectShortId(code.data)
        if (shortId) { scanning = false; stopCamera(); onResult(shortId); return }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    // Wait for video to be ready before starting scan
    video.addEventListener('loadeddata', () => { rafRef.current = requestAnimationFrame(tick) }, { once: true })
    // If already loaded
    if (video.readyState >= 2) rafRef.current = requestAnimationFrame(tick)

    return () => { scanning = false; cancelAnimationFrame(rafRef.current) }
  }, [onResult, stopCamera])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '85%', maxWidth: 320, borderRadius: 16, overflow: 'hidden',
        background: '#000', position: 'relative',
      }}>
        {error ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#f87171', fontSize: 13 }}>{error}</div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
            {/* Torch toggle (top-right) — hidden on iOS where API isn't supported */}
            {!(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && (
              <button onClick={toggleTorch} title={torchOn ? t('components.qrScan.turnFlashOff') : t('components.qrScan.turnFlashOn')}
                style={{
                  position: 'absolute', top: 10, right: 10, zIndex: 3,
                  width: 38, height: 38, borderRadius: '50%', border: 'none',
                  background: torchOn ? '#FFD700' : 'rgba(0,0,0,0.55)',
                  color: torchOn ? '#1a1a1a' : '#fff',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: torchOn ? '0 0 16px rgba(255,215,0,0.7)' : '0 2px 6px rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(4px)', transition: 'all 0.2s',
                }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={torchOn ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </button>
            )}
            {/* Scan frame overlay */}
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{
                width: '65%', aspectRatio: '1', border: '2px solid rgba(255,255,255,0.5)',
                borderRadius: 12,
              }} />
            </div>
            {/* Scan line animation */}
            <style>{`@keyframes scanLine{0%,100%{top:25%}50%{top:70%}}`}</style>
            <div style={{
              position: 'absolute', left: '20%', right: '20%', height: 2,
              background: 'linear-gradient(90deg, transparent, #22c55e, transparent)',
              animation: 'scanLine 2s ease-in-out infinite', top: '25%',
            }} />
          </>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
      <button onClick={onClose}
        style={{ marginTop: 16, background: 'none', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
        {t('components.qrScan.cancel')}
      </button>
    </div>
  )
}
