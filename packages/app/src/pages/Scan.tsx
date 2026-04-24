/**
 * Scan — /app/scan
 * QR code scanner with three result types:
 *   1. Request/Invoice QR   → /pay/:shortId?... → PayLink (I pay their request)
 *   2. Identity/Transfer QR → shortId only      → Transfer to them or Gift
 *   3. Unknown URL          → show raw + manual shortId input
 *
 * Camera modes:
 *   - Local (default): getUserMedia with environment facing mode
 *   - Remote (Phone):  desktop creates session → phone opens relay page → scans → result sent back
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowUpRight, Gift, UserPlus, Check } from 'lucide-react'
import { dnaColor as getDnaColor } from '../lib/dnaColor'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSmartClose } from '../lib/navUtil'
import jsQR from 'jsqr'
import { API_BASE } from '../config'
// StyledQR import removed — phone relay feature removed
import { upsertContact, isDeletedContact, loadDeletedContacts, saveDeletedContacts } from '../lib/contactsStore'
import { useAuthContext } from '../hooks/AuthContext'

const APP_ORIGIN = 'https://iusd-pay.xyz'

// ── URL type detection ──────────────────────────────────────────────────────
type ScanResult =
  | { type: 'request';  url: string; shortId: string; params: URLSearchParams }
  | { type: 'identity'; shortId: string; nickname?: string }
  | { type: 'pay-request'; path: string }
  | { type: 'unknown';  raw: string }

function detectQR(raw: string): ScanResult {
  try {
    const url = new URL(raw)
    // 1. Request/Invoice: /pay/:token  (token = 16-char shortId OR 24-char hex invoice token)
    const payMatch = url.pathname.match(/^\/pay\/([A-Z0-9]{16,32})$/i)
    if (payMatch) {
      return { type: 'request', url: raw, shortId: payMatch[1].toUpperCase(), params: url.searchParams }
    }
    // 1b. Pay-request (dynamic payment code): /pay-request/:token
    const payReqMatch = url.pathname.match(/^\/(?:pay-request|pr)\/([a-f0-9]{16,32})$/i)
    if (payReqMatch) {
      return { type: 'pay-request', path: `/pr/${payReqMatch[1]}` }
    }
    // 1c. Verify/Receipt: /verify?pid=... or /receipt/:paymentId
    if (url.pathname === '/verify' && url.searchParams.get('pid')) {
      return { type: 'pay-request', path: `/verify${url.search}` }
    }
    const receiptMatch = url.pathname.match(/^\/receipt\/(.+)$/i)
    if (receiptMatch) {
      return { type: 'pay-request', path: url.pathname }
    }
    // 1d. Gift claim: /g/:code
    const giftMatch = url.pathname.match(/^\/g\/(.+)$/i)
    if (giftMatch) {
      return { type: 'pay-request', path: url.pathname }
    }
    // 2. User identity: /user/:shortId or /profile/:shortId
    const userMatch = url.pathname.match(/^\/(?:user|profile)\/([A-Z0-9]{16})$/i)
    if (userMatch) return { type: 'identity', shortId: userMatch[1].toUpperCase() }
    // 3. Transfer: /app/transfer?to=:shortId
    if (url.pathname.startsWith('/app/transfer')) {
      const to = url.searchParams.get('to')
      if (to) return { type: 'identity', shortId: to.toUpperCase() }
    }
  } catch {}
  // 4. Bare 16-char base36 shortId
  if (/^[A-Z0-9]{16}$/i.test(raw.trim())) {
    return { type: 'identity', shortId: raw.trim().toUpperCase() }
  }
  return { type: 'unknown', raw }
}

// ── Component ───────────────────────────────────────────────────────────────
export function Scan() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const smartClose = useSmartClose('/app')
  const { address } = useAuthContext()


  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [camIdx,  setCamIdx]  = useState(0)
  const [mobileFacing, setMobileFacing] = useState<'environment'|'user'>('environment')
  const [scanning, setScanning] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [error,    setError]    = useState<string|null>(null)
  // Phone relay
  const [_relayId,   setRelayId]    = useState<string|null>(null)
  const [rtcStatus,  setRtcStatus]  = useState<'idle'|'connecting'|'connected'|'error'>('idle')
  const [relayScanning, setRelayScanning] = useState(false)
  // Image QR scan
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRelayRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection|null>(null)
  const [relayUrl,   setRelayUrl]   = useState<string|null>(null)
  const [_relayPoll, setRelayPoll]  = useState(false)

  // Result
  const [result, setResult] = useState<ScanResult|null>(null)
  const [loading, setLoading] = useState(false)
  const [contactSaved, setContactSaved] = useState(false)
  const [wasDeleted, setWasDeleted] = useState(false)
  const [settingsCopied, setSettingsCopied] = useState(false)
  const [recipientInfo, setRecipientInfo] = useState<{nickname:string;shortId?:string;shortSealSvg?:string|null;bio?:string;userAddress?:string}|null>(null)

  // Manual input fallback
  const [manual, setManual] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream|null>(null)
  const rafRef    = useRef<number>(0)
  const pollRef   = useRef<ReturnType<typeof setInterval>|null>(null)

  // ── Camera setup ─────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanning(false)
    setTorchOn(false)
    setTorchSupported(false)
  }, [])

  const [torchError, setTorchError] = useState<string | null>(null)
  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) { console.warn('[Scan] no video track'); return }
    const next = !torchOn
    console.log('[Scan] toggleTorch →', next, 'caps:', track.getCapabilities?.())

    // Strategy 1: applyConstraints with advanced (standard on Android Chrome)
    let ok = false
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] } as any)
      ok = true
    } catch (e) {
      console.warn('[Scan] advanced torch failed, trying flat', e)
    }
    // Strategy 2: flat torch constraint
    if (!ok) {
      try {
        await track.applyConstraints({ torch: next } as any)
        ok = true
      } catch (e) {
        console.warn('[Scan] flat torch failed, trying ImageCapture', e)
      }
    }
    // Strategy 3: ImageCapture fillLightMode
    if (!ok) {
      try {
        const IC = (window as any).ImageCapture
        if (IC) {
          const ic = new IC(track)
          await ic.setOptions?.({ fillLightMode: next ? 'flash' : 'off' })
          ok = true
        }
      } catch (e) {
        console.warn('[Scan] ImageCapture torch failed', e)
      }
    }

    if (ok) {
      setTorchOn(next)
      setTorchError(null)
    } else {
      setTorchError(t('scan.err.flashNotSupported'))
      setTimeout(() => setTorchError(null), 2500)
    }
  }

  const startCamera = useCallback(async (idx = 0, facingOverride?: 'environment'|'user') => {
    stopCamera()
    setError(null)

    // iOS PWA (display-mode: standalone) has known getUserMedia quirks:
    //   - navigator.permissions.query({name:'camera'}) can itself throw or
    //     lie, and any call to enumerateDevices() before a permission grant
    //     makes the subsequent getUserMedia reject with AbortError
    //     ("The operation was aborted.")
    //   - facingMode:{exact:...} is stricter than needed; plain string
    //     'environment' is more forgiving.
    // Detect standalone and take a simpler, PWA-safe code path that:
    //   (a) skips the pre-flight permissions + enumerate calls,
    //   (b) calls getUserMedia first with a simple constraint,
    //   (c) enumerates devices only AFTER we have a granted stream,
    //   (d) retries with {video:true} if we still hit AbortError.
    const isStandalone = typeof window !== 'undefined' && (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true
    )

    if (!isStandalone) {
      try {
        const perm = await navigator.permissions?.query({ name: 'camera' as PermissionName })
        if (perm?.state === 'denied') { setError('PERMISSION_DENIED'); return }
      } catch { /* permissions API not supported — proceed anyway */ }
    }

    // Build primary constraints. Standalone gets the simpler shape.
    const wantFacing = facingOverride ?? 'environment'
    const primary: MediaStreamConstraints = isStandalone
      ? { video: { facingMode: wantFacing } }
      : {
          video: facingOverride
            ? { facingMode: { exact: facingOverride }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        }

    // Pre-enumerate ONLY for the non-standalone path and only when the caller
    // asked for a specific device index (no facingOverride). Keeps the
    // standalone path off the pre-enumeration trap entirely.
    let chosenDeviceId: string | null = null
    if (!isStandalone && !facingOverride) {
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices())
          .filter(d => d.kind === 'videoinput')
        setCameras(devices)
        if (devices.length > 0 && devices[idx]) {
          chosenDeviceId = devices[idx].deviceId
        }
      } catch { /* non-fatal — fall through */ }
    }
    const constraints: MediaStreamConstraints = chosenDeviceId
      ? { video: { deviceId: { exact: chosenDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } }
      : primary

    const attach = async (stream: MediaStream) => {
      streamRef.current = stream
      setTorchOn(false)
      try {
        const track = stream.getVideoTracks()[0]
        const caps: any = track?.getCapabilities?.() ?? {}
        setTorchSupported(Object.prototype.hasOwnProperty.call(caps, 'torch'))
      } catch { setTorchSupported(false) }
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        console.log('[Scan] video playing, readyState:', videoRef.current.readyState,
                    'size:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight)
      }
      setScanning(true)
      // Now that permission is granted, populate the camera switcher list.
      if (isStandalone) {
        try {
          const devices = (await navigator.mediaDevices.enumerateDevices())
            .filter(d => d.kind === 'videoinput')
          setCameras(devices)
        } catch { /* non-fatal */ }
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      await attach(stream)
    } catch (e: any) {
      const name = e?.name ?? ''
      const msg: string = e?.message ?? ''
      const aborted = name === 'AbortError' || /operation was aborted/i.test(msg)

      if (aborted) {
        // iOS PWA AbortError — retry once with the most permissive constraint.
        try {
          await new Promise(r => setTimeout(r, 250))
          const fallback = await navigator.mediaDevices.getUserMedia({ video: true })
          await attach(fallback)
          return
        } catch (e2: any) {
          const n2 = e2?.name ?? ''
          if (n2 === 'NotAllowedError' || n2 === 'PermissionDeniedError') {
            setError('PERMISSION_DENIED'); return
          }
          setError(e2?.message ?? msg ?? 'Camera aborted')
          return
        }
      }

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('PERMISSION_DENIED')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('NO_CAMERA')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setError('IN_USE')
      } else if (name === 'OverconstrainedError') {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          })
          await attach(fallbackStream)
          return
        } catch {
          setError('OVERCONSTRAINED')
        }
      } else {
        setError(msg || 'Unknown camera error')
      }
    }
  }, [stopCamera])

  // ── QR scan loop ──────────────────────────────────────────────────────────
  // Prefer native BarcodeDetector (hardware-accelerated, iOS Safari 15.4+, Chrome)
  // Fallback to jsQR (software decode, slower)
  const handleResultRef = useRef(handleResult)
  handleResultRef.current = handleResult
  const barcodeDetectorRef = useRef<any>(null)
  const decodingRef = useRef(false)

  useEffect(() => {
    if (typeof (window as any).BarcodeDetector !== 'undefined') {
      barcodeDetectorRef.current = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      console.log('[Scan] Using native BarcodeDetector')
    } else {
      console.log('[Scan] BarcodeDetector not available, using jsQR fallback')
    }
  }, [])

  const tick = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(tick); return
    }

    const detector = barcodeDetectorRef.current
    if (detector && !decodingRef.current) {
      // Native BarcodeDetector: fast, async, works directly on video element
      decodingRef.current = true
      detector.detect(video).then((codes: any[]) => {
        decodingRef.current = false
        if (codes.length > 0) {
          stopCamera()
          handleResultRef.current(codes[0].rawValue)
          return
        }
        rafRef.current = requestAnimationFrame(tick)
      }).catch(() => {
        decodingRef.current = false
        rafRef.current = requestAnimationFrame(tick)
      })
      return
    }

    if (!detector) {
      // jsQR fallback
      const canvas = canvasRef.current
      if (!canvas) { rafRef.current = requestAnimationFrame(tick); return }
      const ctx = canvas.getContext('2d')!
      const w = video.videoWidth, h = video.videoHeight
      if (w === 0 || h === 0) { rafRef.current = requestAnimationFrame(tick); return }
      canvas.width = w; canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      const imgData = ctx.getImageData(0, 0, w, h)
      const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' })
      if (code?.data) {
        stopCamera()
        handleResultRef.current(code.data)
        return
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [stopCamera])

  useEffect(() => {
    if (scanning) { rafRef.current = requestAnimationFrame(tick) }
    return () => cancelAnimationFrame(rafRef.current)
  }, [scanning, tick])

  // Also scan relay video frames when live WebRTC connected
  const relayRafRef = useRef<number>(0)
  useEffect(() => {
    if (rtcStatus !== 'connected' || !relayScanning) { cancelAnimationFrame(relayRafRef.current); return }

    // Use an offscreen canvas — canvasRef may not be in DOM during phone mode
    const offscreen = document.createElement('canvas')
    const MAX_DIM = 640  // scale down for faster jsQR processing

    function tickRelay() {
      const v = videoRelayRef.current
      if (!v || v.readyState < 2 || v.videoWidth === 0) {
        relayRafRef.current = requestAnimationFrame(tickRelay); return
      }
      // Scale down to MAX_DIM to speed up jsQR
      const scale  = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight))
      offscreen.width  = Math.round(v.videoWidth  * scale)
      offscreen.height = Math.round(v.videoHeight * scale)
      const ctx = offscreen.getContext('2d')!
      ctx.drawImage(v, 0, 0, offscreen.width, offscreen.height)
      const img  = ctx.getImageData(0, 0, offscreen.width, offscreen.height)
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
      if (code?.data) {
        cancelAnimationFrame(relayRafRef.current)
        const val = code.data
        clearRtc(); clearPolling(); setRelayPoll(false)
        handleResult(val)
        return
      }
      relayRafRef.current = requestAnimationFrame(tickRelay)
    }
    relayRafRef.current = requestAnimationFrame(tickRelay)
    return () => cancelAnimationFrame(relayRafRef.current)
  }, [rtcStatus, relayScanning])  // eslint-disable-line

  // ── Auto-start camera on mount (mobile only) ─────────────────────────────
  useEffect(() => {
    if (isMobile) startCamera(0, 'environment')
    return () => { stopCamera(); clearPolling(); clearRtc() }
  }, [])  // eslint-disable-line

  // ── Phone relay ───────────────────────────────────────────────────────────
  function scanImageFile(file: File) {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      // Try multiple resolutions — QR may be small in high-res images
      const sizes = [2400, 1600, 1000, 600]
      for (const MAX of sizes) {
        const cvs = document.createElement('canvas')
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        cvs.width  = Math.round(img.width  * scale)
        cvs.height = Math.round(img.height * scale)
        cvs.getContext('2d')!.drawImage(img, 0, 0, cvs.width, cvs.height)
        const imgData = cvs.getContext('2d')!.getImageData(0, 0, cvs.width, cvs.height)
        const code = jsQR(imgData.data, imgData.width, imgData.height)
        if (code?.data) {
          URL.revokeObjectURL(url)
          handleResult(code.data)
          return
        }
      }
      URL.revokeObjectURL(url)
      setError(t('scan.err.noQrInImage'))
    }
    img.src = url
  }

  const STUN = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]}

  // @ts-ignore — kept for potential future WebRTC live relay
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function _startLiveRelay(id: string) {
    setRtcStatus('connecting')
    const pc = new RTCPeerConnection(STUN)
    pcRef.current = pc

    // Receive phone video track
    pc.ontrack = (e) => {
      if (videoRelayRef.current && e.streams[0]) {
        videoRelayRef.current.srcObject = e.streams[0]
        setRtcStatus('connected')
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setRtcStatus('error')
    }

    // Collect and send ICE candidates
    pc.onicecandidate = async (e) => {
      if (e.candidate) {
        await fetch(`${API_BASE}/scan-relay/${id}/ice/desktop`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ candidate: e.candidate }),
        }).catch(() => {})
      }
    }

    // Add recvonly transceiver (desktop only receives)
    pc.addTransceiver('video', { direction: 'recvonly' })

    // Create offer and post to signaling
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await fetch(`${API_BASE}/scan-relay/${id}/offer`, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sdp: offer }),
    })

    // Poll for answer
    let answerTries = 0
    const pollAnswer = async () => {
      answerTries++
      if (answerTries > 60) { setRtcStatus('error'); return }
      try {
        const r = await fetch(`${API_BASE}/scan-relay/${id}/answer`)
        const d = await r.json()
        if (d.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(d.sdp))
          // Start polling phone's ICE candidates
          pollPhoneIce(id, 0)
          return
        }
      } catch {}
      pollRef.current = setTimeout(pollAnswer, 1500) as unknown as ReturnType<typeof setInterval>
    }
    pollAnswer()
  }

  async function pollPhoneIce(id: string, offset: number) {
    try {
      const r = await fetch(`${API_BASE}/scan-relay/${id}/ice/phone`)
      const d = await r.json()
      const candidates: RTCIceCandidateInit[] = d.candidates ?? []
      for (let i = offset; i < candidates.length; i++) {
        await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidates[i]))
      }
      if (candidates.length < 20 && pcRef.current?.connectionState !== 'connected') {
        setTimeout(() => pollPhoneIce(id, candidates.length), 1500)
      }
    } catch {}
  }

  function clearRtc() {
    pcRef.current?.close()
    pcRef.current = null
    setRtcStatus('idle')
    if (videoRelayRef.current) videoRelayRef.current.srcObject = null
  }

  function clearPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); clearTimeout(pollRef.current as unknown as ReturnType<typeof setTimeout>) }
  }

  // @ts-ignore — kept for potential future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function _startPhoneRelay() {
    setError(null); clearRtc()
    try {
      const res  = await fetch(`${API_BASE}/scan-relay`, { method: 'POST' })
      const data = await res.json()
      const id   = data.sessionId as string
      setRelayId(id)
      const qUrl = `${APP_ORIGIN}/scan-relay/${id}`
      setRelayUrl(qUrl)
      setRelayPoll(true)

      // Poll for basic relay result (phone scans QR and sends result via HTTP)
      const pollResult = async () => {
        try {
          const r = await fetch(`${API_BASE}/scan-relay/${id}`)
          const d = await r.json()
          if (d.result) {
            setRelayUrl(null)
            handleResult(d.result)
            return
          }
        } catch {}
        setTimeout(pollResult, 2000)
      }
      pollResult()
    } catch {
      setError(t('scan.err.couldNotCreateRelay'))
    }
  }

  // ── Result handler ────────────────────────────────────────────────────────
  async function handleResult(raw: string) {
    console.log('[Scan] raw QR data:', raw)
    const r = detectQR(raw)
    console.log('[Scan] detected type:', r.type, r)
    setResult(r)

    // PayLink QR → navigate directly to /pay/:token (opens the full PayLink page)
    if (r.type === 'request') {
      stopCamera()
      const path = new URL(r.url).pathname  // e.g. /pay/ccab649eda47e917e2903425
      navigate(path)
      return
    }

    // Dynamic payment code → navigate to /pay-request/:token
    if (r.type === 'pay-request') {
      stopCamera()
      navigate(r.path)
      return
    }

    if (r.type === 'identity') {
      setLoading(true)
      try {
        const sid = r.shortId
        const res = await fetch(`${API_BASE}/account/${sid}`)
        const d   = await res.json()
        if (d.account) {
          setRecipientInfo({ nickname: d.account.nickname, shortId: sid, shortSealSvg: d.account.shortSealSvg, bio: d.account.bio ?? '', userAddress: d.account.address ?? '' })
          // Check if previously deleted
          if (address && isDeletedContact(address, sid)) {
            setWasDeleted(true)
          } else if (address) {
            // Silently auto-add to contacts on scan (user can remove later)
            upsertContact(address, {
              shortId: sid,
              nickname: d.account.nickname ?? sid,
              shortSealSvg: d.account.shortSealSvg ?? null,
            })
            setContactSaved(true)
          }
        }
      } catch {}
      setLoading(false)
    }
  }

  function addContact() {
    const shortId  = result?.type === 'identity' ? result.shortId
                   : result?.type === 'request'  ? (result as any).shortId
                   : null
    const nickname = recipientInfo?.nickname ?? shortId ?? ''
    if (!shortId || !address) return
    // Clear deletion history so upsertContact succeeds
    if (isDeletedContact(address, shortId)) {
      const deleted = loadDeletedContacts(address)
      saveDeletedContacts(address, deleted.filter(id => id !== shortId.toUpperCase()))
      setWasDeleted(false)
    }
    upsertContact(address, {
      shortId,
      nickname,
      shortSealSvg: recipientInfo?.shortSealSvg ?? null,
    })
    setContactSaved(true)
    setTimeout(() => setContactSaved(false), 2500)
  }

  function handleManual() {
    if (!manual.trim()) return
    handleResult(manual.trim())
    setManual('')
  }

  function reset() {
    setResult(null)
    setRecipientInfo(null)
    setError(null)
    startCamera(camIdx)
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function goPayRequest() {
    if (result?.type !== 'request') return
    // Navigate to PayLink which handles the full payment confirmation
    const url = new URL(result.url)
    navigate(url.pathname + url.search)
  }

  function goTransfer() {
    const shortId = result?.type === 'identity' ? result.shortId
                  : result?.type === 'request'  ? (result as any).shortId
                  : null
    if (!shortId) return
    navigate(`/app/transfer?to=${shortId}`)
  }

  function goGift() {
    const shortId = result?.type === 'identity' ? result.shortId : null
    if (!shortId) return
    navigate(`/app/gift?sendTo=${shortId}`)
  }

  // ── Render: Result ────────────────────────────────────────────────────────
  if (result) {
    const isRequest  = result.type === 'request'
    const isIdentity = result.type === 'identity'
    const isUnknown  = result.type === 'unknown'
    const amount     = isRequest ? result.params.get('amount') ?? '' : ''
    const note       = isRequest ? (result.params.get('note') ?? result.params.get('inv') ?? '') : ''
    const merchant   = isRequest ? result.params.get('merchant') ?? '' : ''
    const due        = isRequest ? result.params.get('due') ?? '' : ''

    return (
      <div style={pageSt}>
        <div style={headerSt}>
          <button onClick={reset} style={backBtn}>{t('scan.scanAgain')}</button>
          <span style={{ fontSize:11, color:'var(--muted)' }}>
            {isRequest ? t('scan.tagInvoice') : isIdentity ? t('scan.tagIdentity') : t('scan.tagScanned')}
          </span>
        </div>

        {loading && <div style={{ color:'var(--muted)', fontSize:12 }}>{t('scan.lookingUp')}</div>}

        {/* Recipient identity — ProfileCard style */}
        {recipientInfo && (() => {
          const sid = recipientInfo.shortId ?? ''
          const nick = recipientInfo.nickname
          const dnaColor = getDnaColor(recipientInfo.userAddress || '')
          const head = sid.slice(0, 4)
          const tail = sid.slice(-4)
          const slogan = recipientInfo.bio || t('profile.defaultSlogan')
          return (
            <div style={{
              ...card, padding: 0, overflow: 'hidden',
              background: 'var(--surface)',
              borderLeft: `3px solid ${dnaColor}`,
            }}>
              <div style={{ padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                {/* nickname@ID-DNA — one line */}
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                  {nick}
                  {sid && (
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: dnaColor, marginLeft: 4, fontWeight: 500 }}>
                      @{head}◆◆◆{tail}
                    </span>
                  )}
                </div>
                {/* Slogan — artistic Google Font */}
                <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@500&display=swap" />
                <div style={{ fontSize: 16, color: 'var(--text)', textAlign: 'center', lineHeight: 1.5, fontFamily: "'Dancing Script', cursive", opacity: 0.8 }}>
                  {slogan}
                </div>
                {isRequest && merchant && merchant !== nick && (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{merchant}</div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Request details */}
        {isRequest && (
          <div style={card}>
            <div style={sLabel}>{t('scan.paymentDetails')}</div>
            <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
              {amount && (
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:14 }}>
                  <span style={{ color:'var(--muted)' }}>{t('transfer.amountLabel')}</span>
                  <span style={{ fontWeight:800 }}>{amount} <span style={{ fontSize:10, color:'var(--muted)' }}>iUSD</span></span>
                </div>
              )}
              {note && (
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                  <span style={{ color:'var(--muted)' }}>{t('request.noteLabel')}</span>
                  <span>{note}</span>
                </div>
              )}
              {due && (
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                  <span style={{ color:'var(--muted)' }}>{t('scan.due')}</span>
                  <span>{new Date(due+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        {isRequest && (
          <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', gap:8 }}>
            <button onClick={goPayRequest}
              style={{ ...btnFill, width:'100%', fontSize:14, padding:'14px' }}>
              {amount ? t('scan.payAmount', { amount }) : t('scan.payRequest')}
            </button>
            <button onClick={addContact} style={{ ...btnGhost, width:'100%', fontSize:12 }}>
              {contactSaved ? t('scan.contactSaved') : wasDeleted ? t('scan.reAddContactsTag') : t('scan.addContactsTag')}
            </button>
          </div>
        )}
        {isIdentity && (
          <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={goTransfer} style={{ ...btnFill, flex:2, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <ArrowUpRight size={16} strokeWidth={2} />
                {t('scan.transfer')}
              </button>
              <button onClick={goGift} style={{ ...btnGhost, flex:1, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <Gift size={16} strokeWidth={2} />
                {t('scan.gift')}
              </button>
            </div>
            <button onClick={addContact} disabled={contactSaved && !wasDeleted} style={{ ...btnGhost, width:'100%', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center', gap:6, opacity: contactSaved && !wasDeleted ? 0.5 : 1 }}>
              {contactSaved && !wasDeleted ? (
                <>
                  <Check size={14} strokeWidth={2.5} color="#22c55e" />
                  {t('scan.contactAlreadyAdded')}
                </>
              ) : (
                <>
                  <UserPlus size={14} strokeWidth={2} />
                  {wasDeleted ? t('scan.reAddToContacts') : t('scan.addToContacts')}
                </>
              )}
            </button>
          </div>
        )}
        {isUnknown && (
          <div style={card}>
            <div style={sLabel}>{t('scan.scannedContent')}</div>
            <div style={{ marginTop:6, fontSize:11, fontFamily:'monospace',
                          wordBreak:'break-all', color:'var(--muted)' }}>
              {(result as any).raw}
            </div>
            {/* If it's a valid URL, show a Visit button */}
            {(() => {
              try {
                const url = new URL((result as any).raw)
                if (url.protocol === 'https:' || url.protocol === 'http:') {
                  return (
                    <button
                      onClick={() => {
                        // Same-origin: navigate internally; external: open new tab
                        if (url.hostname === window.location.hostname) {
                          navigate(url.pathname + url.search)
                        } else {
                          window.open((result as any).raw, '_blank')
                        }
                      }}
                      style={{ ...btnFill, marginTop:10, fontSize:12 }}
                    >
                      {t('scan.visit')}
                    </button>
                  )
                }
              } catch {}
              return null
            })()}
          </div>
        )}
      </div>
    )
  }

  // ── Render: Scanner ────────────────────────────────────────────────────────
  return (
    <div style={pageSt}>
      <div style={headerSt}>
        <button onClick={smartClose} style={backBtn}>←</button>
        <span style={{ fontSize:14, fontWeight:700, flex:1 }}>{t('scan.title')}</span>
      </div>

      {/* ── Camera ── */}
      <div style={{
            width:'100%', maxWidth:480, aspectRatio:'1',
            borderRadius:20, overflow:'hidden', position:'relative',
            background:'#000', border:'2px solid var(--border)',
          }}>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            <canvas ref={canvasRef} style={{ display:'none' }} />

            {/* Torch toggle — only shown when the camera track actually advertises
                a `torch` capability. Desktops/laptops (MacBook, Windows, Linux)
                and iOS devices don't, so the button stays hidden there. */}
            {scanning && torchSupported && (
              <button onClick={toggleTorch}
                title={torchOn ? t('components.qrScan.turnFlashOff') : t('components.qrScan.turnFlashOn')}
                style={{
                  position: 'absolute', top: 12, right: 12, zIndex: 6,
                  width: 40, height: 40, borderRadius: '50%', border: 'none',
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
            {torchError && (
              <div style={{
                position: 'absolute', top: 62, right: 12, zIndex: 6,
                background: 'rgba(0,0,0,0.75)', color: '#fff',
                fontSize: 10, padding: '6px 10px', borderRadius: 8,
                backdropFilter: 'blur(4px)',
              }}>{torchError}</div>
            )}

            {/* Start camera overlay — shown when camera is off */}
            {!scanning && !error && (
              <div style={{
                position:'absolute', inset:0, display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'center', gap:12,
                background:'rgba(0,0,0,0.7)', zIndex:5,
              }}>
                <button
                  onClick={() => startCamera(camIdx)}
                  style={{
                    width:64, height:64, borderRadius:'50%',
                    background:'rgba(255,255,255,0.15)', border:'2px solid rgba(255,255,255,0.5)',
                    cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                    transition:'all 0.2s',
                  }}
                  title={t('scan.startCamera')}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                  </svg>
                </button>
                <span style={{ fontSize:12, color:'rgba(255,255,255,0.5)', letterSpacing:'0.05em' }}>
                  {t('scan.clickToStart')}
                </span>
              </div>
            )}

            {/* Scan frame overlay with animated scan line */}
            {!relayUrl && (
              <div style={{
                position:'absolute', inset:0, pointerEvents:'none',
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <div style={{
                  width:'60%', height:'60%', border:'2px solid rgba(255,255,255,0.8)',
                  borderRadius:12, boxShadow:'0 0 0 9999px rgba(0,0,0,0.4)',
                  position:'relative', overflow:'hidden',
                }}>
                  {/* Animated scan line — visible when scanning */}
                  {scanning && (
                    <div style={{
                      position:'absolute', left:0, right:0, height:2,
                      background:'linear-gradient(90deg, transparent, #22c55e, transparent)',
                      boxShadow:'0 0 12px 2px rgba(34,197,94,0.5)',
                      animation:'scanLine 2s ease-in-out infinite',
                    }} />
                  )}
                </div>
                <style>{`@keyframes scanLine { 0% { top:0 } 50% { top:calc(100% - 2px) } 100% { top:0 } }`}</style>
              </div>
            )}

            {/* (Mobile camera relay removed — desktop uses external scanner only) */}
            {rtcStatus === 'connected' && relayScanning && (
              <div style={{
                position:'absolute', bottom:16, left:0, right:0,
                display:'flex', justifyContent:'center',
              }}>
                <div style={{ fontSize:11, color:'rgba(34,197,94,0.95)', fontWeight:600,
                              background:'rgba(0,0,0,0.5)', padding:'4px 14px', borderRadius:20 }}>
                  {t('scan.pointPhone')}
                </div>
              </div>
            )}

            {/* Bottom controls */}
            {!relayUrl && (
              <div style={{
                position:'absolute', bottom:0, left:0, right:0,
                display:'flex', justifyContent:'center', alignItems:'flex-end',
                pointerEvents:'none',
                background:'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)',
                paddingBottom:14, paddingTop:28,
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, pointerEvents:'auto' }}>
                  {/* Stop camera */}
                  {scanning && (
                    <button
                      onClick={() => stopCamera()}
                      style={{
                        width:44, height:44, borderRadius:'50%',
                        background:'rgba(255,255,255,0.18)', border:'2px solid rgba(255,255,255,0.8)',
                        backdropFilter:'blur(8px)', cursor:'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 2px 12px rgba(0,0,0,0.4)',
                      }}
                      title={t('scan.stopCamera')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                        <line x1="1" y1="1" x2="23" y2="23" stroke="rgba(255,80,80,0.9)" strokeWidth="2.5"/>
                      </svg>
                    </button>
                  )}
                  {/* Flip camera (mobile only) */}
                  {isMobile && scanning && (
                    <button
                      onClick={() => {
                        const next = mobileFacing === 'environment' ? 'user' : 'environment'
                        setMobileFacing(next)
                        startCamera(0, next)
                      }}
                      style={{
                        width:44, height:44, borderRadius:'50%',
                        background:'rgba(255,255,255,0.18)', border:'2px solid rgba(255,255,255,0.6)',
                        backdropFilter:'blur(8px)', cursor:'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 2px 12px rgba(0,0,0,0.4)',
                      }}
                      title={t('scan.flipCamera')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
                        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* Disconnect button when live relay active */}
            {relayUrl && rtcStatus === 'connected' && (
              <div style={{ position:'absolute', top:10, left:12 }}>
                <button
                  onClick={() => { clearPolling(); clearRtc(); setRelayUrl(null); setRelayPoll(false); setRelayId(null); setRelayScanning(false) }}
                  style={{
                    fontSize:10, color:'rgba(255,255,255,0.6)', background:'rgba(0,0,0,0.4)',
                    border:'1px solid rgba(255,255,255,0.2)', borderRadius:6,
                    padding:'3px 10px', cursor:'pointer',
                  }}>
                  {t('scan.disconnect')}
                </button>
              </div>
            )}
          </div>

          {error && (
            <div style={{ ...card, background:'rgba(239,68,68,0.06)', borderColor:'rgba(239,68,68,0.3)' }}>
              {error === 'PERMISSION_DENIED' ? (
                <>
                  <div style={{ fontSize:13, fontWeight:700, color:'#ef4444', marginBottom:8 }}>
                    {t('scan.err.accessBlocked')}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text)', lineHeight:1.6, marginBottom:12 }}>
                    {t('scan.err.permissionDesc')}
                  </div>

                  {/* Chrome: direct settings link */}
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--text)', marginBottom:6 }}>
                      {t('scan.err.chromeEdge')}
                    </div>
                    <div style={{ fontSize:10, color:'var(--muted)', marginBottom:6, lineHeight:1.6 }}>
                      {t('scan.err.pasteInstructions')} <strong>{t('scan.err.allow')}</strong>:
                    </div>
                    <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                      <div style={{
                        flex:1, padding:'6px 8px', borderRadius:6,
                        background:'var(--bg)', border:'1px solid var(--border)',
                        fontSize:9, fontFamily:'monospace', color:'var(--muted)',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      }}>
                        chrome://settings/content/siteDetails?site=https%3A%2F%2Fiusd-pay.xyz
                      </div>
                      <button onClick={() => {
                        navigator.clipboard.writeText('chrome://settings/content/siteDetails?site=https%3A%2F%2Fiusd-pay.xyz')
                        setSettingsCopied(true); setTimeout(() => setSettingsCopied(false), 2000)
                      }} style={{ ...btnFill, padding:'6px 10px', fontSize:10, flexShrink:0 }}>
                        {settingsCopied ? '✓' : t('scan.err.copy')}
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize:10, color:'var(--muted)', lineHeight:1.7, borderTop:'1px solid var(--border)', paddingTop:8 }}>
                    <div>🦊 <strong>Firefox:</strong> {t('scan.err.firefoxHint')}</div>
                    <div>🍎 <strong>Safari/iOS:</strong> {t('scan.err.safariHint')}</div>
                    <div>📱 <strong>Android Chrome:</strong> {t('scan.err.androidHint')}</div>
                  </div>

                  <button onClick={() => startCamera(camIdx)}
                    style={{ ...btnFill, marginTop:10, width:'100%', fontSize:11 }}>
                    {t('scan.err.retryAfter')}
                  </button>
                </>
              ) : error === 'NO_CAMERA' ? (
                <>
                  <div style={{ fontSize:13, fontWeight:700, color:'#f59e0b', marginBottom:6 }}>{t('scan.err.noCamera')}</div>
                  <div style={{ fontSize:11, color:'var(--muted)', lineHeight:1.6 }}>
                    {t('scan.err.noCameraDesc')}
                    {!isMobile && <> {t('scan.err.useManualFull')}</>}
                  </div>
                </>
              ) : error === 'IN_USE' ? (
                <>
                  <div style={{ fontSize:13, fontWeight:700, color:'#f59e0b', marginBottom:6 }}>{t('scan.err.inUse')}</div>
                  <div style={{ fontSize:11, color:'var(--muted)' }}>
                    {t('scan.err.inUseDesc')}
                  </div>
                  <button onClick={() => startCamera(camIdx)} style={{ ...btnFill, marginTop:10, fontSize:11 }}>{t('scan.retry')}</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize:12, color:'#ef4444' }}>⚠️ {error}</div>
                  <button onClick={() => startCamera(camIdx)} style={{ ...btnFill, marginTop:8, fontSize:11 }}>{t('scan.retry')}</button>
                </>
              )}
            </div>
          )}

          {/* Camera selector (desktop with multiple cameras) */}
          {cameras.length > 1 && (
            <div style={{ width:'100%', maxWidth:480, display:'flex', gap:6, overflowX:'auto' }}>
              {cameras.map((cam, i) => (
                <button key={cam.deviceId} onClick={() => { setCamIdx(i); startCamera(i) }}
                  style={{
                    padding:'5px 10px', borderRadius:20, border:'none', cursor:'pointer',
                    fontSize:9, fontWeight:700, flexShrink:0,
                    background: camIdx === i ? 'var(--text)' : 'var(--surface)',
                    color:      camIdx === i ? 'var(--surface)' : 'var(--muted)',
                  }}>
                  {cam.label || t('scan.cameraN', { n: i+1 })}
                </button>
              ))}
            </div>
          )}

      {/* ── Mobile Camera button (desktop only, below viewport) ── */}
      {/* ── Manual input fallback ── */}
      <div style={card}>
        <div style={sLabel}>{t('scan.manualInput')}</div>
        <div style={{ display:'flex', gap:6, marginTop:6 }}>
          <input type="text" placeholder={t('scan.pasteHint')}
            value={manual} onChange={e => setManual(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManual()}
            style={{ ...inputSt, flex:1 }} />
          <button onClick={handleManual} style={{ ...btnFill, padding:'8px 12px', fontSize:11 }}>
            {t('scan.go')}
          </button>
        </div>
        {/* Image drag-drop + file pick — prominent button */}
        <button
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) scanImageFile(f) }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginTop:8, width:'100%', border:`1.5px dashed ${dragOver ? '#22c55e' : 'var(--border)'}`,
            borderRadius:12, padding:'14px 12px', cursor:'pointer',
            background: dragOver ? 'rgba(34,197,94,0.08)' : 'var(--surface)',
            transition:'all 0.15s', display:'flex', alignItems:'center', gap:12,
          }}>
          {/* Folder/image icon */}
          <div style={{
            width:40, height:40, borderRadius:10, flexShrink:0,
            background: dragOver ? '#22c55e' : 'var(--border)',
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'all 0.15s',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={dragOver ? '#fff' : 'var(--text)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ textAlign:'left' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>
              {dragOver ? t('scan.dropToScan') : t('scan.chooseFromGallery')}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
              {t('scan.galleryHint')}
            </div>
          </div>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display:'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) scanImageFile(f); e.target.value='' }} />
      </div>
    </div>
  )
}

// ── Scan Relay Page (opened on phone) ────────────────────────────────────────
export function ScanRelayPage() {
  const { t } = useTranslation()
  const params    = new URLSearchParams(window.location.search)
  const isLive    = params.get('mode') === 'live'
  const sessionId = window.location.pathname.split('/scan-relay/')[1]?.split('?')[0] ?? ''

  const [status, setStatus]   = useState<string>('idle')
  const [done,   setDone]     = useState(false)
  const [error,  setError]    = useState<string|null>(null)

  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream|null>(null)
  const rafRef    = useRef<number>(0)
  const pcRef     = useRef<RTCPeerConnection|null>(null)

 const STUN = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]}

  async function getCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width:{ideal:1280}, height:{ideal:720} }
    })
    streamRef.current = stream
    if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
    return stream
  }

  async function startLiveMode() {
    setStatus(t('scan.relay.gettingCamera'))
    try {
      const stream = await getCamera()
      setStatus(t('scan.relay.connectingDesktop'))
      const pc = new RTCPeerConnection(STUN)
      pcRef.current = pc

      // Stream camera to desktop
      stream.getTracks().forEach(t => pc.addTrack(t, stream))

      // Send ICE candidates
      pc.onicecandidate = async (e) => {
        if (e.candidate) {
          await fetch(`${API_BASE}/scan-relay/${sessionId}/ice/phone`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ candidate: e.candidate }),
          }).catch(() => {})
        }
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setStatus('connected')
        if (pc.connectionState === 'failed') setError(t('scan.err.connectionFailed'))
      }

      // Poll for offer
      let tries = 0
      const pollOffer = async () => {
        tries++
        if (tries > 30) { setError(t('scan.err.desktopNotReady')); return }
        try {
          const r = await fetch(`${API_BASE}/scan-relay/${sessionId}/offer`)
          const d = await r.json()
          if (d.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(d.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            await fetch(`${API_BASE}/scan-relay/${sessionId}/answer`, {
              method:'PUT', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ sdp: answer }),
            })
            // Poll desktop ICE candidates
            pollDesktopIce(0)
            return
          }
        } catch {}
        setTimeout(pollOffer, 1500)
      }
      pollOffer()
    } catch (e: any) {
      setError(t('scan.err.cameraError', { msg: (e.message ?? 'denied') }))
    }
  }

  async function pollDesktopIce(offset: number) {
    try {
      const r = await fetch(`${API_BASE}/scan-relay/${sessionId}/ice/desktop`)
      const d = await r.json()
      const candidates: RTCIceCandidateInit[] = d.candidates ?? []
      for (let i = offset; i < candidates.length; i++) {
        await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidates[i]))
      }
      if (candidates.length < 20 && pcRef.current?.connectionState !== 'connected') {
        setTimeout(() => pollDesktopIce(candidates.length), 1500)
      }
    } catch {}
  }

  async function startBasicMode() {
    setStatus('camera')
    try {
      const stream = await getCamera()
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
    } catch (e: any) {
      setError(t('scan.err.cameraDenied', { msg: e.message })); return
    }
    function tick() {
      const v = videoRef.current, c = canvasRef.current
      if (!v || !c || v.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return }
      const ctx = c.getContext('2d')!
      c.width = v.videoWidth; c.height = v.videoHeight
      ctx.drawImage(v, 0, 0)
      const img  = ctx.getImageData(0, 0, c.width, c.height)
      const code = jsQR(img.data, img.width, img.height)
      if (code?.data) {
        streamRef.current?.getTracks().forEach(t => t.stop())
        cancelAnimationFrame(rafRef.current)
        fetch(`${API_BASE}/scan-relay/${sessionId}/result`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ result: code.data })
        }).then(() => setDone(true)).catch(() => setError(t('scan.err.failedToSend')))
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    if (!sessionId) { setError(t('scan.err.invalidSession')); return }
    if (isLive) startLiveMode()
    else        startBasicMode()
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      cancelAnimationFrame(rafRef.current)
      pcRef.current?.close()
    }
  }, [])  // eslint-disable-line

  const isConnected = status === 'connected'

  return (
    <div style={{ height:'100dvh', background:'#111', color:'#fff',
                  display:'flex', flexDirection:'column', alignItems:'center',
                  padding:'12px 12px 8px', gap:8, boxSizing:'border-box', overflow:'hidden' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:24, height:24, borderRadius:6, background:'linear-gradient(135deg,#6366f1,#8b5cf6)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:11, fontWeight:900, color:'white' }}>$</div>
        <span style={{ fontSize:13, fontWeight:700 }}>
          {isLive ? t('scan.relay.liveCameraHeader') : t('scan.relay.qrScannerHeader')}
        </span>
        {isLive && isConnected && (
          <span style={{ fontSize:9, fontWeight:700, background:'#22c55e', padding:'2px 8px',
                         borderRadius:20 }}>{t('scan.relay.liveBadge')}</span>
        )}
      </div>

      {error ? (
        <div style={{ textAlign:'center', marginTop:40 }}>
          <div style={{ fontSize:36, marginBottom:12 }}>❌</div>
          <div style={{ fontSize:13, color:'#f87171' }}>{error}</div>
        </div>
      ) : done ? (
        <div style={{ textAlign:'center', marginTop:40 }}>
          <div style={{ fontSize:48 }}>✅</div>
          <div style={{ fontSize:14, marginTop:12 }}>{t('scan.scannedCheck')}</div>
        </div>
      ) : (
        <>
          {/* Camera view — fills viewport height, no wasted space */}
          <div style={{ width:'100%', position:'relative', borderRadius:14,
                        overflow:'hidden', background:'#000',
                        height: 'calc(100dvh - 120px)', maxHeight: 480 }}>
            <video ref={videoRef} autoPlay playsInline muted
              style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            <canvas ref={canvasRef} style={{ display:'none' }} />
            {/* Scan frame (basic mode) */}
            {!isLive && (
              <div style={{ position:'absolute', inset:0, display:'flex',
                            alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
                <div style={{ width:'60%', height:'60%',
                              border:'2px solid rgba(255,255,255,0.9)', borderRadius:12,
                              boxShadow:'0 0 0 9999px rgba(0,0,0,0.5)' }} />
              </div>
            )}
          </div>

          <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', textAlign:'center' }}>
            {isLive
              ? isConnected
                ? t('scan.relay.streamingDesktop')
                : status === 'idle' ? '' : t('scan.relay.statusPrefix', { status })
              : t('scan.relay.pointAtDesktop')}
          </div>
        </>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const pageSt: React.CSSProperties = {
  minHeight:'100vh', background:'var(--bg)', color:'var(--text)',
  display:'flex', flexDirection:'column', alignItems:'center',
  padding:'16px 16px 100px', gap:12, boxSizing:'border-box',
}
const headerSt: React.CSSProperties = {
  width:'100%', maxWidth:480, display:'flex', alignItems:'center',
  gap:8, paddingBottom:10, borderBottom:'1px solid var(--border)',
}
const backBtn: React.CSSProperties = {
  background:'none', border:'none', cursor:'pointer',
  fontSize:16, color:'var(--text)', padding:'4px 6px', fontFamily:'system-ui, sans-serif',
}
const card: React.CSSProperties = {
  width:'100%', maxWidth:480, background:'var(--surface)',
  borderRadius:14, border:'1px solid var(--border)', padding:'14px',
}
const sLabel: React.CSSProperties = {
  fontSize:9, fontWeight:700, letterSpacing:'0.12em',
  color:'var(--muted)', textTransform:'uppercase',
}
const inputSt: React.CSSProperties = {
  background:'var(--bg)', border:'1px solid var(--border)',
  borderRadius:8, padding:'8px 12px', fontSize:13,
  color:'var(--text)', outline:'none',
}
const btnFill: React.CSSProperties = {
  padding:'10px 16px', borderRadius:10, border:'none',
  background:'var(--text)', color:'var(--surface)',
  fontSize:12, fontWeight:700, cursor:'pointer',
}
const btnGhost: React.CSSProperties = {
  padding:'10px 16px', borderRadius:10,
  border:'1px solid var(--border)',
  background:'transparent', color:'var(--text)',
  fontSize:12, fontWeight:600, cursor:'pointer',
}
