/**
 * /receipt/:paymentId — Print-friendly receipt page.
 * Renders receipt inline (no popup). User can tap "Print / Save as PDF"
 * to use the browser's native print/share flow (iOS: Share → Print → Save to Files).
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import html2canvas from 'html2canvas'
import { StyledQR } from '../components/StyledQR'
import { fetchPaymentChainStatus, CHAIN_STATUS_LABEL, triggerServerSync } from '../lib/payChainStatus'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://api.iusd-pay.xyz/v1'
const EXPLORER_TX_BASE = import.meta.env.VITE_EXPLORER_TX_BASE ?? 'https://scan.initia.xyz/interwoven-1/txs'
const BRAND_COLOR = '#16a34a'
const IUSD_LOGO = 'https://iusd-pay.xyz/images/iusd.png?v=20260414'

function iusd(micro: string | number | null | undefined): string {
  if (!micro) return '0.00'
  const v = parseInt(String(micro)) / 1_000_000
  return v % 1 === 0 ? v.toFixed(2) : parseFloat(v.toFixed(6)).toString()
}

function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—'
  // Normalize PostgreSQL timestamps: "2026-04-05 02:08:54.827+00" → ISO format
  let normalized = ts.replace(' ', 'T')
  if (/[+-]\d{2}$/.test(normalized)) normalized += ':00'  // +00 → +00:00
  if (!/[Z+-]/.test(normalized.slice(-6))) normalized += 'Z'
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function privacyId(id?: string | null): string {
  if (!id || id.length < 8) return id ?? '—'
  return `${id.slice(0, 4)}◆${id.slice(-4)}`
}

export default function ReceiptView() {
  const { t } = useTranslation()
  const { paymentId } = useParams<{ paymentId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromTransfer = searchParams.get('from') === 'transfer'
  const invToken = searchParams.get('inv')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!paymentId) { setErr(t('receiptView.noPaymentId')); setLoading(false); return }
    let cancelled = false
    async function load() {
      // Retry up to 3 times with delay — payment-intent may not be indexed yet
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(`${API_BASE}/payment/verify/${encodeURIComponent(paymentId!)}`)
          if (r.ok) {
            const d = await r.json()
            if (!cancelled) { setData(d); setLoading(false) }
            return
          }
          if (r.status !== 404 || attempt === 2) {
            const e = await r.json().catch(() => ({}))
            if (!cancelled) { setErr(e.error ?? 'NOT_FOUND'); setLoading(false) }
            return
          }
        } catch {
          if (attempt === 2) { if (!cancelled) { setErr(t('receiptView.failedToLoad')); setLoading(false) } return }
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    load()
    return () => { cancelled = true }
  }, [paymentId])

  // After DB data loads, async check chain for true status
  useEffect(() => {
    if (!paymentId || !data) return
    let cancelled = false
    fetchPaymentChainStatus(paymentId).then(chainStatus => {
      if (cancelled || chainStatus === null) return
      const chainLabel = CHAIN_STATUS_LABEL[chainStatus] ?? data.status
      if (chainLabel !== data.status) {
        // Chain status differs from DB cache — update display and trigger server sync
        setData((prev: any) => prev ? { ...prev, status: chainLabel } : prev)
        triggerServerSync(paymentId)
      }
    })
    return () => { cancelled = true }
  }, [paymentId, data?.status])

  // amountMicro is the total deposit (already includes fee)
  const gross   = data ? parseInt(data.amountMicro ?? 0) : 0
  const dateStr = fmtDate(data?.claimedAt ?? data?.createdAt)

  const receiptCanPrint = (() => {
    const ua = navigator.userAgent
    if (!/iPhone|iPad|iPod/i.test(ua)) return true
    return /Safari/i.test(ua) && !/CriOS|FxiOS|MetaMask|EdgiOS/i.test(ua)
  })()

  const iconBtnStyle: React.CSSProperties = {
    width: 38, height: 38, borderRadius: 8, border: '1px solid #ddd',
    cursor: 'pointer', background: '#fff', color: '#333',
    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  const cardRef = useRef<HTMLDivElement>(null)

  async function saveAsImage() {
    const el = cardRef.current
    if (!el || !data) return
    const filename = `receipt-${(paymentId ?? 'pay').slice(0, 12)}.png`
    try {
      // Fix SVGs with height/width="auto" — html2canvas can't parse them
      const svgs = el.querySelectorAll('svg')
      const fixes: { svg: SVGElement; attr: string; old: string }[] = []
      svgs.forEach(svg => {
        for (const attr of ['width', 'height'] as const) {
          const val = svg.getAttribute(attr)
          if (val === 'auto' || val === '') {
            fixes.push({ svg, attr, old: val ?? '' })
            const computed = getComputedStyle(svg)[attr]
            svg.setAttribute(attr, computed || '100')
          }
        }
      })
      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true, backgroundColor: '#f5f5f5', logging: false,
      })
      // Restore original SVG attributes
      fixes.forEach(({ svg, attr, old }) => svg.setAttribute(attr, old))
      canvas.toBlob(async b => {
        if (!b) return
        const file = new File([b], filename, { type: 'image/png' })
        // iOS Safari: share sheet → "Save Image to Photos"
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: filename }); return } catch {}
        }
        // MetaMask WebView / desktop: direct download dialog
        const a = document.createElement('a')
        a.href = URL.createObjectURL(b)
        a.download = filename
        a.click()
      }, 'image/png')
    } catch (e) { console.error('html2canvas failed', e) }
  }
  const qrVerifyUrl = paymentId ? `https://iusd-pay.xyz/verify?pid=${paymentId}` : null

  return (
    <>
      {/* Print-hide toolbar */}
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 99,
        background: '#fff', borderBottom: '1px solid #eee',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Success banner when coming from transfer */}
        {fromTransfer && (
          <div style={{
            background: 'linear-gradient(90deg, #22c55e, #4ade80)',
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{t('receipt.paymentSent')}</span>
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        }}>
          {fromTransfer ? (
            <button onClick={() => navigate('/app', { replace: true })} style={{
              background: '#111', color: '#fff', border: 'none', borderRadius: 8,
              padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>{t('receipt.home')}</button>
          ) : (
            <button onClick={() => { if (window.history.length > 1) navigate(-1); else window.close() }} style={{
              background: 'none', border: '1px solid #ddd', borderRadius: 8,
              padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#555',
            }}>{t('receiptView.back')}</button>
          )}
          <span style={{ flex: 1, fontSize: 12, color: '#888', fontWeight: 600 }}>
            {t('receiptView.paymentReceipt')}
          </span>
          {fromTransfer && invToken && (
            <button onClick={() => navigate(`/invoice/${invToken}`)} style={{
              background: 'none', border: '1px solid #6366f1', borderRadius: 8,
              padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#6366f1',
            }}>{t('receipt.viewInvoice')}</button>
          )}
          <button
            onClick={saveAsImage}
            disabled={loading || !!err}
            style={iconBtnStyle}
            title={t('receiptView.saveAsImage')}
          >💾</button>
          <button
            onClick={() => receiptCanPrint && window.print()}
            disabled={loading || !!err}
            style={{ ...iconBtnStyle, ...(receiptCanPrint ? {} : { opacity: 0.45, cursor: 'not-allowed' }) }}
            title={receiptCanPrint ? t('receiptView.printPdf') : t('receiptView.openInSafariChrome')}
          >🖨</button>
        </div>
      </div>

      {/* Receipt content */}
      <div style={{
        minHeight: '100dvh', background: '#f5f5f5', padding: '24px 12px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: 'hidden', width: '100%', boxSizing: 'border-box',
      }}>
        {loading && (
          <div style={{ textAlign: 'center', color: '#aaa', marginTop: 48 }}>{t('receipt.loading')}</div>
        )}
        {err && (
          <div style={{ textAlign: 'center', color: '#aaa', marginTop: 48 }}>
            {err === 'NOT_FOUND' ? t('receiptView.notFound') : t('receiptView.errorPrefix', { msg: err })}
          </div>
        )}
        {data && !loading && (
          <div ref={cardRef} style={{
            background: 'white', maxWidth: 480, margin: '0 auto',
            borderRadius: 14, boxShadow: '0 4px 24px rgba(0,0,0,.08)', padding: '16px',
            overflow: 'hidden', boxSizing: 'border-box',
          }}>
            {/* Header: logo + title + date */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderBottom: '1px solid #eee', paddingBottom: 10, marginBottom: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={IUSD_LOGO} width="24" height="24"
                  style={{ borderRadius: '50%' }} alt="iUSD" />
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>iUSD</span>
                  <span style={{ fontSize: 14, fontWeight: 300, color: '#111' }}> pay</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
                              color: '#aaa', textTransform: 'uppercase' }}>{t('receiptView.receipt')}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{dateStr}</div>
              </div>
            </div>

            {/* Amount + QR side by side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                {/* Status badge — compact pill above the amount */}
                {(() => {
                  const s = String(data.status ?? '').toLowerCase()
                  const palette: Record<string, { bg: string; border: string; fg: string; label: string; icon: string }> = {
                    paid:     { bg: '#e8f8ee', border: '#22c55e', fg: '#15803d', label: t('receiptView.statusPaid'),      icon: '✓' },
                    confirmed:{ bg: '#e8f8ee', border: '#22c55e', fg: '#15803d', label: t('receiptView.statusConfirmed'), icon: '✓' },
                    pending:  { bg: '#fff7e0', border: '#f59e0b', fg: '#b45309', label: t('receiptView.statusPending'),   icon: '⏳' },
                    revoked:  { bg: '#f3f4f6', border: '#6b7280', fg: '#4b5563', label: t('receiptView.statusRevoked'),   icon: '⊘' },
                    refunded: { bg: '#f3e8ff', border: '#8b5cf6', fg: '#6d28d9', label: t('receiptView.statusRefunded'),  icon: '↺' },
                    expired:  { bg: '#f3f4f6', border: '#6b7280', fg: '#4b5563', label: t('receiptView.statusExpired'),   icon: '⏱' },
                    failed:   { bg: '#fee2e2', border: '#ef4444', fg: '#b91c1c', label: t('receiptView.statusFailed'),    icon: '✕' },
                  }
                  const style = palette[s] ?? { bg: '#f3f4f6', border: '#6b7280', fg: '#374151', label: data.status || t('receiptView.statusUnknown'), icon: '•' }
                  return (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      marginBottom: 6,
                      padding: '3px 9px',
                      borderRadius: 999,
                      background: style.bg,
                      border: `1px solid ${style.border}`,
                      color: style.fg,
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      lineHeight: 1,
                      maxWidth: '100%',
                    }}>
                      <span style={{ fontSize: 10, lineHeight: 1 }}>{style.icon}</span>
                      {style.label}
                    </div>
                  )
                })()}

                <div>
                  <span style={{ fontSize: 32, fontWeight: 800, color: BRAND_COLOR }}>
                    {iusd(gross)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#888', marginLeft: 4 }}>iUSD</span>
                </div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                  {t('receiptView.fee', { amount: iusd(data.feeMicro) })}
                </div>
              </div>
              {qrVerifyUrl && (
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <StyledQR url={qrVerifyUrl} address={paymentId!} size={160} theme="light" />
                  <div style={{ fontSize: 7, color: '#bbb', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t('receiptView.verify')}</div>
                </div>
              )}
            </div>

            {/* FROM → TO compact */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 16px 1fr', gap: 4,
                          alignItems: 'stretch', marginBottom: 10 }}>
              <div style={{ background: '#f8f8f8', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                              textTransform: 'uppercase', color: '#bbb', marginBottom: 3 }}>{t('receiptView.from')}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>
                  {data.senderNickname ?? '—'}
                </div>
                {data.senderSeal
                  ? <div style={{ width: '100%', overflow: 'hidden', borderRadius: 3, marginTop: 4 }}
                         dangerouslySetInnerHTML={{ __html:
                           data.senderSeal.replace(
                             /width="[^"]*" height="[^"]*"/,
                             'width="100%" height="auto" style="display:block"'
                           )
                         }} />
                  : <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#aaa', marginTop: 2 }}>
                      @{privacyId(data.senderShortId)}
                    </div>
                }
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 14, color: '#ccc' }}>→</div>
              <div style={{ background: '#f8f8f8', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                              textTransform: 'uppercase', color: '#bbb', marginBottom: 3 }}>{t('receiptView.to')}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>
                  {data.recipientNickname ?? '—'}
                </div>
                {data.recipientSeal
                  ? <div style={{ width: '100%', overflow: 'hidden', borderRadius: 3, marginTop: 4 }}
                         dangerouslySetInnerHTML={{ __html:
                           data.recipientSeal.replace(
                             /width="[^"]*" height="[^"]*"/,
                             'width="100%" height="auto" style="display:block"'
                           )
                         }} />
                  : <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#aaa', marginTop: 2 }}>
                      @{privacyId(data.recipientShortId)}
                    </div>
                }
              </div>
            </div>

            {/* Detail rows — compact */}
            <div style={{ borderTop: '1px solid #eee', fontSize: 11 }}>
              {[
                { label: t('receiptView.date'), value: fmtDate(data.createdAt) },
                ...(data.claimedAt ? [{ label: t('receiptView.confirmedLabel'), value: fmtDate(data.claimedAt) }] : []),
              ].map(({ label, value }) => (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: '1px solid #f5f5f5',
                }}>
                  <span style={{ color: '#888' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: '#111' }}>{value}</span>
                </div>
              ))}
              {data.txHash && (
                <div style={{ padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                  <a href={`${EXPLORER_TX_BASE}/${data.txHash}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 9, fontFamily: 'monospace', color: '#2563eb',
                             wordBreak: 'break-all', textDecoration: 'none' }}>
                    {t('receiptView.tx', { hash: `${data.txHash.slice(0, 20)}…${data.txHash.slice(-8)}` })}
                  </a>
                </div>
              )}
              <div style={{ padding: '6px 0', fontSize: 9, fontFamily: 'monospace', color: '#bbb',
                            wordBreak: 'break-all' }}>
                {t('receiptView.id', { id: data.paymentId })}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee',
              fontSize: 8, color: '#bbb', letterSpacing: '0.05em', textAlign: 'center',
            }}>
              iusd-pay.xyz · INITIA
            </div>
          </div>
        )}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0 !important; }
          @page { margin: 12mm; }
        }
      `}</style>
    </>
  )
}
