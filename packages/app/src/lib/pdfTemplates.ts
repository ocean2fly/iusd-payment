/**
 * pdfTemplates.ts
 * Generates printable HTML for invoice PDFs and transfer receipts.
 * Opens in a new tab; user prints or saves as PDF.
 */

const BRAND_COLOR = '#6366f1'

const IUSD_LOGO_URL = 'https://iusd-pay.xyz/images/iusd.png?v=20260414'

// ── Classic footer block (transparent background — works on white paper) ──
function classicFooterBlock() {
  return `<div style="
      display:inline-flex;
      align-items:center;
      gap:10px;
    ">
    <img src="${IUSD_LOGO_URL}" width="36" height="36"
         style="border-radius:50%;display:block;flex-shrink:0" alt="iUSD" />
    <div>
      <div style="font-size:20px;line-height:1.1;color:#111111;letter-spacing:-0.3px">
        <span style="font-weight:700">iUSD</span><span style="font-weight:300"> pay</span>
      </div>
      <div style="font-size:8px;letter-spacing:0.18em;color:#888888;text-transform:uppercase;margin-top:2px;font-weight:500">
        Stable Coin Payment on Initia
      </div>
    </div>
  </div>`
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    const s = iso.endsWith('Z') ? iso : iso + 'Z'
    return new Date(s).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
  } catch { return iso }
}

function fmtAmt(micro: number | string | null | undefined): string {
  const n = Number(micro ?? 0)
  return (n / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0'
}

function privacyId(shortId?: string | null): string {
  if (!shortId || shortId.length < 8) return shortId ?? '—'
  return `${shortId.slice(0, 4)}◆${shortId.slice(-4)}`
}

// ── RECEIPT ───────────────────────────────────────────────────────────────
export interface ReceiptData {
  direction:           'sent' | 'received'
  amountMicro:         number | string
  feeMicro:            number | string
  status:              string
  dbCreatedAt?:        string | null
  paymentId?:          string | null
  txHash?:             string | null
  // sender
  myNickname?:         string | null
  myShortId?:          string | null
  // counterparty
  counterpartyNickname?: string | null
  counterpartyShortId?:  string | null
}

export function openReceiptPdf(d: ReceiptData) {
  const fromLabel = d.direction === 'sent' ? 'FROM (You)' : 'FROM'
  const toLabel   = d.direction === 'sent' ? 'TO'         : 'TO (You)'
  const fromNick  = d.direction === 'sent' ? (d.myNickname ?? 'You') : (d.counterpartyNickname ?? '—')
  const fromId    = d.direction === 'sent' ? privacyId(d.myShortId)  : privacyId(d.counterpartyShortId)
  const toNick    = d.direction === 'sent' ? (d.counterpartyNickname ?? '—') : (d.myNickname ?? 'You')
  const toId      = d.direction === 'sent' ? privacyId(d.counterpartyShortId) : privacyId(d.myShortId)
  // Show gross amount (what sender paid = net + fee) so receipt matches verify page
  const gross     = Number(d.amountMicro ?? 0) + Number(d.feeMicro ?? 0)
  const amt       = fmtAmt(gross || d.amountMicro)
  const fee       = fmtAmt(d.feeMicro)
  const dateStr   = fmtDate(d.dbCreatedAt)
  const statusColor = d.status === 'paid' ? '#16a34a' : d.status === 'refunded' ? '#d97706' : '#6b7280'

  const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <title>Receipt · iUSD Pay</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f8f8f8; padding: 32px 16px; color: #111; }
    .card { background: white; max-width: 480px; margin: 0 auto; border-radius: 16px;
            box-shadow: 0 2px 16px rgba(0,0,0,.08); padding: 32px; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 1px solid #eee; padding-bottom: 20px; margin-bottom: 24px; }
    .receipt-title { font-size: 10px; font-weight: 700; letter-spacing: 0.15em;
                     color: #888; text-transform: uppercase; margin-top: 6px; }
    .parties { display: grid; grid-template-columns: 1fr 24px 1fr; gap: 8px;
               align-items: center; margin-bottom: 28px; }
    .party-box { background: #f5f5f7; border-radius: 10px; padding: 12px; }
    .party-label { font-size: 9px; font-weight: 700; letter-spacing: 0.12em;
                   text-transform: uppercase; color: #888; margin-bottom: 4px; }
    .party-nick { font-size: 14px; font-weight: 700; color: #111; }
    .party-id   { font-size: 11px; color: #555; font-family: monospace; margin-top: 2px; }
    .arrow { text-align: center; font-size: 18px; color: #ccc; }
    .amount-block { text-align: center; margin-bottom: 28px; }
    .amount-num { font-size: 36px; font-weight: 800; color: ${BRAND_COLOR}; }
    .amount-unit { font-size: 16px; font-weight: 600; color: #888; margin-left: 4px; }
    .rows { border-top: 1px solid #eee; }
    .row { display: flex; justify-content: space-between; align-items: flex-start;
           padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
    .row-label { color: #888; font-weight: 500; }
    .row-val { font-weight: 600; text-align: right; max-width: 65%; word-break: break-all; font-family: monospace; font-size: 11px; }
    .row-val-plain { font-weight: 600; text-align: right; font-size: 13px; font-family: inherit; }
    .footer { margin-top: 24px; text-align: center; font-size: 10px; color: #bbb; }
    @media print { body { background: white; padding: 0; }
                   .card { box-shadow: none; border-radius: 0; } }
  </style>
</head><body>
  <div class="card">
    <div class="hdr">
      <div style="display:inline-flex;align-items:center;gap:10px">
        <img src="${IUSD_LOGO_URL}" width="32" height="32"
             style="border-radius:50%;display:block;flex-shrink:0" alt="iUSD" />
        <div>
          <div style="font-size:17px;line-height:1.1;color:#111111">
            <span style="font-weight:700">iUSD</span><span style="font-weight:300"> pay</span>
          </div>
          <div style="font-size:7px;letter-spacing:0.18em;color:#888;text-transform:uppercase;margin-top:2px">Stable Coin Payment on Initia</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="receipt-title">Payment Receipt</div>
        <div style="font-size:11px;color:#888;margin-top:4px">${dateStr}</div>
      </div>
    </div>

    <div class="parties">
      <div class="party-box">
        <div class="party-label">${fromLabel}</div>
        <div class="party-nick">${fromNick}</div>
        <div class="party-id">@${fromId}</div>
      </div>
      <div class="arrow">→</div>
      <div class="party-box">
        <div class="party-label">${toLabel}</div>
        <div class="party-nick">${toNick}</div>
        <div class="party-id">@${toId}</div>
      </div>
    </div>

    <div class="amount-block">
      <span class="amount-num">${amt}</span><span class="amount-unit">iUSD</span>
    </div>

    <div class="rows">
      <div class="row">
        <span class="row-label">Status</span>
        <span class="row-val-plain" style="color:${statusColor};font-weight:700">
          ${d.status.charAt(0).toUpperCase() + d.status.slice(1)}
        </span>
      </div>
      <div class="row">
        <span class="row-label">Platform Fee</span>
        <span class="row-val-plain">${fee} iUSD</span>
      </div>
      ${d.paymentId ? `<div class="row">
        <span class="row-label">Payment ID</span>
        <span class="row-val">${d.paymentId}</span>
      </div>` : ''}
      ${d.txHash ? `<div class="row">
        <span class="row-label">TX Hash</span>
        <span class="row-val">${d.txHash}</span>
      </div>` : ''}
    </div>

    <!-- Bottom: domain text (left) + QR (right) — logo already in header, no repeat -->
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;
                display:flex;justify-content:space-between;align-items:flex-end">
      <div style="font-size:9px;color:#bbb;letter-spacing:0.05em">iusd-pay.xyz · INITIA</div>
      ${d.paymentId ? `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="position:relative;width:72px;height:72px">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=144x144&data=${encodeURIComponent('https://iusd-pay.xyz/verify?pid=' + d.paymentId)}"
               width="72" height="72" style="border:1px solid #eee;border-radius:6px;display:block" alt="QR" />
          <img src="${IUSD_LOGO_URL}" width="18" height="18"
               style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border-radius:50%;background:#fff;padding:1px" />
        </div>
        <div style="font-size:8px;color:#bbb;letter-spacing:0.08em;text-transform:uppercase">Verify</div>
      </div>` : ''}
    </div>
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(), ${d.paymentId ? 600 : 0})</script>
</body></html>`

  // Use blob URL for better mobile browser compatibility (popup blockers)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (!w) window.location.href = url
}

// ── INVOICE PDF ───────────────────────────────────────────────────────────
export interface InvoiceData {
  invoiceNo?:     string | null
  amount:         string | number
  feeMode?:       string | null
  note?:          string | null
  createdAt?:     string | null
  dueDate?:       string | null
  status?:        string | null
  payLink?:       string | null
  paymentId?:     string | null
  txHash?:        string | null
  paidAt?:        string | null
  // recipient (invoice owner / merchant)
  myNickname?:    string | null
  myShortId?:     string | null
  // payer
  payerNickname?: string | null   // nickname / ID handle
  payerRealName?: string | null   // optional real name set by merchant (shown on invoice)
  payerShortId?:  string | null
  // merchant profile
  merchant?: {
    name?:          string
    logoUrl?:       string      // base64 data URL or https URL
    color?:         string
    description?:   string
    email?:         string
    phone?:         string
    website?:       string
    address?:       string
    taxId?:         string
    invoicePrefix?: string
  } | null
}

export function openInvoicePdf(d: InvoiceData) {
  const accentColor = d.merchant?.color ?? BRAND_COLOR
  const merchantName = d.merchant?.name || d.myNickname || 'iUSD Pay'
  const invNo = d.invoiceNo || '—'
  const amtNum = Number(d.amount ?? 0)
  const FEE_RATE = 0.005
  const FEE_CAP_IUSD = 5
  const fee = d.feeMode === 'recipient'
    ? Math.min(amtNum * FEE_RATE, FEE_CAP_IUSD).toFixed(6).replace(/\.?0+$/, '')
    : (Math.min(amtNum / (1 - FEE_RATE) * FEE_RATE, FEE_CAP_IUSD)).toFixed(6).replace(/\.?0+$/, '')
  const recipientGets = d.feeMode === 'recipient'
    ? (amtNum - Number(fee)).toFixed(4)
    : amtNum.toFixed(4)

  const statusColor = d.status === 'paid' ? '#16a34a'
    : d.status === 'cancelled' ? '#6b7280'
    : d.status === 'refunded'  ? '#d97706'
    : '#d97706'
  const statusLabel = (d.status ?? 'pending').charAt(0).toUpperCase() + (d.status ?? 'pending').slice(1)

  const qrUrl = d.payLink
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(d.payLink)}&bgcolor=ffffff&color=000000&margin=4`
    : null

  const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <title>Invoice ${invNo} · ${merchantName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f8f8f8; padding: 32px 16px; color: #111; }
    .card { background: white; max-width: 600px; margin: 0 auto; border-radius: 12px;
            box-shadow: 0 2px 16px rgba(0,0,0,.08); overflow: hidden; }
    .top-bar { background: ${accentColor}; height: 6px; }
    .inner { padding: 32px; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start;
           margin-bottom: 28px; }
    .merchant-name { font-size: 20px; font-weight: 800; color: ${accentColor}; }
    .merchant-meta { font-size: 11px; color: #666; margin-top: 4px; line-height: 1.5; }
    .inv-block { text-align: right; }
    .inv-title { font-size: 28px; font-weight: 800; color: #111; letter-spacing: -1px; }
    .inv-no { font-size: 13px; font-weight: 600; color: #888; margin-top: 2px; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 99px;
                    font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
                    background: ${statusColor}22; color: ${statusColor}; margin-top: 6px; }
    .divider { border: none; border-top: 1px solid #eee; margin: 20px 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .section-label { font-size: 9px; font-weight: 700; letter-spacing: 0.15em;
                     text-transform: uppercase; color: #aaa; margin-bottom: 6px; }
    .party-name { font-size: 15px; font-weight: 700; }
    .party-id   { font-size: 11px; color: #888; font-family: monospace; margin-top: 2px; }
    .amount-row { display: flex; justify-content: space-between; align-items: center;
                  padding: 14px 0; border-bottom: 1px solid #f0f0f0; }
    .amount-label { font-size: 13px; color: #888; }
    .amount-val   { font-size: 13px; font-weight: 600; }
    .total-row { display: flex; justify-content: space-between; align-items: center;
                 padding: 16px 0 4px; border-top: 2px solid #111; margin-top: 4px; }
    .total-label { font-size: 14px; font-weight: 700; }
    .total-val   { font-size: 22px; font-weight: 800; color: ${accentColor}; }
    .bottom { display: flex; justify-content: space-between; align-items: flex-end;
              margin-top: 28px; padding-top: 20px; border-top: 1px solid #eee; }
    .note-box { background: #f8f8f8; border-left: 3px solid ${accentColor}; padding: 8px 12px;
                font-size: 12px; color: #555; border-radius: 0 6px 6px 0; margin-bottom: 20px; }
    .qr-box { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .qr-label { font-size: 9px; color: #aaa; letter-spacing: 0.1em; text-transform: uppercase; }
    .footer-brand { display: flex; align-items: center; gap: 8px; }
    .footer-text { font-size: 10px; color: #bbb; margin-top: 4px; }
    @media print { body { background: white; padding: 0; }
                   .card { box-shadow: none; border-radius: 0; } }
  </style>
</head><body>
  <div class="card">
    <div class="top-bar"></div>
    <div class="inner">

      <!-- Header: merchant logo+name vs invoice meta -->
      <div class="hdr">
        <div>
          ${d.merchant?.logoUrl
            ? `<img src="${d.merchant.logoUrl}" alt="logo"
                    style="height:48px;max-width:160px;object-fit:contain;margin-bottom:8px;display:block;border-radius:6px" />`
            : ''}
          <div class="merchant-name">${merchantName}</div>
          ${d.merchant?.description ? `<div style="font-size:11px;color:#888;margin-top:2px">${d.merchant.description}</div>` : ''}
          <div class="merchant-meta">
            ${[d.merchant?.address, d.merchant?.phone, d.merchant?.email, d.merchant?.website]
              .filter(Boolean).join('<br>')}
            ${d.merchant?.taxId ? `<br>Tax ID: ${d.merchant.taxId}` : ''}
          </div>
        </div>
        <div class="inv-block">
          <div class="inv-title">INVOICE</div>
          <div class="inv-no">${invNo}</div>
          <div><span class="status-badge">${statusLabel}</span></div>
        </div>
      </div>

      <hr class="divider">

      <!-- Bill From / Bill To -->
      <div class="grid2">
        <div>
          <div class="section-label">Bill From</div>
          <div class="party-name">${merchantName}</div>
          ${d.myShortId ? `<div class="party-id">@${privacyId(d.myShortId)}</div>` : ''}
        </div>
        <div>
          <div class="section-label">Bill To</div>
          ${d.payerRealName
            ? `<div class="party-name">${d.payerRealName}</div>
               ${d.payerShortId ? `<div class="party-id">@${privacyId(d.payerShortId)}</div>` : ''}`
            : d.payerNickname || d.payerShortId
              ? `<div class="party-name">${d.payerNickname ?? '—'}</div>
                 <div class="party-id">@${privacyId(d.payerShortId)}</div>`
              : `<div class="party-name" style="color:#bbb">—</div>`}
        </div>
      </div>

      <!-- Dates -->
      <div class="grid2" style="margin-bottom:24px">
        <div>
          <div class="section-label">Issue Date</div>
          <div style="font-size:13px;font-weight:600">${fmtDate(d.createdAt)}</div>
        </div>
        ${d.dueDate ? `<div>
          <div class="section-label">Due Date</div>
          <div style="font-size:13px;font-weight:600">${d.dueDate}</div>
        </div>` : ''}
      </div>

      ${d.note ? `<div class="note-box">Note: ${d.note}</div>` : ''}

      <!-- Amount breakdown -->
      <div class="amount-row">
        <span class="amount-label">Invoice Amount</span>
        <span class="amount-val">${amtNum.toFixed(4)} iUSD</span>
      </div>
      <div class="amount-row">
        <span class="amount-label">Platform Fee (0.5%${Number(fee) >= FEE_CAP_IUSD ? ', capped' : ''})</span>
        <span class="amount-val" style="color:#888">− ${fee} iUSD</span>
      </div>
      <div class="total-row">
        <span class="total-label">Recipient Gets</span>
        <span class="total-val">${recipientGets} iUSD</span>
      </div>

      ${d.paidAt ? `<div style="margin-top:12px;font-size:11px;color:#16a34a;font-weight:600">
        ✓ Paid ${fmtDate(d.paidAt)}
        ${d.txHash ? `<br><span style="font-family:monospace;font-size:9px;color:#888">${d.txHash}</span>` : ''}
      </div>` : ''}

      <!-- Bottom: classic logo block + QR -->
      <div class="bottom">
        <div>
          ${classicFooterBlock()}
          <div class="footer-text" style="margin-top:8px;padding-left:4px">iusd-pay.xyz · INITIA</div>
        </div>
        ${qrUrl ? `<div class="qr-box">
          <div style="position:relative;width:80px;height:80px">
            <img src="${qrUrl}" width="80" height="80" style="border:1px solid #eee;border-radius:6px" />
            <img src="${IUSD_LOGO_URL}" width="20" height="20"
                 style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border-radius:50%;background:#fff;padding:1px" />
          </div>
          <div class="qr-label">Pay Link</div>
        </div>` : ''}
      </div>

    </div>
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),600)</script>
</body></html>`

  // Use blob URL for better mobile browser compatibility (popup blockers)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (!w) window.location.href = url
}

