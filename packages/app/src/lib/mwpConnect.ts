/**
 * Mobile Wallet Protocol (MWP) Connect — Privy Style
 * 
 * 实现 Privy 的顺滑钱包连接体验：
 * 1. 生成请求 + 回调 URL
 * 2. 打开钱包 app
 * 3. 钱包处理请求
 * 4. 钱包通过 Universal Link 返回数据
 * 5. 页面解析响应，完成连接
 */

// Session storage key for pending connection
const MWP_PENDING_KEY = 'ipay_mwp_pending'
const MWP_SESSION_KEY = 'ipay_mwp_session'

export interface MWPPendingSession {
  wallet: string
  requestId: string
  timestamp: number
}

export interface MWPConnectedSession {
  wallet: string
  address: string
  chainId: number
  connectedAt: number
}

// Wallet deep link configurations
const WALLET_SCHEMES: Record<string, {
  // Connect request deep link
  connect: (params: { requestId: string; returnUrl: string }) => string
  // Sign request deep link  
  sign: (params: { requestId: string; message: string; address: string; returnUrl: string }) => string
}> = {
  metamask: {
    connect: ({ requestId, returnUrl }) => 
      `https://metamask.app.link/dapp/${new URL(returnUrl).host}?request=${requestId}`,
    sign: ({ message, address, returnUrl }) =>
      `metamask://sign?message=${encodeURIComponent(message)}&address=${address}&redirect=${encodeURIComponent(returnUrl)}`,
  },
  rabby: {
    connect: ({ returnUrl }) => 
      `https://rabby.io/dapp?url=${encodeURIComponent(returnUrl)}`,
    sign: ({ message, address, returnUrl }) =>
      `rabby://sign?message=${encodeURIComponent(message)}&address=${address}&callback=${encodeURIComponent(returnUrl)}`,
  },
  phantom: {
    connect: ({ returnUrl }) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(returnUrl)}`,
    sign: ({ message, returnUrl }) =>
      `phantom://v1/signMessage?message=${encodeURIComponent(message)}&redirect_url=${encodeURIComponent(returnUrl)}`,
  },
  trust: {
    connect: ({ returnUrl }) =>
      `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(returnUrl)}`,
    sign: ({ message, returnUrl }) =>
      `trust://sign?message=${encodeURIComponent(message)}&callback=${encodeURIComponent(returnUrl)}`,
  },
  coinbase: {
    // Coinbase supports true MWP!
    connect: ({ requestId, returnUrl }) =>
      `https://go.cb-w.com/wsegue?requestId=${requestId}&returnUrl=${encodeURIComponent(returnUrl)}`,
    sign: ({ requestId, message, returnUrl }) =>
      `cbwallet://wsegue?requestId=${requestId}&message=${encodeURIComponent(message)}&returnUrl=${encodeURIComponent(returnUrl)}`,
  },
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `mwp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Get the callback URL for the current page
 */
function getCallbackUrl(requestId: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('mwp_request', requestId)
  url.searchParams.set('mwp_callback', '1')
  return url.toString()
}

/**
 * Start a wallet connection
 */
export function startConnect(wallet: string): void {
  const scheme = WALLET_SCHEMES[wallet]
  if (!scheme) {
    console.error('[MWP] Unsupported wallet:', wallet)
    return
  }

  const requestId = generateRequestId()
  const returnUrl = getCallbackUrl(requestId)

  // Store pending session
  const pending: MWPPendingSession = {
    wallet,
    requestId,
    timestamp: Date.now(),
  }
  sessionStorage.setItem(MWP_PENDING_KEY, JSON.stringify(pending))

  console.log('[MWP] ═══════════════════════════════════════')
  console.log('[MWP] Starting connect for wallet:', wallet)
  console.log('[MWP] Request ID:', requestId)
  console.log('[MWP] Return URL:', returnUrl)

  // Open wallet
  const deepLink = scheme.connect({ requestId, returnUrl })
  console.log('[MWP] Deep link:', deepLink)
  
  window.location.href = deepLink
}

/**
 * Check if we're returning from a wallet connection
 */
export function checkCallback(): { 
  isCallback: boolean
  address?: string
  error?: string
} {
  const url = new URL(window.location.href)
  const isCallback = url.searchParams.get('mwp_callback') === '1'
  
  if (!isCallback) {
    return { isCallback: false }
  }

  console.log('[MWP] ═══════════════════════════════════════')
  console.log('[MWP] Callback detected!')
  console.log('[MWP] URL params:', Object.fromEntries(url.searchParams))

  // Get response data from URL params
  const address = url.searchParams.get('address') || url.searchParams.get('account')
  const error = url.searchParams.get('error') || url.searchParams.get('errorMessage')
  const requestId = url.searchParams.get('mwp_request')

  // Verify request ID matches
  const pendingRaw = sessionStorage.getItem(MWP_PENDING_KEY)
  if (pendingRaw) {
    const pending = JSON.parse(pendingRaw) as MWPPendingSession
    if (pending.requestId !== requestId) {
      console.warn('[MWP] Request ID mismatch')
    }
    sessionStorage.removeItem(MWP_PENDING_KEY)
  }

  // Clean URL (remove callback params)
  url.searchParams.delete('mwp_callback')
  url.searchParams.delete('mwp_request')
  url.searchParams.delete('address')
  url.searchParams.delete('account')
  url.searchParams.delete('error')
  url.searchParams.delete('errorMessage')
  window.history.replaceState({}, '', url.toString())

  if (error) {
    console.error('[MWP] Connection error:', error)
    return { isCallback: true, error }
  }

  if (address) {
    console.log('[MWP] Connected address:', address)
    
    // Store session
    const session: MWPConnectedSession = {
      wallet: pendingRaw ? JSON.parse(pendingRaw).wallet : 'unknown',
      address,
      chainId: 1, // Default to Ethereum
      connectedAt: Date.now(),
    }
    localStorage.setItem(MWP_SESSION_KEY, JSON.stringify(session))
    
    return { isCallback: true, address }
  }

  // No address in callback - user might have returned without connecting
  return { isCallback: true, error: 'No address returned' }
}

/**
 * Get stored session
 */
export function getSession(): MWPConnectedSession | null {
  const raw = localStorage.getItem(MWP_SESSION_KEY)
  if (!raw) return null
  
  try {
    const session = JSON.parse(raw) as MWPConnectedSession
    // Session valid for 24 hours
    if (Date.now() - session.connectedAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(MWP_SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

/**
 * Clear session
 */
export function clearSession(): void {
  localStorage.removeItem(MWP_SESSION_KEY)
  sessionStorage.removeItem(MWP_PENDING_KEY)
}

/**
 * Check if wallet supports MWP-style connection
 */
export function supportsDirectConnect(wallet: string): boolean {
  return wallet in WALLET_SCHEMES
}
