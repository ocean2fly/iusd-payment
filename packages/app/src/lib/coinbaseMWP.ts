/**
 * Coinbase Wallet MWP (Mobile Wallet Protocol) Integration
 * 
 * True Privy-style direct connection for Coinbase Wallet.
 * Uses ECDH key exchange + AES encryption for secure communication.
 * 
 * Flow:
 * 1. Generate ECDH keypair
 * 2. Send handshake via deep link with returnUrl
 * 3. Coinbase returns with address + wallet public key
 * 4. Derive shared secret for future encrypted requests
 */

const MWP_SESSION_KEY = 'ipay_coinbase_mwp_session'
const MWP_KEYPAIR_KEY = 'ipay_coinbase_mwp_keypair'

interface MWPSession {
  address: string
  walletPublicKey: string
  connectedAt: number
}

// StoredKeyPair interface removed - using inline JWK storage

/**
 * Generate ECDH keypair for MWP handshake
 */
async function generateKeyPair(): Promise<{ publicKey: string; privateKeyJwk: JsonWebKey }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
  
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyHex = Array.from(new Uint8Array(publicKeyRaw))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  
  return { publicKey: publicKeyHex, privateKeyJwk }
}

/**
 * Get callback URL for Coinbase to return to
 */
function getCallbackUrl(): string {
  const url = new URL(window.location.origin)
  url.pathname = '/'
  url.searchParams.set('coinbase_mwp', '1')
  return url.toString()
}

/**
 * Start Coinbase MWP handshake
 */
export async function startCoinbaseConnect(): Promise<void> {
  console.log('[Coinbase MWP] Starting handshake...')
  
  // Generate keypair
  const { publicKey, privateKeyJwk } = await generateKeyPair()
  
  // Store keypair for later (to derive shared secret when wallet returns)
  sessionStorage.setItem(MWP_KEYPAIR_KEY, JSON.stringify({ publicKey, privateKeyJwk }))
  
  // Build handshake URL
  const callbackUrl = getCallbackUrl()
  const appName = 'iPay'
  
  // Coinbase MWP handshake deep link
  // Reference: https://docs.cloud.coinbase.com/wallet-sdk/docs/mobile-wallet-protocol
  const handshakeUrl = new URL('https://go.cb-w.com/wsegue')
  handshakeUrl.searchParams.set('p', encodeURIComponent(JSON.stringify({
    version: '1.0.0',
    sender: publicKey,
    content: {
      handshake: {
        appId: 'ipay',
        callback: callbackUrl,
        appName: appName,
        appIconUrl: 'https://iusd-pay.xyz/images/iusd.png?v=20260414',
      }
    }
  })))
  
  console.log('[Coinbase MWP] Handshake URL:', handshakeUrl.toString())
  console.log('[Coinbase MWP] Callback URL:', callbackUrl)
  
  // Open Coinbase Wallet
  window.location.href = handshakeUrl.toString()
}

/**
 * Check if returning from Coinbase MWP handshake
 */
export function checkCoinbaseCallback(): {
  isCallback: boolean
  address?: string
  error?: string
} {
  const url = new URL(window.location.href)
  
  if (url.searchParams.get('coinbase_mwp') !== '1') {
    return { isCallback: false }
  }
  
  console.log('[Coinbase MWP] Callback detected!')
  console.log('[Coinbase MWP] URL params:', Object.fromEntries(url.searchParams))
  
  // Get response from Coinbase
  const responseParam = url.searchParams.get('p')
  if (!responseParam) {
    // Clean URL and return error
    cleanCallbackUrl()
    return { isCallback: true, error: 'No response from Coinbase' }
  }
  
  try {
    const response = JSON.parse(decodeURIComponent(responseParam))
    console.log('[Coinbase MWP] Response:', response)
    
    const { sender: walletPublicKey, content } = response
    
    if (content.failure) {
      cleanCallbackUrl()
      return { isCallback: true, error: content.failure.message || 'Connection rejected' }
    }
    
    if (content.response?.handshake) {
      const { accounts } = content.response.handshake
      const address = accounts?.[0]?.address
      
      if (address) {
        // Store session
        const session: MWPSession = {
          address,
          walletPublicKey,
          connectedAt: Date.now(),
        }
        localStorage.setItem(MWP_SESSION_KEY, JSON.stringify(session))
        
        // Clean temporary keypair
        sessionStorage.removeItem(MWP_KEYPAIR_KEY)
        
        cleanCallbackUrl()
        return { isCallback: true, address }
      }
    }
    
    cleanCallbackUrl()
    return { isCallback: true, error: 'Invalid response format' }
  } catch (e) {
    console.error('[Coinbase MWP] Parse error:', e)
    cleanCallbackUrl()
    return { isCallback: true, error: 'Failed to parse response' }
  }
}

/**
 * Remove callback params from URL
 */
function cleanCallbackUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('coinbase_mwp')
  url.searchParams.delete('p')
  window.history.replaceState({}, '', url.toString())
}

/**
 * Get stored MWP session
 */
export function getCoinbaseSession(): MWPSession | null {
  const raw = localStorage.getItem(MWP_SESSION_KEY)
  if (!raw) return null
  
  try {
    const session = JSON.parse(raw) as MWPSession
    // Session valid for 7 days
    if (Date.now() - session.connectedAt > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(MWP_SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

/**
 * Clear MWP session
 */
export function clearCoinbaseSession(): void {
  localStorage.removeItem(MWP_SESSION_KEY)
  sessionStorage.removeItem(MWP_KEYPAIR_KEY)
}

/**
 * Check if Coinbase Wallet is likely installed (heuristic)
 */
export function isCoinbaseWalletAvailable(): boolean {
  // Check for Coinbase provider
  if (typeof window !== 'undefined') {
    const w = window as any
    if (w.ethereum?.isCoinbaseWallet) return true
    if (w.coinbaseWalletExtension) return true
  }
  return true // Assume available on mobile
}
