/**
 * Browser / device environment detection for adaptive wallet UX.
 *
 * Three environments:
 *  'desktop'              — traditional desktop browser (no touch)
 *  'mobile-wallet-browser'— inside a wallet app's embedded browser
 *  'mobile-browser'       — mobile Safari / Chrome (standalone)
 */

export type BrowserEnvironment =
  | 'desktop'
  | 'mobile-wallet-browser'
  | 'mobile-browser'

export type WalletName = 
  | 'metamask' 
  | 'keplr' 
  | 'rabby' 
  | 'phantom' 
  | 'leap'
  | 'okx'
  | 'rainbow'
  | 'trust'
  | 'zerion'
  | 'uniswap'
  | 'oneinch'
  | 'ledger'
  | 'coinbase'
  | 'other'

export interface WalletBrowserInfo {
  isWalletBrowser: boolean
  walletName?: WalletName
}

/**
 * True if the current browser can install this PWA / add to home screen.
 *
 * Apple restricts PWA install to Safari on iOS — Chrome/Firefox/Edge/Opera
 * on iOS all wrap WebKit but do NOT expose the Add-to-Home-Screen flow. So
 * showing an install prompt there just sends the user into the wrong menu.
 *
 * Rule:
 *   - iOS → must be "real" Safari (no CriOS/FxiOS/EdgiOS/OPiOS/DuckDuckGo in UA)
 *   - Android / desktop → always true (native prompt or manual menu works)
 */
export function canInstallPWA(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (iOS) {
    return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|mercury/i.test(ua)
  }
  return true
}

/** True if running on a mobile/touch device */
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  if (/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)) return true
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

/** Detect in-app wallet browsers via UA string + injected provider fallbacks */
export function detectWalletBrowser(): WalletBrowserInfo {
  if (typeof window === 'undefined') return { isWalletBrowser: false }

  const ua = window.navigator.userAgent.toLowerCase()

  // UA-string checks first (most reliable)
  if (ua.includes('okx') || ua.includes('okapp')) return { isWalletBrowser: true, walletName: 'okx' }
  if (ua.includes('metamask'))  return { isWalletBrowser: true, walletName: 'metamask' }
  if (ua.includes('keplr'))     return { isWalletBrowser: true, walletName: 'keplr' }
  if (ua.includes('rabby'))     return { isWalletBrowser: true, walletName: 'rabby' }
  if (ua.includes('phantom'))   return { isWalletBrowser: true, walletName: 'phantom' }
  if (ua.includes('leap'))      return { isWalletBrowser: true, walletName: 'leap' }
  if (ua.includes('rainbow'))   return { isWalletBrowser: true, walletName: 'rainbow' }
  if (ua.includes('trust'))     return { isWalletBrowser: true, walletName: 'trust' }
  if (ua.includes('zerion'))    return { isWalletBrowser: true, walletName: 'zerion' }
  if (ua.includes('uniswap'))   return { isWalletBrowser: true, walletName: 'uniswap' }
  if (ua.includes('1inch') || ua.includes('oneinch')) return { isWalletBrowser: true, walletName: 'oneinch' }
  if (ua.includes('ledger'))    return { isWalletBrowser: true, walletName: 'ledger' }
  if (ua.includes('coinbase') || ua.includes('cbwallet')) return { isWalletBrowser: true, walletName: 'coinbase' }

  // Injected provider checks (mobile only — desktop extensions are OK)
  if (isMobile()) {
    const w = window as any
    if (w.okxwallet) return { isWalletBrowser: true, walletName: 'okx' }
    const eth = w.ethereum
    if (eth) {
      if (eth.isOkxWallet) return { isWalletBrowser: true, walletName: 'okx' }
      if (eth.isCoinbaseWallet) return { isWalletBrowser: true, walletName: 'coinbase' }
      if (eth.isMetaMask)  return { isWalletBrowser: true, walletName: 'metamask' }
      if (eth.isRabby)     return { isWalletBrowser: true, walletName: 'rabby' }
      if (eth.isPhantom)   return { isWalletBrowser: true, walletName: 'phantom' }
      if (eth.isRainbow)   return { isWalletBrowser: true, walletName: 'rainbow' }
      if (eth.isTrust)     return { isWalletBrowser: true, walletName: 'trust' }
      if (eth.isZerion)    return { isWalletBrowser: true, walletName: 'zerion' }
    }
    if ((window as any).keplr) return { isWalletBrowser: true, walletName: 'keplr' }
    if ((window as any).leap)  return { isWalletBrowser: true, walletName: 'leap' }
  }

  return { isWalletBrowser: false }
}

// Cache result — environment doesn't change during a page session
let _cached: BrowserEnvironment | null = null

export function getBrowserEnvironment(force = false): BrowserEnvironment {
  if (!force && _cached) return _cached

  if (!isMobile()) {
    _cached = 'desktop'
    return _cached
  }

  const info = detectWalletBrowser()
  _cached = info.isWalletBrowser ? 'mobile-wallet-browser' : 'mobile-browser'
  return _cached
}

// ─── Mobile wallet universal / deep links ─────────────────────────────────

const SITE = 'https://iusd-pay.xyz'

/** Universal links and scheme deep-links for each wallet */
export const MOBILE_WALLET_LINKS: Record<WalletName, { name: string; icon: string; link: string; appStoreLink?: string }> = {
  metamask: {
    name: 'MetaMask',
    icon: '/images/metamask.svg',
    link: `https://metamask.app.link/dapp/${SITE.replace('https://', '')}`,
  },
  keplr: {
    name: 'Keplr',
    icon: '/images/keplr.svg',
    link: `https://keplrwallet.page.link/?link=${encodeURIComponent(SITE)}&apn=com.chainapsis.keplr&isi=1529798544&ibi=com.chainapsis.keplr`,
    appStoreLink: 'https://apps.apple.com/app/keplr-wallet/id1529798544',
  },
  rabby: {
    name: 'Rabby',
    icon: '/images/rabby.svg',
    link: `https://rabby.io/dapp?url=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/rabby-wallet-crypto-ethereum/id1664417584',
  },
  phantom: {
    name: 'Phantom',
    icon: '/images/phantom.webp',
    link: `https://phantom.app/ul/browse/${encodeURIComponent(SITE)}?ref=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/phantom-crypto-wallet/id1598432977',
  },
  leap: {
    name: 'Leap',
    icon: '/images/leap.svg',
    link: `https://leapwallet.io/dapp?url=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/leap-cosmos-wallet/id1642465549',
  },
  okx: {
    name: 'OKX Wallet',
    icon: '/images/okx.svg',
    link: `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/okx-buy-bitcoin-btc-crypto/id1327268470',
  },
  rainbow: {
    name: 'Rainbow',
    icon: '/images/rainbow.svg',
    link: `https://rainbow.me/dapp?url=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/rainbow-ethereum-wallet/id1457119021',
  },
  trust: {
    name: 'Trust Wallet',
    icon: '/images/trust.svg',
    link: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409',
  },
  zerion: {
    name: 'Zerion',
    icon: '/images/zerion.svg',
    link: `https://wallet.zerion.io/wc?uri=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/zerion-crypto-wallet/id1456732565',
  },
  uniswap: {
    name: 'Uniswap',
    icon: '/images/uniswap.svg',
    link: `https://uniswap.org/app?inputCurrency=ETH`,
    appStoreLink: 'https://apps.apple.com/app/uniswap-wallet/id6443944476',
  },
  oneinch: {
    name: '1inch',
    icon: '/images/1inch.svg',
    link: `https://wallet.1inch.io/wc?uri=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/1inch-crypto-defi-wallet/id1546049391',
  },
  ledger: {
    name: 'Ledger Live',
    icon: '/images/ledger.svg',
    link: `ledgerlive://wc?uri=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/ledger-live-crypto-wallet/id1361671700',
  },
  coinbase: {
    name: 'Coinbase Wallet',
    icon: '/images/coinbase.svg',
    link: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(SITE)}`,
    appStoreLink: 'https://apps.apple.com/app/coinbase-wallet-nfts-crypto/id1278383455',
  },
  other: {
    name: 'Other Wallet',
    icon: '/images/wallet-other.svg',
    link: '', // Will be handled specially - just copy URL
  },
}

/**
 * Open a wallet app deep link.
 * For custom URL schemes (leapcosmoswallet://, rabby://), try the scheme first.
 * If the app isn't installed, Safari leaves the page alone — fall back to App Store after 400ms.
 */
export function openWalletLink(wallet: WalletName): void {
  const config = MOBILE_WALLET_LINKS[wallet]
  if (!config) return

  const { link, appStoreLink } = config

  // HTTPS universal links (MetaMask, Phantom, Keplr Firebase) — browser handles redirect
  if (link.startsWith('https://')) {
    window.location.href = link
    return
  }

  // Custom scheme deep link — try it, fall back to App Store if app not installed
  const start = Date.now()
  window.location.href = link

  if (appStoreLink) {
    setTimeout(() => {
      // If the page is still visible after 400ms, the scheme wasn't handled (app not installed)
      if (!document.hidden && Date.now() - start < 2000) {
        window.location.href = appStoreLink
      }
    }, 400)
  }
}
