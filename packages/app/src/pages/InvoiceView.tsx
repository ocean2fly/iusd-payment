/**
 * /invoice/:token — Printable invoice page (HTML equivalent of openInvoicePdf).
 * Public: no auth required. iOS-safe: opened via synchronous window.open().
 * Style mirrors pdfTemplates.ts > openInvoicePdf() exactly.
 */
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import html2canvas from 'html2canvas'
import { StyledQR } from '../components/StyledQR'
import { invoiceVisualStatus } from '../lib/paymentStatus'

const API_BASE    = import.meta.env.VITE_API_BASE ?? 'https://api.iusd-pay.xyz/v1'
const BRAND_COLOR = '#6366f1'
const IUSD_LOGO   = 'https://iusd-pay.xyz/images/iusd.png?v=20260414'
const FEE_RATE    = 0.005
const FEE_CAP     = 5          // iUSD

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    let s = iso.replace(' ', 'T')
    if (/[+-]\d{2}$/.test(s)) s += ':00'
    if (!/[Z+-]/.test(s.slice(-6))) s += 'Z'
    return new Date(s).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
  } catch { return iso }
}

function privId(id?: string | null): string {
  if (!id || id.length < 8) return id ?? '—'
  return `${id.slice(0, 4)}◆${id.slice(-4)}`
}

function fmtAmt(n: number, digits = 4): string {
  return n.toFixed(digits).replace(/\.?0+$/, '') || '0'
}

export default function InvoiceView() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState<string | null>(null)
  const cardRef               = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) { setErr(t('invoiceView.noToken')); setLoading(false); return }
    fetch(`${API_BASE}/invoice/${token}/public-view`)
      .then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else setData(d); setLoading(false) })
      .catch(() => { setErr(t('invoiceView.failedToLoad')); setLoading(false) })
  }, [token])

  useEffect(() => {
    if (data) document.title = `Invoice ${data.invoiceNo || ''} — iUSD Pay`
  }, [data])

  // ── html2canvas save-as-image ─────────────────────────────────────────
  async function saveAsImage() {
    const el = cardRef.current
    if (!el || !data) return
    const invNo = data.invoiceNo ?? token ?? 'inv'
    const filename = `invoice-${invNo.replace(/[^a-z0-9]/gi, '-')}.png`
    try {
      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true, backgroundColor: '#f8f8f8', logging: false,
      })
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

  // ── derived values ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
                  background:'#f8f8f8', color:'#888', fontFamily:'system-ui,sans-serif', fontSize:14 }}>
      Loading invoice…
    </div>
  )
  if (err || !data) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
                  background:'#f8f8f8', color:'#888', fontFamily:'system-ui,sans-serif', fontSize:14 }}>
      {err === 'NOT_FOUND' ? t('invoiceView.notFound') : (err ?? t('invoiceView.unavailable'))}
    </div>
  )

  const { merchant, invoiceNo, amount, feeMode, note, dueDate,
          createdAt, paidAt, txHash,
          payerShortId, payerNickname, payerName,
          recipientShortId, issuerNickname } = data

  const statusStr = invoiceVisualStatus({
    status: data.status,
    chainStatus: data.chainStatus,
    revokedAt: data.revokedAt,
  })

  const accent       = merchant?.color ?? BRAND_COLOR
  const merchantName = merchant?.name || issuerNickname || 'iUSD Pay'
  const invNo        = invoiceNo ?? '—'

  // Use `amount` (iUSD float) like the old template — NOT amountMicro
  const amtNum     = parseFloat(String(amount ?? 0))
  const fee        = feeMode === 'recipient'
    ? Math.min(amtNum * FEE_RATE, FEE_CAP)
    : Math.min(amtNum / (1 - FEE_RATE) * FEE_RATE, FEE_CAP)
  const recipGets  = feeMode === 'recipient' ? amtNum - fee : amtNum

  const statusColor = statusStr === 'paid' ? '#16a34a'
                    : statusStr === 'cancelled' ? '#6b7280' : '#d97706'
  const statusLabel = statusStr.charAt(0).toUpperCase() + statusStr.slice(1)

  const qrPayUrl = `https://iusd-pay.xyz/pay/${token}`

  // Detect WebView environments where window.print() silently fails
  const canPrint = (() => {
    const ua = navigator.userAgent
    const isIOS = /iPhone|iPad|iPod/i.test(ua)
    if (!isIOS) return true  // desktop / Android: print works
    // iOS: print works in Safari and Chrome but not in MetaMask / Telegram / other WebViews
    return /Safari/i.test(ua) && !/CriOS|FxiOS|MetaMask|EdgiOS/i.test(ua)
  })()

  const s = {
    body:     { fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
                background:'#f8f8f8', minHeight:'100vh', padding:'0 0 48px',
                color:'#111', WebkitFontSmoothing:'antialiased' } as React.CSSProperties,
    toolbar:  { background:'#fff', borderBottom:'1px solid #eee', padding:'10px 16px',
                display:'flex', alignItems:'center', gap:8, position:'sticky' as const,
                top:0, zIndex:10 } as React.CSSProperties,
    iconBtn:  { width:38, height:38, borderRadius:8, border:'1px solid #ddd', cursor:'pointer',
                background:'#fff', color:'#333', fontSize:18, display:'flex',
                alignItems:'center', justifyContent:'center', flexShrink:0 } as React.CSSProperties,
    card:     { background:'#fff', maxWidth:600, margin:'24px auto',
                borderRadius:12, boxShadow:'0 2px 16px rgba(0,0,0,.08)',
                overflow:'hidden' } as React.CSSProperties,
    inner:    { padding:'32px' } as React.CSSProperties,
    divider:  { border:'none', borderTop:'1px solid #eee', margin:'20px 0' } as React.CSSProperties,
    grid2:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:24,
                marginBottom:24 } as React.CSSProperties,
    secLabel: { fontSize:9, fontWeight:700, letterSpacing:'0.15em', textTransform:'uppercase' as const,
                color:'#aaa', marginBottom:6 } as React.CSSProperties,
    amtRow:   { display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'14px 0', borderBottom:'1px solid #f0f0f0' } as React.CSSProperties,
    totalRow: { display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'16px 0 4px', borderTop:'2px solid #111', marginTop:4 } as React.CSSProperties,
  }

  return (
    <div style={s.body}>
      {/* Toolbar */}
      <div style={s.toolbar} className="no-print">
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <img src={IUSD_LOGO} style={{ width:20, height:20, borderRadius:'50%' }} alt="" />
          <span style={{ fontWeight:700, fontSize:13, color:'#111' }}>iUSD Pay</span>
        </div>
        <div style={{ flex:1 }} />
        <button style={{ ...s.iconBtn }} onClick={saveAsImage} title={t('invoiceView.saveAsImage')}>💾</button>
        <button
          style={{ ...s.iconBtn, ...(canPrint ? {} : { opacity: 0.45, cursor: 'not-allowed' }) }}
          onClick={() => canPrint && window.print()}
          title={canPrint ? t('invoiceView.printPdf') : t('invoiceView.openInSafariChrome')}>
          🖨
        </button>
      </div>

      {/* Invoice card */}
      <div ref={cardRef} style={s.card}>
        {/* Top accent bar + close */}
        <div style={{ background: accent, height:6, position: 'relative' }}>
          <button onClick={() => navigate('/')}
            className="no-print"
            style={{ position: 'absolute', right: 8, top: 10, background: 'rgba(0,0,0,0.06)', border: 'none',
                     width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', color: '#666',
                     fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={t('invoiceView.close')}>✕</button>
        </div>

        <div style={s.inner}>
          {/* Header: merchant info left / INVOICE right */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28 }}>
            <div>
              {merchant?.logoUrl && (
                <img src={merchant.logoUrl} alt="logo"
                  style={{ height:48, maxWidth:160, objectFit:'contain', marginBottom:8,
                           display:'block', borderRadius:6 }} />
              )}
              <div style={{ fontSize:20, fontWeight:800, color: accent }}>{merchantName}</div>
              {merchant?.description && (
                <div style={{ fontSize:11, color:'#888', marginTop:2 }}>{merchant.description}</div>
              )}
              <div style={{ fontSize:11, color:'#666', marginTop:4, lineHeight:1.5 }}>
                {[merchant?.address, merchant?.phone, merchant?.email, merchant?.website]
                  .filter(Boolean).map((v, i) => <div key={i}>{v}</div>)}
                {merchant?.taxId && <div>{t('invoiceView.taxId', { id: merchant.taxId })}</div>}
              </div>
            </div>
            <div style={{ textAlign:'right', flexShrink:0, marginLeft:24 }}>
              <div style={{ fontSize:28, fontWeight:800, color:'#111', letterSpacing:-1 }}>{t('invoiceView.title')}</div>
              <div style={{ fontSize:13, fontWeight:600, color:'#888', marginTop:2 }}>{invNo}</div>
              <div style={{ marginTop:6, display:'inline-block', padding:'3px 10px',
                            borderRadius:99, fontSize:10, fontWeight:700, letterSpacing:'0.1em',
                            background: statusColor + '22', color: statusColor }}>
                {statusLabel}
              </div>
            </div>
          </div>

          <hr style={s.divider} />

          {/* Bill From / Bill To */}
          <div style={s.grid2}>
            <div>
              <div style={s.secLabel}>{t('invoiceView.billFrom')}</div>
              <div style={{ fontSize:15, fontWeight:700 }}>{merchantName}</div>
              {recipientShortId && (
                <div style={{ fontSize:11, color:'#888', fontFamily:'monospace', marginTop:2 }}>
                  @{privId(recipientShortId)}
                </div>
              )}
            </div>
            <div>
              <div style={s.secLabel}>{t('invoiceView.billTo')}</div>
              {payerName ? (
                <>
                  <div style={{ fontSize:15, fontWeight:700 }}>{payerName}</div>
                  {recipientShortId && <div style={{ fontSize:11, color:'#888', fontFamily:'monospace', marginTop:2 }}>@{privId(recipientShortId)}</div>}
                </>
              ) : payerNickname || payerShortId ? (
                <>
                  <div style={{ fontSize:15, fontWeight:700 }}>{payerNickname ?? '—'}</div>
                  <div style={{ fontSize:11, color:'#888', fontFamily:'monospace', marginTop:2 }}>@{privId(recipientShortId)}</div>
                </>
              ) : (
                <div style={{ fontSize:15, color:'#bbb' }}>—</div>
              )}
            </div>
          </div>

          {/* Issue / Due dates */}
          <div style={{ ...s.grid2, marginBottom:24 }}>
            <div>
              <div style={s.secLabel}>{t('invoiceView.issueDate')}</div>
              <div style={{ fontSize:13, fontWeight:600 }}>{fmtDate(createdAt)}</div>
            </div>
            {dueDate && (
              <div>
                <div style={s.secLabel}>{t('invoiceView.dueDate')}</div>
                <div style={{ fontSize:13, fontWeight:600 }}>{dueDate}</div>
              </div>
            )}
          </div>

          {/* Note */}
          {note && (
            <div style={{ background:'#f8f8f8', borderLeft:`3px solid ${accent}`,
                          padding:'8px 12px', fontSize:12, color:'#555',
                          borderRadius:'0 6px 6px 0', marginBottom:20 }}>
              {t('invoiceView.noteLabel', { note })}
            </div>
          )}

          {/* Amount rows */}
          <div style={s.amtRow}>
            <span style={{ fontSize:13, color:'#888' }}>{t('invoiceView.invoiceAmount')}</span>
            <span style={{ fontSize:13, fontWeight:600 }}>{fmtAmt(amtNum)} iUSD</span>
          </div>
          <div style={s.amtRow}>
            <span style={{ fontSize:13, color:'#888' }}>
              {t('invoiceView.platformFeeLabel', { cap: fee >= FEE_CAP ? t('invoiceView.platformFeeCapped') : '' })}
            </span>
            <span style={{ fontSize:13, color:'#888' }}>− {fmtAmt(fee)} iUSD</span>
          </div>
          <div style={s.totalRow}>
            <span style={{ fontSize:14, fontWeight:700 }}>{t('invoiceView.recipientGets')}</span>
            <span style={{ fontSize:22, fontWeight:800, color: accent }}>{fmtAmt(recipGets)} iUSD</span>
          </div>

          {/* Paid confirmation */}
          {paidAt && (
            <div style={{ marginTop:12, fontSize:11, color:'#16a34a', fontWeight:600 }}>
              {t('invoiceView.paidStatus', { date: fmtDate(paidAt) })}
              {txHash && (
                <div style={{ fontFamily:'monospace', fontSize:9, color:'#888', marginTop:2, wordBreak:'break-all' }}>
                  {txHash}
                </div>
              )}
            </div>
          )}

          {/* Footer: iUSD branding + QR */}
          <div style={{ marginTop:28, paddingTop:20, borderTop:'1px solid #eee',
                        display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
            <div>
              <div style={{ display:'inline-flex', alignItems:'center', gap:10 }}>
                <img src={IUSD_LOGO} width={36} height={36}
                     style={{ borderRadius:'50%', display:'block', flexShrink:0 }} alt="iUSD" />
                <div>
                  <div style={{ fontSize:20, lineHeight:1.1, color:'#111' }}>
                    <span style={{ fontWeight:700 }}>iUSD</span>
                    <span style={{ fontWeight:300 }}> pay</span>
                  </div>
                  <div style={{ fontSize:8, letterSpacing:'0.18em', color:'#888',
                                textTransform:'uppercase', marginTop:2, fontWeight:500 }}>
                    Stable Coin Payment on Initia
                  </div>
                </div>
              </div>
              <div style={{ fontSize:10, color:'#bbb', marginTop:8, paddingLeft:4 }}>
                iusd-pay.xyz · INITIA
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
              <StyledQR url={qrPayUrl} address={token ?? qrPayUrl} size={160} theme="light" />
              <div style={{ fontSize:9, color:'#aaa', letterSpacing:'0.1em',
                            textTransform:'uppercase' }}>{t('invoiceView.payLink')}</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: #fff !important; padding: 0 !important; }
          .no-print { display: none !important; }
          div[style*="position: sticky"] { position: static !important; }
        }
      `}</style>
    </div>
  )
}
