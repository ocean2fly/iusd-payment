/**
 * Dynamic OG Image Generator for Gift links
 *
 * GET /og/gift/:packetId — Returns a 1200x630 PNG for social media previews.
 * Matches the frontend QR card style: dark bg, pixel font, mystery gift box.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createCanvas, loadImage, registerFont } from 'canvas'
import QRCode from 'qrcode'
import { getDb } from '../db'
import { encodeGiftGroupCode } from '../lib/giftCrypto'
import { APP_URL } from '../shared/config'
import { pickLocale } from '../lib/i18n'
import path from 'path'

// ── OG image phrase i18n ────────────────────────────────────────────────
// Short label strings drawn on OG PNGs via ctx.fillText. We keep the
// canvas code English-by-default and pass translations in. Client locale
// comes from ?lng= query or Accept-Language (bots often forward it).
type OgPhrase =
  | 'scanToOpen' | 'giftWaiting' | 'only' | 'scanAndGift'
  | 'iGot' | 'giveTip' | 'scanProfile' | 'invoice'
  | 'from' | 'aTip'
  | 'paymentReceipt' | 'privateTag' | 'receiptTitle' | 'receiptDesc'
const OG_PHRASES: Record<OgPhrase, Record<string, string>> = {
  scanToOpen: {
    en:'Scan to open', 'zh-CN':'扫码打开', 'zh-TW':'掃碼打開', ja:'スキャンして開く', ko:'스캔하여 열기',
    th:'สแกนเพื่อเปิด', es:'Escanea para abrir', it:'Scansiona per aprire', fr:'Scanner pour ouvrir', de:'Zum Öffnen scannen',
    pt:'Escaneie para abrir', hi:'खोलने के लिए स्कैन करें', ar:'امسح لفتح', tr:'Açmak için tara', el:'Σάρωση για άνοιγμα',
    ru:'Сканировать, чтобы открыть', ms:'Imbas untuk buka', id:'Pindai untuk buka', fil:'I-scan para buksan',
  },
  giftWaiting: {
    en:'A gift is waiting for you', 'zh-CN':'有一份礼物等着你', 'zh-TW':'有一份禮物等著你', ja:'ギフトが届いています', ko:'선물이 기다리고 있어요',
    th:'มีของขวัญรอคุณอยู่', es:'Un regalo te espera', it:'Un regalo ti aspetta', fr:'Un cadeau vous attend', de:'Ein Geschenk wartet auf dich',
    pt:'Um presente espera por você', hi:'एक उपहार आपका इंतज़ार कर रहा है', ar:'هدية تنتظرك', tr:'Seni bir hediye bekliyor', el:'Ένα δώρο σε περιμένει',
    ru:'Вас ждёт подарок', ms:'Hadiah menunggu anda', id:'Sebuah hadiah menantimu', fil:"May naghihintay na regalo sa'yo",
  },
  only: {
    en:'Only', 'zh-CN':'仅', 'zh-TW':'僅', ja:'あと', ko:'단',
    th:'เหลือ', es:'Solo', it:'Solo', fr:'Seulement', de:'Nur',
    pt:'Apenas', hi:'केवल', ar:'فقط', tr:'Sadece', el:'Μόνο',
    ru:'Только', ms:'Hanya', id:'Hanya', fil:'Lamang',
  },
  scanAndGift: {
    en:'Scan and Gift', 'zh-CN':'扫一扫送礼', 'zh-TW':'掃一掃送禮', ja:'スキャンしてギフト', ko:'스캔하고 선물',
    th:'สแกนและมอบของขวัญ', es:'Escanea y regala', it:'Scansiona e regala', fr:'Scanner et offrir', de:'Scannen und schenken',
    pt:'Escaneie e presenteie', hi:'स्कैन करें और उपहार दें', ar:'امسح وأهدِ', tr:'Tara ve hediye et', el:'Σάρωση και δώρο',
    ru:'Сканируй и подари', ms:'Imbas dan Hadiah', id:'Pindai dan Beri Hadiah', fil:'I-scan at Mag-regalo',
  },
  iGot: {
    en:'★ I GOT', 'zh-CN':'★ 我收到了', 'zh-TW':'★ 我收到了', ja:'★ ゲットしました', ko:'★ 받았어요',
    th:'★ ฉันได้รับ', es:'★ RECIBÍ', it:'★ HO RICEVUTO', fr:'★ J\'AI REÇU', de:'★ ICH HABE',
    pt:'★ RECEBI', hi:'★ मुझे मिला', ar:'★ حصلت على', tr:'★ ALDIM', el:'★ ΠΗΡΑ',
    ru:'★ Я ПОЛУЧИЛ', ms:'★ SAYA DAPAT', id:'★ SAYA DAPAT', fil:'★ NAKAKUHA AKO',
  },
  giveTip: {
    en:'Give', 'zh-CN':'赠送', 'zh-TW':'贈送', ja:'あげる', ko:'주기',
    th:'ให้', es:'Dar', it:'Dai', fr:'Donner', de:'Geben',
    pt:'Dar', hi:'दें', ar:'أعطِ', tr:'Ver', el:'Δώσε',
    ru:'Подари', ms:'Beri', id:'Beri', fil:'Bigyan',
  },
  scanProfile: {
    en:'Scan to open {{name}}\'s profile',
    'zh-CN':'扫码打开 {{name}} 的主页', 'zh-TW':'掃碼打開 {{name}} 的主頁',
    ja:'{{name}} のプロフィールをスキャン', ko:'{{name}}의 프로필을 스캔',
    th:'สแกนเพื่อเปิดโปรไฟล์ของ {{name}}', es:'Escanea para ver el perfil de {{name}}',
    it:'Scansiona per il profilo di {{name}}', fr:'Scannez pour ouvrir le profil de {{name}}',
    de:'{{name}}s Profil scannen', pt:'Escaneie para ver o perfil de {{name}}',
    hi:'{{name}} की प्रोफ़ाइल खोलने के लिए स्कैन', ar:'امسح لفتح ملف {{name}}',
    tr:'{{name}} profilini taramak için', el:'Σάρωση για το προφίλ του/της {{name}}',
    ru:'Сканируйте, чтобы открыть профиль {{name}}', ms:'Imbas untuk profil {{name}}',
    id:'Pindai untuk profil {{name}}', fil:'I-scan para buksan ang profile ni {{name}}',
  },
  invoice: {
    en:'INVOICE', 'zh-CN':'发票', 'zh-TW':'發票', ja:'請求書', ko:'청구서',
    th:'ใบแจ้งหนี้', es:'FACTURA', it:'FATTURA', fr:'FACTURE', de:'RECHNUNG',
    pt:'FATURA', hi:'चालान', ar:'فاتورة', tr:'FATURA', el:'ΤΙΜΟΛΟΓΙΟ',
    ru:'СЧЁТ', ms:'INVOIS', id:'TAGIHAN', fil:'INVOICE',
  },
  from: {
    en:'FROM', 'zh-CN':'来自', 'zh-TW':'來自', ja:'送信者', ko:'보낸 사람',
    th:'จาก', es:'DE', it:'DA', fr:'DE', de:'VON',
    pt:'DE', hi:'की ओर से', ar:'من', tr:'GÖNDEREN', el:'ΑΠΟ',
    ru:'ОТ', ms:'DARIPADA', id:'DARI', fil:'MULA KAY',
  },
  aTip: {
    en:'a tip', 'zh-CN':'的小费', 'zh-TW':'的小費', ja:'のチップ', ko:' 팁',
    th:'ทิป', es:'una propina', it:'una mancia', fr:'un pourboire', de:'ein Trinkgeld',
    pt:'uma gorjeta', hi:'एक टिप', ar:'إكرامية', tr:'bahşiş', el:'φιλοδώρημα',
    ru:'чаевые', ms:'tip', id:'tip', fil:'tip',
  },
  paymentReceipt: {
    en:'PAYMENT RECEIPT', 'zh-CN':'付款凭证', 'zh-TW':'付款憑證', ja:'支払い領収書', ko:'결제 영수증',
    th:'ใบเสร็จรับเงิน', es:'RECIBO DE PAGO', it:'RICEVUTA DI PAGAMENTO', fr:'REÇU DE PAIEMENT', de:'ZAHLUNGSBELEG',
    pt:'RECIBO DE PAGAMENTO', hi:'भुगतान रसीद', ar:'إيصال الدفع', tr:'ÖDEME MAKBUZU', el:'ΑΠΟΔΕΙΞΗ ΠΛΗΡΩΜΗΣ',
    ru:'ЧЕК ОПЛАТЫ', ms:'RESIT BAYARAN', id:'BUKTI PEMBAYARAN', fil:'RESIBO NG BAYAD',
  },
  privateTag: {
    en:'✓ PRIVATE', 'zh-CN':'✓ 隐私', 'zh-TW':'✓ 隱私', ja:'✓ プライベート', ko:'✓ 비공개',
    th:'✓ ส่วนตัว', es:'✓ PRIVADO', it:'✓ PRIVATO', fr:'✓ PRIVÉ', de:'✓ PRIVAT',
    pt:'✓ PRIVADO', hi:'✓ निजी', ar:'✓ خاص', tr:'✓ GİZLİ', el:'✓ ΙΔΙΩΤΙΚΟ',
    ru:'✓ ПРИВАТНО', ms:'✓ PRIVAT', id:'✓ PRIBADI', fil:'✓ PRIBADO',
  },
  receiptTitle: {
    en:'Receipt · {{amount}} iUSD', 'zh-CN':'收据 · {{amount}} iUSD', 'zh-TW':'收據 · {{amount}} iUSD',
    ja:'領収書 · {{amount}} iUSD', ko:'영수증 · {{amount}} iUSD', th:'ใบเสร็จ · {{amount}} iUSD',
    es:'Recibo · {{amount}} iUSD', it:'Ricevuta · {{amount}} iUSD', fr:'Reçu · {{amount}} iUSD',
    de:'Beleg · {{amount}} iUSD', pt:'Recibo · {{amount}} iUSD', hi:'रसीद · {{amount}} iUSD',
    ar:'إيصال · {{amount}} iUSD', tr:'Makbuz · {{amount}} iUSD', el:'Απόδειξη · {{amount}} iUSD',
    ru:'Чек · {{amount}} iUSD', ms:'Resit · {{amount}} iUSD', id:'Bukti · {{amount}} iUSD',
    fil:'Resibo · {{amount}} iUSD',
  },
  receiptDesc: {
    en:'Private stablecoin payment receipt on iUSD Pay',
    'zh-CN':'iUSD Pay 上的隐私稳定币付款凭证',
    'zh-TW':'iUSD Pay 上的隱私穩定幣付款憑證',
    ja:'iUSD Pay のプライバシー型ステーブルコイン支払いレシート',
    ko:'iUSD Pay의 프라이빗 스테이블코인 결제 영수증',
    th:'ใบเสร็จการชำระด้วยเสถียรภาพส่วนตัวบน iUSD Pay',
    es:'Recibo privado de pago con stablecoin en iUSD Pay',
    it:'Ricevuta privata di pagamento con stablecoin su iUSD Pay',
    fr:'Reçu privé de paiement en stablecoin sur iUSD Pay',
    de:'Privater Stablecoin-Zahlungsbeleg auf iUSD Pay',
    pt:'Recibo privado de pagamento em stablecoin no iUSD Pay',
    hi:'iUSD Pay पर निजी स्टेबलकॉइन भुगतान रसीद',
    ar:'إيصال دفع خاص بعملة مستقرة على iUSD Pay',
    tr:'iUSD Pay üzerinde özel stablecoin ödeme makbuzu',
    el:'Ιδιωτική απόδειξη πληρωμής stablecoin στο iUSD Pay',
    ru:'Приватный чек оплаты стейблкоином на iUSD Pay',
    ms:'Resit bayaran stablecoin peribadi di iUSD Pay',
    id:'Bukti pembayaran stablecoin pribadi di iUSD Pay',
    fil:'Pribadong resibo ng stablecoin na bayad sa iUSD Pay',
  },
}
function ogT(phrase: OgPhrase, locale: string, vars: Record<string, string> = {}): string {
  const bundle = OG_PHRASES[phrase]
  let s = bundle[locale] ?? bundle['en']
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{{${k}}}`, v)
  return s
}

/** Pull OG locale from ?lng= query (shareable) or Accept-Language (bot). */
function ogLocale(req: FastifyRequest): string {
  const q = (req.query as any)?.lng
  if (typeof q === 'string' && q) {
    const [lang, region] = q.split('-')
    const norm = region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase()
    return pickLocale(norm)
  }
  return pickLocale(req.headers['accept-language'] as string | undefined)
}

const OG_W = 1200
const OG_H = 630

// Gift box color styles — must match frontend GIFT_BOX_STYLES
const GIFT_BOX_STYLES = [
  'red', 'orange', 'lime', 'yellow', 'blue', 'forest',
  'teal', 'pink', 'purple', 'silver', 'gold', 'darkblue',
]

// Register pixel font
try {
  const fontPath = path.join(__dirname, '..', 'fonts', 'PressStart2P-Regular.ttf')
  registerFont(fontPath, { family: 'Press Start 2P' })
} catch (e) {
  // Try alternative paths
  try {
    registerFont(path.join(process.cwd(), 'fonts', 'PressStart2P-Regular.ttf'), { family: 'Press Start 2P' })
  } catch {}
}

/** FNV-1a hash — same as frontend */
function fnvHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

/** Extract packetId from either 32-char hex packetId or base64url group code (contains pid in first 16 bytes) */
function extractPacketId(param: string): string | null {
  if (!param) return null
  // Plain 32-char hex packetId
  if (/^[0-9a-f]{32}$/i.test(param)) return param.toLowerCase()
  // Base64url group code: 48 bytes → 64 chars base64url. First 16 bytes = packetId
  try {
    const buf = Buffer.from(param, 'base64url')
    if (buf.length >= 16) return buf.subarray(0, 16).toString('hex')
  } catch {}
  return null
}

/** Format micro units to human iUSD string (matches frontend formatIusd) */
function formatIusd(raw: number | string | null | undefined): string {
  if (raw == null) return '0.00'
  const n = typeof raw === 'string' ? parseFloat(raw) : raw
  if (isNaN(n)) return '0.00'
  // Heuristic: if integer > 1000, assume micro units
  const v = n >= 1000 && Number.isInteger(n) ? n / 1_000_000 : n
  return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Load iUSD logo from disk, try multiple paths. */
async function loadIusdLogo() {
  const paths = [
    `/home/jack_initia_xyz/ipay-deploy/frontend/images/iusd.png`,
    `/home/jack_initia_xyz/mywork/ipay/packages/app/public/images/iusd.png`,
    path.join(__dirname, '..', '..', '..', '..', 'app', 'public', 'images', 'iusd.png'),
  ]
  for (const p of paths) {
    try { require('fs').accessSync(p); return await loadImage(p) } catch {}
  }
  return null
}

/**
 * Draw the standard iUSD Pay logo + wordmark at the top-left.
 * Used across all OG templates for brand consistency.
 */
async function drawBrandHeader(ctx: any, x = 30, y = 25) {
  const logo = await loadIusdLogo()
  if (logo) ctx.drawImage(logo, x, y, 34, 34)
  ctx.fillStyle = '#ffffff'
  ctx.font = `16px 'Press Start 2P', 'DejaVu Sans', monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('iUSD Pay', x + 42, y + 23)
}

/** Draw a small QR in the bottom-right corner for scanning the link. */
async function drawQrCorner(ctx: any, url: string, opts?: { size?: number; x?: number; y?: number; locale?: string }) {
  const size = opts?.size ?? 160
  const x = opts?.x ?? OG_W - size - 40
  const y = opts?.y ?? OG_H - size - 40
  const locale = opts?.locale ?? 'en'
  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: size * 2,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'L',
    })
    const qrImg = await loadImage(qrDataUrl)
    // White rounded backing
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(x - 8, y - 8, size + 16, size + 16, 10)
    ctx.fill()
    ctx.drawImage(qrImg, x, y, size, size)
    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = `10px 'Press Start 2P', 'DejaVu Sans', monospace`
    ctx.textAlign = 'center'
    ctx.fillText(ogT('scanToOpen', locale), x + size / 2, y + size + 26)
  } catch {}
}

/** Draw footer branding at the bottom. */
function drawFooter(ctx: any) {
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.font = `9px 'Press Start 2P', 'DejaVu Sans', monospace`
  ctx.textAlign = 'center'
  ctx.fillText('iusd-pay.xyz', OG_W / 2, OG_H - 20)
}

/** Standard HTML meta template for crawlers. */
function buildOgMetaHtml(p: { title: string; description: string; image: string; url?: string }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(p.title)}</title>
  <meta property="og:title" content="${esc(p.title)}" />
  <meta property="og:description" content="${esc(p.description)}" />
  <meta property="og:image" content="${p.image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="iUSD Pay" />
  ${p.url ? `<meta property="og:url" content="${p.url}" />` : ''}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(p.title)}" />
  <meta name="twitter:description" content="${esc(p.description)}" />
  <meta name="twitter:image" content="${p.image}" />
</head>
<body></body>
</html>`
}

export async function ogRoutes(app: FastifyInstance) {

  app.get('/og/gift/:packetId', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawParam = (req.params as any).packetId as string
    const pid = extractPacketId(rawParam)
    if (!pid) return reply.status(400).send({ error: 'Missing packetId' })
    const locale = ogLocale(req)

    const db = getDb()
    const meta = db.prepare(`
      SELECT p.sender_message, p.num_slots, p.sender_address, p.box_id, p.total_amount,
             p.claim_key_hex, p.mode, p.wrap_style_id, p.wrap_params,
             a.nickname AS sender_nickname
      FROM gift_v3_packets p
      LEFT JOIN accounts a ON lower(a.address) = lower(p.sender_address)
      WHERE p.packet_id = ?
    `).get(pid) as any

    if (!meta) return reply.status(404).send({ error: 'Not found' })

    // Build claim URL
    let claimUrl = `${APP_URL}/gift/claim?p=${pid}`
    if (meta.mode === 1 && meta.claim_key_hex) {
      claimUrl = `${APP_URL}/g/${encodeGiftGroupCode(pid, meta.claim_key_hex)}`
    }

    const senderNick = meta.sender_nickname ?? 'Someone'
    const senderAddr = meta.sender_address ?? ''
    const wrapStyleId = meta.wrap_style_id ?? 0

    // DNA hue from sender address
    const dnaHue = senderAddr ? fnvHash(senderAddr.toLowerCase()) % 360 : 200

    // Create canvas
    const canvas = createCanvas(OG_W, OG_H)
    const ctx = canvas.getContext('2d')

    // ── Background: dark gradient ──
    ctx.fillStyle = '#0d0d1a'
    ctx.fillRect(0, 0, OG_W, OG_H)

    // Subtle radial glow in center
    const glow = ctx.createRadialGradient(OG_W / 2, OG_H / 2, 0, OG_W / 2, OG_H / 2, 400)
    glow.addColorStop(0, `hsla(${dnaHue}, 40%, 20%, 0.3)`)
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, OG_W, OG_H)

    // ── Sparkle dots ──
    const sparkles = [
      { x: 120, y: 80 }, { x: 250, y: 520 }, { x: 1050, y: 100 },
      { x: 950, y: 500 }, { x: 600, y: 50 }, { x: 700, y: 580 },
    ]
    ctx.fillStyle = '#FFD700'
    for (const s of sparkles) {
      ctx.globalAlpha = 0.4
      ctx.beginPath()
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    const pixelFont = "'Press Start 2P', 'DejaVu Sans', monospace"

    // ── iUSD Pay logo top-left ──
    try {
      const logoPaths = [
        `/home/jack_initia_xyz/ipay-deploy/frontend/images/iusd.png`,
        `/home/jack_initia_xyz/mywork/ipay/packages/app/public/images/iusd.png`,
      ]
      let logoPath = logoPaths[0]
      for (const p of logoPaths) { try { require('fs').accessSync(p); logoPath = p; break } catch {} }
      const logo = await loadImage(logoPath)
      ctx.drawImage(logo, 30, 25, 28, 28)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `14px ${pixelFont}`
      ctx.textAlign = 'left'
      ctx.fillText('iUSD Pay', 65, 45)
    } catch {}

    // ── Title text ──

    // "FROM [SENDER]" — DNA color
    ctx.fillStyle = `hsl(${dnaHue}, 60%, 55%)`
    ctx.font = `20px ${pixelFont}`
    ctx.textAlign = 'center'
    ctx.fillText(`${ogT('from', locale)} ${senderNick.toUpperCase()}`, OG_W / 2, 90)

    // "A gift is waiting for you" — gold, larger
    ctx.fillStyle = '#d4a017'
    ctx.font = `24px ${pixelFont}`
    ctx.fillText(ogT('giftWaiting', locale), OG_W / 2, 130)

    // ── Gift box image (left side) ──
    const styleIdx = Math.abs(wrapStyleId) % GIFT_BOX_STYLES.length
    const colorName = GIFT_BOX_STYLES[styleIdx]
    // Try multiple paths: source repo → deploy frontend
    const possiblePaths = [
      path.join(__dirname, '..', '..', '..', '..', 'app', 'public', 'images', 'gift-assets', `box_${styleIdx}_${colorName}.png`),
      path.join(process.cwd(), '..', 'app', 'public', 'images', 'gift-assets', `box_${styleIdx}_${colorName}.png`),
      `/home/jack_initia_xyz/ipay-deploy/frontend/images/gift-assets/box_${styleIdx}_${colorName}.png`,
      `/home/jack_initia_xyz/mywork/ipay/packages/app/public/images/gift-assets/box_${styleIdx}_${colorName}.png`,
    ]
    let boxImagePath = possiblePaths[0]
    for (const p of possiblePaths) {
      try { require('fs').accessSync(p); boxImagePath = p; break } catch {}
    }

    try {
      const boxImg = await loadImage(boxImagePath)
      // Draw box centered-left, with glow
      const boxSize = 320
      const boxX = OG_W / 2 - boxSize - 40
      const boxY = 160

      // Glow behind box
      const boxGlow = ctx.createRadialGradient(boxX + boxSize / 2, boxY + boxSize / 2, 0, boxX + boxSize / 2, boxY + boxSize / 2, boxSize * 0.7)
      const glowColors: Record<string, string> = {
        red: 'rgba(255,120,120,0.25)', orange: 'rgba(255,180,80,0.25)', lime: 'rgba(160,255,120,0.25)',
        yellow: 'rgba(255,215,0,0.25)', blue: 'rgba(100,180,255,0.25)', forest: 'rgba(80,200,120,0.25)',
        teal: 'rgba(80,220,210,0.25)', pink: 'rgba(255,150,200,0.25)', purple: 'rgba(180,120,255,0.25)',
        silver: 'rgba(200,200,220,0.2)', gold: 'rgba(255,200,80,0.25)', darkblue: 'rgba(100,140,220,0.25)',
      }
      boxGlow.addColorStop(0, glowColors[colorName] ?? 'rgba(255,215,0,0.2)')
      boxGlow.addColorStop(1, 'transparent')
      ctx.fillStyle = boxGlow
      ctx.fillRect(boxX - 40, boxY - 40, boxSize + 80, boxSize + 80)

      // Scale and draw
      const scale = Math.min(boxSize / boxImg.width, boxSize / boxImg.height)
      const w = boxImg.width * scale
      const h = boxImg.height * scale
      ctx.drawImage(boxImg, boxX + (boxSize - w) / 2, boxY + (boxSize - h) / 2, w, h)
    } catch (e) {
      // Fallback: draw a colored rectangle if image not found
      ctx.fillStyle = `hsl(${dnaHue}, 50%, 40%)`
      ctx.fillRect(OG_W / 2 - 200, 180, 160, 160)
      ctx.fillStyle = '#FFD700'
      ctx.font = `60px ${pixelFont}`
      ctx.fillText('🎁', OG_W / 2 - 120, 290)
    }

    // ── QR code (right side) ──
    const qrSize = 280
    const qrX = OG_W / 2 + 40
    const qrY = 165
    try {
      const qrDataUrl = await QRCode.toDataURL(claimUrl, {
        width: qrSize * 2,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'L', // low — sparsest possible, easiest to scan
      })
      const qrImg = await loadImage(qrDataUrl)

      // White rounded backing for scan reliability
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 12)
      ctx.fill()

      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)
    } catch {}

    // "Scan to open" — white, pixel font, left-aligned with QR
    ctx.fillStyle = '#ffffff'
    ctx.font = `14px ${pixelFont}`
    ctx.textAlign = 'left'
    ctx.fillText(ogT('scanToOpen', locale), qrX, qrY + qrSize + 35)

    // "Only [logo] iUSD Pay" — matches frontend layout
    const brandY = qrY + qrSize + 60
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = `10px ${pixelFont}`
    ctx.textAlign = 'left'
    ctx.fillText(ogT('only', locale), qrX, brandY)
    const onlyWidth = ctx.measureText('Only').width

    // iUSD logo between "Only" and "iUSD Pay"
    const logoSize = 16
    const logoX = qrX + onlyWidth + 8
    try {
      const logoPaths = [
        path.join(__dirname, '..', '..', '..', '..', 'app', 'public', 'images', 'iusd.png'),
        `/home/jack_initia_xyz/ipay-deploy/frontend/images/iusd.png`,
        `/home/jack_initia_xyz/mywork/ipay/packages/app/public/images/iusd.png`,
      ]
      let logoPath = logoPaths[0]
      for (const p of logoPaths) { try { require('fs').accessSync(p); logoPath = p; break } catch {} }
      const logo = await loadImage(logoPath)
      ctx.drawImage(logo, logoX, brandY - logoSize + 2, logoSize, logoSize)
    } catch {}

    // "iUSD Pay" after logo
    ctx.fillStyle = '#ffffff'
    ctx.font = `11px ${pixelFont}`
    ctx.fillText('iUSD Pay', logoX + logoSize + 6, brandY)

    // Return PNG
    const buffer = canvas.toBuffer('image/png')
    reply.header('Content-Type', 'image/png')
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate'); reply.header('Pragma', 'no-cache')
    return reply.send(buffer)
  })

  // HTML meta endpoint for crawlers
  app.get('/og/gift/:packetId/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawParam = (req.params as any).packetId as string
    const pid = extractPacketId(rawParam)
    if (!pid) return reply.status(400).send({ error: 'Missing packetId' })
    const db = getDb()
    const meta = db.prepare(`
      SELECT a.nickname AS sender_nickname
      FROM gift_v3_packets p
      LEFT JOIN accounts a ON lower(a.address) = lower(p.sender_address)
      WHERE p.packet_id = ?
    `).get(pid) as any

    const nick = meta?.sender_nickname ?? 'Someone'
    const ogImageUrl = `${APP_URL.replace('iusd-pay.xyz', 'api.iusd-pay.xyz')}/v1/og/gift/${rawParam}`

    reply.header('Content-Type', 'text/html')
    return reply.send(`<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="🎁 ${nick} sent you a gift!" />
  <meta property="og:description" content="A gift is waiting for you. Tap to open!" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="🎁 ${nick} sent you a gift!" />
  <meta name="twitter:description" content="A gift is waiting for you. Tap to open!" />
  <meta name="twitter:image" content="${ogImageUrl}" />
</head>
<body></body>
</html>`)
  })

  // ── Profile OG image ──────────────────────────────────────────────────────
  app.get('/og/profile/:shortId', async (req: FastifyRequest, reply: FastifyReply) => {
    const shortId = ((req.params as any).shortId as string || '').toUpperCase()
    if (!shortId) return reply.status(400).send({ error: 'Missing shortId' })
    const locale = ogLocale(req)

    const db = getDb()
    const account = db.prepare('SELECT * FROM accounts WHERE short_id = ?').get(shortId) as any
    if (!account) return reply.status(404).send({ error: 'Not found' })

    const nick = account.nickname ?? shortId
    // Strip emoji (server has no emoji font)
    const rawBio = account.bio || 'Scan and Gift'
    const bio = rawBio.replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|✨/gu, '').trim() || 'Scan and Gift'
    const addr = account.address ?? ''
    const head = shortId.slice(0, 4)
    const tail = shortId.slice(-4)

    // DNA color
    const dnaHue = addr ? fnvHash(addr.toLowerCase()) % 360 : 200

    const profileUrl = `${APP_URL}/profile/${shortId}`

    const canvas = createCanvas(OG_W, OG_H)
    const ctx = canvas.getContext('2d')

    // Background — dark
    ctx.fillStyle = '#111827'
    ctx.fillRect(0, 0, OG_W, OG_H)

    // Concentric rings
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    for (let r = 60; r < 350; r += 55) {
      ctx.beginPath(); ctx.arc(OG_W / 2, OG_H / 2, r, 0, Math.PI * 2); ctx.stroke()
    }

    // DNA glow
    const glow = ctx.createRadialGradient(OG_W / 2, OG_H / 2, 0, OG_W / 2, OG_H / 2, 250)
    glow.addColorStop(0, `hsla(${dnaHue}, 40%, 30%, 0.12)`)
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, OG_W, OG_H)

    const pixelFont = "'Press Start 2P', 'DejaVu Sans', monospace"

    // Gold top line
    const gold = ctx.createLinearGradient(0, 0, OG_W, 0)
    gold.addColorStop(0, 'rgba(255,215,0,0)')
    gold.addColorStop(0.3, '#FFD700')
    gold.addColorStop(0.7, '#FFD700')
    gold.addColorStop(1, 'rgba(255,215,0,0)')
    ctx.fillStyle = gold
    ctx.fillRect(0, 0, OG_W, 3)

    // nickname — large, centered
    ctx.fillStyle = '#ffffff'
    ctx.font = `28px ${pixelFont}`
    ctx.textAlign = 'center'
    const nickText = nick
    const nickW = ctx.measureText(nickText).width

    // @ID-DNA — DNA colored, right after nickname
    const idText = `@${head}◆◆◆${tail}`
    ctx.font = `14px ${pixelFont}`
    const idW = ctx.measureText(idText).width

    const totalW = nickW + 12 + idW
    const startX = (OG_W - totalW) / 2

    // Draw nickname
    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffffff'
    ctx.font = `28px ${pixelFont}`
    ctx.fillText(nickText, startX, 200)

    // Draw @ID-DNA
    ctx.fillStyle = `hsl(${dnaHue}, 60%, 55%)`
    ctx.font = `14px ${pixelFont}`
    ctx.fillText(idText, startX + nickW + 12, 200)

    // Slogan — italic feel via smaller pixel font
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = `13px ${pixelFont}`
    ctx.textAlign = 'center'
    ctx.fillText(bio.length > 40 ? bio.slice(0, 40) + '…' : bio, OG_W / 2, 245)

    // QR code — centered below (always dark-on-white for scan reliability)
    const qrSize = 260
    const qrX = (OG_W - qrSize) / 2
    const qrY = 280
    try {
      const qrDataUrl = await QRCode.toDataURL(profileUrl, {
        width: qrSize * 2,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'L',
      })
      const qrImg = await loadImage(qrDataUrl)
      // White backing for contrast on dark canvas
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 10)
      ctx.fill()
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)
    } catch {}

    // "Scan and Gift ✨" below QR
    ctx.fillStyle = '#ffffff'
    ctx.font = `12px ${pixelFont}`
    ctx.textAlign = 'center'
    ctx.fillText(ogT('scanAndGift', locale), OG_W / 2, qrY + qrSize + 35)

    // Brand header (top-left) + footer
    await drawBrandHeader(ctx)
    drawFooter(ctx)

    const buffer = canvas.toBuffer('image/png')
    reply.header('Content-Type', 'image/png')
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate'); reply.header('Pragma', 'no-cache')
    return reply.send(buffer)
  })

  // ══════════════════════════════════════════════════════════════════════
  // Profile meta (HTML for bot crawlers)
  // ══════════════════════════════════════════════════════════════════════
  app.get('/og/profile/:shortId/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    const shortId = ((req.params as any).shortId as string || '').toUpperCase()
    const db = getDb()
    const account = db.prepare('SELECT nickname FROM accounts WHERE short_id = ?').get(shortId) as any
    const nick = account?.nickname ?? shortId
    const ogImage = `${APP_URL.replace('iusd-pay.xyz', 'api.iusd-pay.xyz')}/v1/og/profile/${shortId}`
    reply.header('Content-Type', 'text/html')
    return reply.send(buildOgMetaHtml({
      title: `${nick} on iUSD Pay`,
      description: `Scan ${nick}'s profile to pay or send a gift on iUSD Pay.`,
      image: ogImage,
      url: `${APP_URL}/profile/${shortId}`,
    }))
  })

  // ══════════════════════════════════════════════════════════════════════
  // Gift SHARED OG — post-claim reveal ("x received from y")
  // ══════════════════════════════════════════════════════════════════════
  app.get('/og/gift/:packetId/shared', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawParam = (req.params as any).packetId as string
    const pid = extractPacketId(rawParam)
    if (!pid) return reply.status(400).send({ error: 'Missing packetId' })
    const locale = ogLocale(req)

    const db = getDb()
    const meta = db.prepare(`
      SELECT p.sender_message, p.num_slots, p.sender_address, p.box_id, p.total_amount,
             p.wrap_style_id, p.mode, p.claim_key_hex,
             a.nickname AS sender_nickname,
             b.image_urls, b.name AS box_name
      FROM gift_v3_packets p
      LEFT JOIN accounts a ON lower(a.address) = lower(p.sender_address)
      LEFT JOIN gift_box_meta b ON b.box_id = p.box_id
      WHERE p.packet_id = ?
    `).get(pid) as any
    if (!meta) return reply.status(404).send({ error: 'Not found' })

    // Pick the most recent claim with a reply (for richest OG)
    const claim = db.prepare(`
      SELECT c.amount, c.thank_emoji, c.thank_message, c.claimed_at, c.claimer_address,
             a.nickname AS claimer_nickname, a.short_id AS claimer_short_id
      FROM gift_v3_claims c
      LEFT JOIN accounts a ON lower(a.address) = lower(c.claimer_address)
      WHERE c.packet_id = ?
      ORDER BY (c.thank_message IS NOT NULL) DESC, c.claimed_at DESC
      LIMIT 1
    `).get(pid) as any

    // Counts for stats row
    const claimCounts = db.prepare(`SELECT COUNT(*) as cnt FROM gift_v3_claims WHERE packet_id = ?`).get(pid) as any
    const claimedCount = Number(claimCounts?.cnt ?? 0)
    const viewerCount = Number((db.prepare(`SELECT COUNT(*) as cnt FROM gift_views WHERE packet_id = ?`).get(pid) as any)?.cnt ?? 0)

    const senderNick = meta.sender_nickname ?? 'Someone'
    const claimerNick = claim?.claimer_nickname ?? 'A friend'
    const gotAmount = formatIusd(claim?.amount ?? meta.total_amount)
    const totalAmount = formatIusd(meta.total_amount)
    const shares = meta.num_slots ?? 1
    const giftTitle = (meta.box_name ?? 'Gift').slice(0, 40)

    // Strip emojis from memo (matches frontend signature-cleaning)
    const rawMessage = meta.sender_message ?? ''
    const cleanMessage = rawMessage
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)

    // DNA hue from sender
    const dnaHue = meta.sender_address ? fnvHash(meta.sender_address.toLowerCase()) % 360 : 200
    const heroHue = claim?.claimer_short_id ? fnvHash(claim.claimer_short_id) % 360 : dnaHue

    const canvas = createCanvas(OG_W, OG_H)
    const ctx = canvas.getContext('2d')

    // Dark background with DNA glow
    ctx.fillStyle = '#0d0d1a'
    ctx.fillRect(0, 0, OG_W, OG_H)
    const glow = ctx.createRadialGradient(600, OG_H / 2, 0, 600, OG_H / 2, 600)
    glow.addColorStop(0, `hsla(${dnaHue}, 45%, 25%, 0.35)`)
    glow.addColorStop(1, 'transparent')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, OG_W, OG_H)

    // Brand header
    await drawBrandHeader(ctx)

    const pixelFont = "'Press Start 2P', 'DejaVu Sans', monospace"
    const scriptFont = '"Brush Script MT", "Comic Sans MS", cursive'

    // ═══ LEFT SIDE: I GOT + Tip card + QR ═══
    // ★ I GOT label
    ctx.fillStyle = `hsl(${heroHue}, 65%, 60%)`
    ctx.font = `14px ${pixelFont}`
    ctx.textAlign = 'left'
    ctx.fillText(ogT('iGot', locale), 50, 120)
    // Big green amount
    ctx.fillStyle = '#22c55e'
    ctx.font = `48px ${pixelFont}`
    const amtText = `+${gotAmount}`
    ctx.fillText(amtText, 50, 175)
    const amtW = ctx.measureText(amtText).width
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = `15px ${pixelFont}`
    ctx.fillText('iUSD', 50 + amtW + 10, 175)
    // (Removed "— claimerNick" below the amount — redundant with the tip CTA)

    // ═══ Claimer's reply message — big pixel font, expressing gratitude ═══
    // Strip emojis from thank message (pixel font can't render them anyway)
    const rawReply = (claim?.thank_message ?? '').toString()
    const cleanReply = rawReply
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
    let replyBottomY = 210 // fallback if no reply
    if (cleanReply) {
      // Auto-fit: pick largest font size that fits within the left column (~560px)
      const maxW = 560
      const fontSizes = [26, 22, 18, 15]
      let chosenSize = 15
      for (const sz of fontSizes) {
        ctx.font = `${sz}px ${pixelFont}`
        if (ctx.measureText(cleanReply).width <= maxW) { chosenSize = sz; break }
      }
      const displayText = cleanReply.length > 48 ? cleanReply.slice(0, 48) + '…' : cleanReply
      ctx.fillStyle = '#d4a017'
      ctx.font = `${chosenSize}px ${pixelFont}`
      ctx.fillText(displayText, 50, 225)
      replyBottomY = 225 + chosenSize + 8
    }

    // "Gift xxx a tip" (★ LOVE WHAT YOU SEE? label removed)
    const tipY = cleanReply ? replyBottomY + 36 : 248
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 22px 'DejaVu Sans', sans-serif`
    const giveWord = ogT('giveTip', locale)
    ctx.fillText(giveWord, 50, tipY)
    const giftW = ctx.measureText(giveWord + ' ').width
    ctx.fillStyle = `hsl(${heroHue}, 65%, 65%)`
    ctx.fillText(claimerNick, 50 + giftW, tipY)
    const nickW = ctx.measureText(claimerNick).width
    ctx.fillStyle = '#ffffff'
    ctx.fillText(' ' + ogT('aTip', locale), 50 + giftW + nickW, tipY)

    // Profile QR (for claimer) — directly below tip CTA
    const qrSize = 160
    const qrX = 50
    const qrY = tipY + 28
    const profileUrl = claim?.claimer_short_id
      ? `${APP_URL}/profile/${claim.claimer_short_id}`
      : `${APP_URL}/gift/show?p=${pid}`
    try {
      const qrDataUrl = await QRCode.toDataURL(profileUrl, {
        width: qrSize * 2,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'L',
      })
      const qrImg = await loadImage(qrDataUrl)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 10)
      ctx.fill()
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)
    } catch {}

    // "Scan to open profile" label
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.font = `11px 'DejaVu Sans', sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText(ogT('scanProfile', locale, { name: claimerNick }), qrX, qrY + qrSize + 24)

    // ═══ RIGHT SIDE: Gift image + title + stats below ═══
    const IMG_SIZE = 480
    const imgX = OG_W - IMG_SIZE - 40
    const imgY = 70
    let productImgUrl: string | null = null
    try {
      const urls = JSON.parse(meta.image_urls ?? '[]')
      if (Array.isArray(urls) && urls.length > 0) productImgUrl = urls[0]
    } catch {}

    // DNA glow behind image
    const imgGlow = ctx.createRadialGradient(
      imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2, 0,
      imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2, IMG_SIZE * 0.7
    )
    imgGlow.addColorStop(0, `hsla(${dnaHue}, 55%, 50%, 0.3)`)
    imgGlow.addColorStop(1, 'transparent')
    ctx.fillStyle = imgGlow
    ctx.fillRect(imgX - 60, imgY - 60, IMG_SIZE + 120, IMG_SIZE + 120)

    if (productImgUrl) {
      try {
        const productImg = await loadImage(productImgUrl)
        const scale = Math.max(IMG_SIZE / productImg.width, IMG_SIZE / productImg.height)
        const dw = productImg.width * scale
        const dh = productImg.height * scale
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 18)
        ctx.clip()
        ctx.drawImage(productImg, imgX + (IMG_SIZE - dw) / 2, imgY + (IMG_SIZE - dh) / 2, dw, dh)
        ctx.restore()
      } catch {}
    } else {
      ctx.fillStyle = `hsl(${dnaHue}, 30%, 20%)`
      ctx.beginPath()
      ctx.roundRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 18)
      ctx.fill()
    }

    // ═══ Signature overlay on image — deterministic slot + tilt (matches frontend) ═══
    // 4 slots: 0=TL, 1=TR, 2=BL, 3=BR
    // 5 tilt angles: -3°, -1.5°, 0°, 1.5°, 3°
    const posSeed = fnvHash((meta.sender_address ?? senderNick) + 'sig')
    const slot = posSeed % 4
    const angleIdx = (posSeed >> 3) % 5
    const tiltDeg = [-3, -1.5, 0, 1.5, 3][angleIdx]
    const tiltRad = (tiltDeg * Math.PI) / 180
    // Corner anchors (relative to image)
    const inset = 28
    const anchors = [
      { x: imgX + inset,             y: imgY + inset + 38,            align: 'left' as const,  from: 'top' as const },    // TL
      { x: imgX + IMG_SIZE - inset,  y: imgY + inset + 38,            align: 'right' as const, from: 'top' as const },    // TR
      { x: imgX + inset,             y: imgY + IMG_SIZE - inset - 34, align: 'left' as const,  from: 'bot' as const },    // BL
      { x: imgX + IMG_SIZE - inset,  y: imgY + IMG_SIZE - inset - 34, align: 'right' as const, from: 'bot' as const },    // BR
    ]
    const anchor = anchors[slot]

    // Draw with rotation around anchor
    ctx.save()
    ctx.translate(anchor.x, anchor.y)
    ctx.rotate(tiltRad)

    // Shadow for legibility on any background
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 3

    ctx.textAlign = anchor.align
    ctx.fillStyle = '#FFD700'
    ctx.font = `bold 38px ${scriptFont}`
    const fromText = `from ${senderNick}`
    ctx.fillText(fromText, 0, 0)

    if (cleanMessage) {
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold 26px ${scriptFont}`
      ctx.fillText(cleanMessage, 0, anchor.from === 'top' ? 40 : -40)
    }
    ctx.restore()

    // Gift title + stats — directly below image on the right
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 18px 'DejaVu Sans', sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText(giftTitle, imgX, imgY + IMG_SIZE + 30)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = `13px 'DejaVu Sans', sans-serif`
    const sharesLabel = shares > 1 ? `${shares} shares` : '1 share'
    ctx.fillText(
      `${claimedCount}/${shares} claimed  ·  ${viewerCount} viewed  ·  ${sharesLabel}`,
      imgX, imgY + IMG_SIZE + 54
    )

    drawFooter(ctx)

    const buffer = canvas.toBuffer('image/png')
    reply.header('Content-Type', 'image/png')
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate'); reply.header('Pragma', 'no-cache')
    return reply.send(buffer)
  })

  // Gift SHARED meta (HTML for crawlers)
  app.get('/og/gift/:packetId/shared/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    const rawParam = (req.params as any).packetId as string
    const pid = extractPacketId(rawParam)
    if (!pid) return reply.status(400).send({ error: 'Missing packetId' })

    const db = getDb()
    const meta = db.prepare(`
      SELECT a.nickname AS sender_nickname
      FROM gift_v3_packets p
      LEFT JOIN accounts a ON lower(a.address) = lower(p.sender_address)
      WHERE p.packet_id = ?
    `).get(pid) as any
    const claim = db.prepare(`
      SELECT c.amount, a.nickname AS claimer_nickname
      FROM gift_v3_claims c
      LEFT JOIN accounts a ON lower(a.address) = lower(c.claimer_address)
      WHERE c.packet_id = ?
      ORDER BY c.claimed_at DESC LIMIT 1
    `).get(pid) as any

    const senderNick = meta?.sender_nickname ?? 'Someone'
    const claimerNick = claim?.claimer_nickname ?? 'A friend'
    const amount = formatIusd(claim?.amount)
    const ogImageUrl = `${APP_URL.replace('iusd-pay.xyz', 'api.iusd-pay.xyz')}/v1/og/gift/${rawParam}/shared`

    reply.header('Content-Type', 'text/html')
    return reply.send(buildOgMetaHtml({
      title: `${claimerNick} received a gift from ${senderNick}`,
      description: `+${amount} iUSD · a gift moment on iUSD Pay`,
      image: ogImageUrl,
      url: `${APP_URL}/gift/show?p=${rawParam}`,
    }))
  })

  // ══════════════════════════════════════════════════════════════════════
  // Invoice OG
  // ══════════════════════════════════════════════════════════════════════
  app.get('/og/invoice/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string }
    if (!token) return reply.status(400).send({ error: 'Missing token' })
    const locale = ogLocale(req)

    const db = getDb()
    const row = db.prepare(`
      SELECT i.invoice_no, i.amount, i.merchant, i.note, i.due_date, i.status, i.recipient_short_id,
             a.nickname AS recipient_nickname
      FROM invoice_tokens i
      LEFT JOIN accounts a ON a.short_id = i.recipient_short_id
      WHERE i.token = ?
    `).get(token) as any
    if (!row) return reply.status(404).send({ error: 'Not found' })

    const canvas = createCanvas(OG_W, OG_H)
    const ctx = canvas.getContext('2d')
    const pixelFont = "'Press Start 2P', 'DejaVu Sans', monospace"

    // Background
    ctx.fillStyle = '#0f1419'
    ctx.fillRect(0, 0, OG_W, OG_H)

    await drawBrandHeader(ctx)

    // "INVOICE" label
    ctx.fillStyle = '#d4a017'
    ctx.font = `18px ${pixelFont}`
    ctx.textAlign = 'left'
    ctx.fillText(ogT('invoice', locale), 50, 160)

    // Invoice number
    if (row.invoice_no) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.font = `14px ${pixelFont}`
      ctx.fillText(`#${row.invoice_no}`, 50, 190)
    }

    // Merchant name — large
    const merchant = row.merchant || row.recipient_nickname || 'Merchant'
    ctx.fillStyle = '#ffffff'
    ctx.font = `30px ${pixelFont}`
    const mText = merchant.length > 22 ? merchant.slice(0, 22) + '…' : merchant
    ctx.fillText(mText, 50, 260)

    // Amount — big
    ctx.fillStyle = '#22c55e'
    ctx.font = `64px ${pixelFont}`
    ctx.fillText(`${formatIusd(row.amount)}`, 50, 370)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = `20px ${pixelFont}`
    ctx.fillText('iUSD', 50, 405)

    // Status badge or due date
    if (row.status === 'paid') {
      ctx.fillStyle = '#22c55e'
      ctx.font = `18px ${pixelFont}`
      ctx.fillText('✓ PAID', 50, 460)
    } else if (row.due_date) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.font = `14px ${pixelFont}`
      ctx.fillText(`Due: ${String(row.due_date).slice(0, 10)}`, 50, 460)
    }

    // QR bottom-right
    await drawQrCorner(ctx, `${APP_URL}/invoice/${token}`)
    drawFooter(ctx)

    const buffer = canvas.toBuffer('image/png')
    reply.header('Content-Type', 'image/png')
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate'); reply.header('Pragma', 'no-cache')
    return reply.send(buffer)
  })

  // Invoice meta
  app.get('/og/invoice/:token/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string }
    const db = getDb()
    const row = db.prepare(`
      SELECT i.invoice_no, i.amount, i.merchant, i.status,
             a.nickname AS recipient_nickname
      FROM invoice_tokens i
      LEFT JOIN accounts a ON a.short_id = i.recipient_short_id
      WHERE i.token = ?
    `).get(token) as any

    const merchant = row?.merchant || row?.recipient_nickname || 'Merchant'
    const amount = formatIusd(row?.amount)
    const paid = row?.status === 'paid'
    const ogImageUrl = `${APP_URL.replace('iusd-pay.xyz', 'api.iusd-pay.xyz')}/v1/og/invoice/${token}`

    reply.header('Content-Type', 'text/html')
    return reply.send(buildOgMetaHtml({
      title: paid ? `${merchant} — Invoice Paid` : `${merchant} — Invoice`,
      description: `${amount} iUSD${row?.invoice_no ? ` · #${row.invoice_no}` : ''}`,
      image: ogImageUrl,
      url: `${APP_URL}/invoice/${token}`,
    }))
  })

  // ══════════════════════════════════════════════════════════════════════
  // Receipt OG
  // ══════════════════════════════════════════════════════════════════════
  app.get('/og/receipt/:paymentId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { paymentId } = req.params as { paymentId: string }
    if (!paymentId) return reply.status(400).send({ error: 'Missing paymentId' })
    const locale = ogLocale(req)

    const db = getDb()
    // payment_intents stores the id in plain hex without the 0x prefix.
    // The URL may or may not include 0x, so normalize both sides before
    // comparing.
    const normPid = paymentId.replace(/^0x/i, '').toLowerCase()
    const row = db.prepare(`
      SELECT amount_micro, recipient_short_id, created_at
      FROM payment_intents
      WHERE lower(replace(payment_id, '0x', '')) = ?
    `).get(normPid) as any

    const canvas = createCanvas(OG_W, OG_H)
    const ctx = canvas.getContext('2d')
    const pixelFont = "'Press Start 2P', 'DejaVu Sans', monospace"

    ctx.fillStyle = '#0f1419'
    ctx.fillRect(0, 0, OG_W, OG_H)
    await drawBrandHeader(ctx)

    // "RECEIPT" label
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = `16px ${pixelFont}`
    ctx.textAlign = 'left'
    ctx.fillText(ogT('paymentReceipt', locale), 50, 160)

    // Big check badge (moved to right side so it doesn't bleed into the
    // amount visually — previous layout read as "0.0 private" on first
    // glance)
    ctx.fillStyle = '#22c55e'
    ctx.font = `22px ${pixelFont}`
    ctx.fillText(ogT('privateTag', locale), 50, 205)

    // Amount — clearly separated with its own baseline
    ctx.fillStyle = '#ffffff'
    ctx.font = `56px ${pixelFont}`
    ctx.fillText(`${formatIusd(row?.amount_micro)}`, 50, 310)
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = `18px ${pixelFont}`
    ctx.fillText('iUSD', 50, 350)

    // Date
    if (row?.created_at) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.font = `13px ${pixelFont}`
      ctx.fillText(String(row.created_at).slice(0, 10), 50, 400)
    }

    // QR
    await drawQrCorner(ctx, `${APP_URL}/receipt/${paymentId}`)
    drawFooter(ctx)

    const buffer = canvas.toBuffer('image/png')
    reply.header('Content-Type', 'image/png')
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate'); reply.header('Pragma', 'no-cache')
    return reply.send(buffer)
  })

  // Receipt meta
  app.get('/og/receipt/:paymentId/meta', async (req: FastifyRequest, reply: FastifyReply) => {
    const { paymentId } = req.params as { paymentId: string }
    const locale = ogLocale(req)
    const db = getDb()
    const normPid = paymentId.replace(/^0x/i, '').toLowerCase()
    const row = db.prepare(
      `SELECT amount_micro FROM payment_intents
        WHERE lower(replace(payment_id, '0x', '')) = ?`
    ).get(normPid) as any
    const amount = formatIusd(row?.amount_micro)
    const ogImageUrl = `${APP_URL.replace('iusd-pay.xyz', 'api.iusd-pay.xyz')}/v1/og/receipt/${paymentId}`

    reply.header('Content-Type', 'text/html')
    return reply.send(buildOgMetaHtml({
      title: ogT('receiptTitle', locale, { amount }),
      description: ogT('receiptDesc', locale),
      image: ogImageUrl,
      url: `${APP_URL}/receipt/${paymentId}`,
    }))
  })
}
