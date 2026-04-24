/**
 * Cloudflare Worker: OG preview for shareable iUSD Pay links
 *
 * Bots → OG HTML from API (dynamic PNG + meta tags); Humans → pass through to SPA
 *
 * Routes:
 *   /pay/:id           → /v1/og/pay/:id
 *   /claim/:id         → /v1/og/pay/:id (legacy)
 *   /g/:code           → /v1/og/gift/:code/meta (mystery box OR shared reveal)
 *   /gift/claim?p=...  → /v1/og/gift/:p/shared/meta (post-claim share)
 *   /profile/:id       → /v1/og/profile/:id/meta
 *   /invoice/:token    → /v1/og/invoice/:token/meta
 *   /receipt/:id       → /v1/og/receipt/:id/meta
 *   /app/send          → static payment-request OG
 */

const BOT_PATTERNS = [
  'slackbot', 'facebookexternalhit', 'facebot', 'twitterbot',
  'whatsapp', 'telegrambot', 'linkedinbot', 'discordbot',
  'applebot', 'googlebot', 'bingbot', 'pinterest',
  'imessagepreview', 'imessage', 'unfurling',
]

const API = 'https://api.iusd-pay.xyz/v1'

// Minimal i18n table for the /app/send OG card. Other OG endpoints are
// served by the API — see packages/api/src/routes/og.ts — which will
// eventually honor Accept-Language there.
const OG_PR_I18N = {
  'en':    { title: 'iUSD Payment Request',     desc: 'Someone sent you a payment request via iUSD Pay',                 foot: 'Payment Request · Powered by iUSD Pay',    click: 'Click here if not redirected' },
  'zh-CN': { title: 'iUSD 付款请求',             desc: '有人通过 iUSD Pay 向您发起付款请求',                              foot: '付款请求 · iUSD Pay',                        click: '点此跳转' },
  'zh-TW': { title: 'iUSD 付款請求',             desc: '有人透過 iUSD Pay 向您發起付款請求',                              foot: '付款請求 · iUSD Pay',                        click: '點此跳轉' },
  'ja':    { title: 'iUSD 支払いリクエスト',      desc: 'iUSD Pay 経由で支払いリクエストが届きました',                      foot: '支払いリクエスト · iUSD Pay',                 click: 'リダイレクトされない場合はこちら' },
  'ko':    { title: 'iUSD 결제 요청',            desc: '누군가 iUSD Pay를 통해 결제를 요청했습니다',                        foot: '결제 요청 · iUSD Pay',                       click: '리다이렉트되지 않으면 클릭' },
  'th':    { title: 'คำขอชำระเงิน iUSD',          desc: 'มีคนส่งคำขอชำระเงินให้คุณผ่าน iUSD Pay',                           foot: 'คำขอชำระเงิน · iUSD Pay',                    click: 'คลิกที่นี่หากไม่รีไดเรกต์' },
  'es':    { title: 'Solicitud de pago iUSD',    desc: 'Alguien te envió una solicitud de pago a través de iUSD Pay',     foot: 'Solicitud de pago · iUSD Pay',               click: 'Haz clic aquí si no te redirige' },
  'it':    { title: 'Richiesta di pagamento iUSD', desc: 'Qualcuno ti ha inviato una richiesta di pagamento via iUSD Pay', foot: 'Richiesta di pagamento · iUSD Pay',          click: 'Clicca qui se non vieni reindirizzato' },
  'fr':    { title: 'Demande de paiement iUSD',  desc: 'Quelqu\'un vous a envoyé une demande de paiement via iUSD Pay',   foot: 'Demande de paiement · iUSD Pay',             click: 'Cliquez ici si la redirection échoue' },
  'de':    { title: 'iUSD-Zahlungsanfrage',      desc: 'Jemand hat dir über iUSD Pay eine Zahlungsanfrage gesendet',      foot: 'Zahlungsanfrage · iUSD Pay',                 click: 'Klicke hier, falls keine Weiterleitung erfolgt' },
  'pt':    { title: 'Solicitação de pagamento iUSD', desc: 'Alguém enviou uma solicitação de pagamento via iUSD Pay',     foot: 'Solicitação de pagamento · iUSD Pay',        click: 'Clique aqui se não redirecionar' },
  'hi':    { title: 'iUSD भुगतान अनुरोध',          desc: 'किसी ने iUSD Pay के माध्यम से आपको भुगतान अनुरोध भेजा',              foot: 'भुगतान अनुरोध · iUSD Pay',                  click: 'रीडायरेक्ट न होने पर यहाँ क्लिक करें' },
  'ar':    { title: 'طلب دفع iUSD',              desc: 'أرسل لك شخص ما طلب دفع عبر iUSD Pay',                             foot: 'طلب دفع · iUSD Pay',                         click: 'اضغط هنا إذا لم يتم التوجيه' },
  'tr':    { title: 'iUSD Ödeme Talebi',         desc: 'Biri iUSD Pay üzerinden sana bir ödeme talebi gönderdi',          foot: 'Ödeme Talebi · iUSD Pay',                    click: 'Yönlendirilmezseniz buraya tıklayın' },
  'el':    { title: 'Αίτημα πληρωμής iUSD',       desc: 'Κάποιος σας έστειλε αίτημα πληρωμής μέσω iUSD Pay',                foot: 'Αίτημα πληρωμής · iUSD Pay',                 click: 'Κλικ εδώ αν δεν γίνει ανακατεύθυνση' },
  'ru':    { title: 'Запрос платежа iUSD',       desc: 'Кто-то отправил вам запрос платежа через iUSD Pay',               foot: 'Запрос платежа · iUSD Pay',                  click: 'Нажмите здесь, если переадресация не произошла' },
  'ms':    { title: 'Permintaan Bayaran iUSD',   desc: 'Seseorang menghantar anda permintaan bayaran melalui iUSD Pay',   foot: 'Permintaan Bayaran · iUSD Pay',              click: 'Klik di sini jika tidak dialihkan' },
  'id':    { title: 'Permintaan Pembayaran iUSD', desc: 'Seseorang mengirimkan permintaan pembayaran via iUSD Pay',        foot: 'Permintaan Pembayaran · iUSD Pay',           click: 'Klik di sini jika tidak dialihkan' },
  'fil':   { title: 'Kahilingan ng Bayad iUSD',  desc: 'May nagpadala ng kahilingan ng bayad sa iyo sa iUSD Pay',          foot: 'Kahilingan ng Bayad · iUSD Pay',             click: 'I-click dito kung hindi naka-redirect' },
}

/**
 * Pick a locale for the OG preview. Priority:
 *   1. `?lng=` URL query (so senders can share localized links)
 *   2. Accept-Language header (some bots forward it)
 *   3. English fallback
 */
function pickLocale(url, request) {
  const q = url.searchParams.get('lng')
  if (q) {
    // Normalize zh-cn → zh-CN style
    const [lang, region] = q.split('-')
    const norm = region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase()
    if (OG_PR_I18N[norm]) return norm
    if (OG_PR_I18N[lang.toLowerCase()]) return lang.toLowerCase()
  }
  const al = request.headers.get('Accept-Language') || ''
  const first = al.split(',')[0]?.trim().split(';')[0]?.trim()
  if (first) {
    const [lang, region] = first.split('-')
    const norm = region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase()
    if (OG_PR_I18N[norm]) return norm
    if (OG_PR_I18N[lang.toLowerCase()]) return lang.toLowerCase()
  }
  return 'en'
}

function paymentRequestOgHtml(requestUrl, locale) {
  const s = OG_PR_I18N[locale] || OG_PR_I18N['en']
  const ogImage = 'https://iusd-pay.xyz/og-preview.png'

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${s.title}</title>
<meta property="og:title" content="${s.title}">
<meta property="og:description" content="${s.desc}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${requestUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="iUSD Pay">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${s.title}">
<meta name="twitter:description" content="${s.desc}">
<meta name="twitter:image" content="${ogImage}">
<meta http-equiv="refresh" content="0;url=${requestUrl}">
</head>
<body><p>${s.foot}</p><a href="${requestUrl}">${s.click}</a></body>
</html>`
}

async function proxyOg(apiUrl) {
  try {
    const res  = await fetch(apiUrl, { cf: { cacheEverything: false } })
    const html = await res.text()
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch {
    return null
  }
}

export default {
  async fetch(request) {
    const url  = new URL(request.url)
    const ua   = (request.headers.get('User-Agent') || '').toLowerCase()
    const isBot = BOT_PATTERNS.some(p => ua.includes(p))
    const p = url.pathname

    // /app/send?* — Payment Request OG card
    if (p === '/app/send' || p.startsWith('/app/send?')) {
      if (!isBot) return fetch(request)
      const locale = pickLocale(url, request)
      return new Response(paymentRequestOgHtml(request.url, locale), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      })
    }

    // /pay/:id — primary shareable payment link
    if (p.startsWith('/pay/')) {
      if (!isBot) return fetch(request)
      const id = p.slice('/pay/'.length)
      return (await proxyOg(`${API}/og/pay/${id}`)) || fetch(request)
    }

    // /g/:code — gift mystery box (pre-claim)
    if (p.startsWith('/g/')) {
      if (!isBot) return fetch(request)
      const code = p.slice('/g/'.length)
      return (await proxyOg(`${API}/og/gift/${code}/meta`)) || fetch(request)
    }

    // /gift/claim?p=:packetId — invitation to claim. Always render the
    // mystery-box OG: the packet may or may not be claimed yet, and we
    // must never leak the actual gift image or expose a 0.00 amount
    // when the /shared lookup can't find a claim row (the old behavior
    // would silently render "+0.00 iUSD · a gift moment on iUSD Pay").
    if (p === '/gift/claim') {
      if (!isBot) return fetch(request)
      const packetId = url.searchParams.get('p')
      if (!packetId) return fetch(request)
      return (await proxyOg(`${API}/og/gift/${packetId}/meta`)) || fetch(request)
    }

    // /gift/show?p=:packetId — explicit share / post-claim celebration.
    // This URL is only used AFTER a gift has been claimed, so the
    // /shared/meta endpoint can safely read gift_v3_claims and show the
    // revealed gift + claimer name. Senders / celebrators share this
    // URL specifically to broadcast the reveal.
    if (p === '/gift/show') {
      if (!isBot) return fetch(request)
      const packetId = url.searchParams.get('p')
      if (!packetId) return fetch(request)
      return (await proxyOg(`${API}/og/gift/${packetId}/shared/meta`)) || fetch(request)
    }

    // /profile/:shortId
    if (p.startsWith('/profile/')) {
      if (!isBot) return fetch(request)
      const id = p.slice('/profile/'.length)
      return (await proxyOg(`${API}/og/profile/${id}/meta`)) || fetch(request)
    }

    // /invoice/:token
    if (p.startsWith('/invoice/')) {
      if (!isBot) return fetch(request)
      const token = p.slice('/invoice/'.length)
      return (await proxyOg(`${API}/og/invoice/${token}/meta`)) || fetch(request)
    }

    // /receipt/:paymentId
    if (p.startsWith('/receipt/')) {
      if (!isBot) return fetch(request)
      const id = p.slice('/receipt/'.length)
      return (await proxyOg(`${API}/og/receipt/${id}/meta`)) || fetch(request)
    }

    // /claim/:id — legacy shareable link
    if (p.startsWith('/claim/')) {
      if (!isBot) return fetch(request)
      const id = p.slice('/claim/'.length)
      return (await proxyOg(`${API}/og/pay/${id}`)) || fetch(request)
    }

    return fetch(request)
  },
}
