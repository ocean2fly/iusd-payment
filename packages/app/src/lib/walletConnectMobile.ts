/**
 * WalletConnect Mobile Flow
 * 
 * Enables "sign and return" workflow:
 * 1. Generate WalletConnect URI
 * 2. Open wallet via deep link with WC URI
 * 3. Wallet signs, WebSocket sends result
 * 4. User returns to browser, already connected
 */

import SignClient from '@walletconnect/sign-client'
import type { WalletName } from './browserDetection'
import { getSignClientSync, getCurrentSession, hasSession } from './wcSharedClient'

// WalletConnect Project ID (get from cloud.walletconnect.com)
const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID || '3a8170812b534d0ff9d794f19a901d64'

// Initia EVM chain namespace (MiniEVM)
const INITIA_CHAIN = import.meta.env.VITE_WC_CHAIN_ID || 'eip155:2810'

/**
 * Wallets that support WalletConnect for EVM chains
 * Note: Leap mobile doesn't fully support WC v2 for custom EVM chains
 */
export const WC_SUPPORTED_WALLETS: WalletName[] = [
  'metamask', 'rabby', 'phantom', 'keplr', 'leap',
  'rainbow', 'trust', 'zerion', 'uniswap', 'oneinch', 'ledger', 'coinbase'
]

/**
 * WalletConnect deep link formats for each wallet
 */
const WC_DEEP_LINKS: Partial<Record<WalletName, (wcUri: string) => string>> = {
  metamask: (wcUri) => `metamask://wc?uri=${encodeURIComponent(wcUri)}`,
  rabby: (wcUri) => `rabby://wc?uri=${encodeURIComponent(wcUri)}`,
  phantom: (wcUri) => `phantom://wc?uri=${encodeURIComponent(wcUri)}`,
  keplr: (wcUri) => `keplrwallet://wc?uri=${encodeURIComponent(wcUri)}`,
  leap: (wcUri) => `leapcosmoswallet://wc?uri=${encodeURIComponent(wcUri)}`,
  rainbow: (wcUri) => `rainbow://wc?uri=${encodeURIComponent(wcUri)}`,
  trust: (wcUri) => `trust://wc?uri=${encodeURIComponent(wcUri)}`,
  zerion: (wcUri) => `zerion://wc?uri=${encodeURIComponent(wcUri)}`,
  uniswap: (wcUri) => `uniswap://wc?uri=${encodeURIComponent(wcUri)}`,
  oneinch: (wcUri) => `oneinch://wc?uri=${encodeURIComponent(wcUri)}`,
  ledger: (wcUri) => `ledgerlive://wc?uri=${encodeURIComponent(wcUri)}`,
  coinbase: (wcUri) => `cbwallet://wc?uri=${encodeURIComponent(wcUri)}`,
}

/**
 * Universal link fallbacks (for iOS when scheme fails)
 */
const WC_UNIVERSAL_LINKS: Partial<Record<WalletName, (wcUri: string) => string>> = {
  metamask: (wcUri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(wcUri)}`,
  rabby: (wcUri) => `https://rabby.io/wc?uri=${encodeURIComponent(wcUri)}`,
  phantom: (wcUri) => `https://phantom.app/ul/wc?uri=${encodeURIComponent(wcUri)}`,
  keplr: (wcUri) => `https://wallet.keplr.app/wc?uri=${encodeURIComponent(wcUri)}`,
  leap: (wcUri) => `https://leapwallet.io/wc?uri=${encodeURIComponent(wcUri)}`,
  rainbow: (wcUri) => `https://rainbow.me/wc?uri=${encodeURIComponent(wcUri)}`,
  trust: (wcUri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(wcUri)}`,
  zerion: (wcUri) => `https://wallet.zerion.io/wc?uri=${encodeURIComponent(wcUri)}`,
  coinbase: (wcUri) => `https://go.cb-w.com/wc?uri=${encodeURIComponent(wcUri)}`,
}

export interface MobileWalletConnectResult {
  success: boolean
  address?: string
  chainId?: string
  error?: string
}

/**
 * Connection states
 */
export type WCConnectionState = 
  | 'idle'
  | 'initializing'
  | 'generating-uri'
  | 'waiting-approval'
  | 'connected'
  | 'error'

/**
 * Callback type for connection state updates
 */
export type WCStateCallback = (state: WCConnectionState, data?: unknown) => void

// Singleton SignClient instance
let signClient: SignClient | null = null
let signClientInitPromise: Promise<SignClient> | null = null
let currentSession: any = null

/**
 * Initialize WalletConnect SignClient
 */
async function getSignClient(): Promise<SignClient> {
  if (signClient) return signClient
  if (signClientInitPromise) return signClientInitPromise
  
  signClientInitPromise = SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: 'iPay',
      description: 'Stable coin payment on Initia',
      url: 'https://iusd-pay.xyz',
      icons: ['https://iusd-pay.xyz/images/iusd.png?v=20260414'],
    },
  }).then(client => {
    signClient = client
    
    // Set up event listeners
    client.on('session_event', (event) => {
      console.log('[WC] Session event:', event)
    })
    
    client.on('session_update', ({ topic, params }) => {
      console.log('[WC] Session update:', topic, params)
    })
    
    client.on('session_delete', () => {
      console.log('[WC] Session deleted')
      currentSession = null
    })
    
    return client
  })
  
  return signClientInitPromise
}

/**
 * Pre-initialize WalletConnect client (call on page load)
 * This speeds up subsequent connect calls
 */
export function preInitWalletConnect(): void {
  if (typeof window === 'undefined') return
  // Start initialization in background, don't await
  getSignClient().catch(e => console.warn('[WC] Pre-init failed:', e))
}

/**
 * Open wallet with WalletConnect URI
 * Tries scheme first, falls back to universal link
 */
export function openWalletWithWC(wallet: WalletName, wcUri: string): void {
  const schemeBuilder = WC_DEEP_LINKS[wallet]
  const universalBuilder = WC_UNIVERSAL_LINKS[wallet]
  
  if (!schemeBuilder) {
    console.warn('[WC] No deep link config for wallet:', wallet)
    return
  }
  
  const schemeLink = schemeBuilder(wcUri)
  const universalLink = universalBuilder?.(wcUri)
  
  console.log('[WC] ═══════════════════════════════════════')
  console.log('[WC] Deep link scheme:', schemeLink.substring(0, 80) + '...')
  if (universalLink) {
    console.log('[WC] Universal link:', universalLink.substring(0, 80) + '...')
  }
  
  console.log('[WC] Opening wallet:', wallet)
  console.log('[WC] Scheme link:', schemeLink)
  
  // Try scheme first
  const start = Date.now()
  window.location.href = schemeLink
  
  // If scheme doesn't work after 800ms, try universal link
  if (universalLink) {
    setTimeout(() => {
      if (!document.hidden && Date.now() - start < 2000) {
        console.log('[WC] Trying universal link...')
        window.location.href = universalLink
      }
    }, 800)
  }
}

/**
 * Connect to wallet via WalletConnect
 * Returns a promise that resolves when the wallet approves
 */
export async function connectWithWalletConnect(
  wallet: WalletName,
  onStateChange?: WCStateCallback,
  skipDeepLink: boolean = false // If true, caller handles deep link (MWP mode)
): Promise<MobileWalletConnectResult> {
  try {
    onStateChange?.('initializing')
    const client = await getSignClient()
    
    // Create pairing and get URI
    // MINIMAL config for maximum wallet compatibility
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        eip155: {
          methods: ['personal_sign'],
          chains: ['eip155:1'], // Ethereum mainnet only
          events: ['accountsChanged'],
        },
      },
    })
    
    console.log('[WC] Session request sent with minimal config')
    
    if (!uri) {
      throw new Error('Failed to generate WalletConnect URI')
    }
    
    console.log('[WC] ═══════════════════════════════════════')
    console.log('[WC] Generated URI:', uri.substring(0, 100) + '...')
    console.log('[WC] Full URI length:', uri.length)
    console.log('[WC] Opening wallet:', wallet)
    
    // Pass URI to callback so caller can handle deep link (MWP mode)
    onStateChange?.('generating-uri', uri)
    
    // Open wallet with deep link (unless caller handles it)
    if (!skipDeepLink) {
      openWalletWithWC(wallet, uri)
    }
    
    onStateChange?.('waiting-approval')
    
    // Wait for approval (this is where WebSocket magic happens)
    // The promise will resolve when user approves in wallet
    const session = await approval()
    
    console.log('[WC] Session approved:', session)
    currentSession = session
    
    // Extract address from session
    const accounts = session.namespaces?.eip155?.accounts || []
    const firstAccount = accounts[0] // format: "eip155:7894653:0x..."
    const address = firstAccount?.split(':')[2]
    const chainId = firstAccount?.split(':').slice(0, 2).join(':')
    
    onStateChange?.('connected', { address, chainId })
    
    return {
      success: true,
      address,
      chainId,
    }
  } catch (error: any) {
    console.error('[WC] Connection failed:', error)
    onStateChange?.('error', error)
    
    return {
      success: false,
      error: error.message || 'Connection failed',
    }
  }
}

/**
 * Disconnect current session
 */
export async function disconnectWalletConnect(): Promise<void> {
  if (!signClient || !currentSession) return
  
  try {
    await signClient.disconnect({
      topic: currentSession.topic,
      reason: {
        code: 6000,
        message: 'User disconnected',
      },
    })
    currentSession = null
  } catch (e) {
    console.error('[WC] Disconnect error:', e)
  }
}

/**
 * Check if there's an active WC session
 */
export function hasActiveSession(): boolean {
  // Check local session first
  if (currentSession) return true
  
  // Check local signClient
  if (signClient) {
    const sessions = signClient.session.getAll()
    if (sessions.length > 0) {
      currentSession = sessions[sessions.length - 1]
      return true
    }
  }
  
  // Check shared signClient (from Local Proxy)
  if (hasSession()) {
    currentSession = getCurrentSession()
    return true
  }
  
  return false
}

/**
 * Get current session address
 */
export function getSessionAddress(): string | null {
  if (!currentSession) return null
  const accounts = currentSession.namespaces?.eip155?.accounts || []
  const firstAccount = accounts[0]  // format: "eip155:7894653:0x..."
  return firstAccount?.split(':')[2] || null
}

// Store the wallet name for reopening during signing
let connectedWalletName: WalletName | null = null

export function setConnectedWallet(name: WalletName) {
  connectedWalletName = name
  localStorage.setItem('ipay_wc_wallet', name)
}

function getConnectedWallet(): WalletName | null {
  if (connectedWalletName) return connectedWalletName
  const stored = localStorage.getItem('ipay_wc_wallet')
  if (stored) {
    connectedWalletName = stored as WalletName
    return connectedWalletName
  }
  return null
}

/**
 * Open wallet app for pending signing request
 * Using window.open instead of location.href to keep page alive
 */
function openWalletForSigning() {
  const wallet = getConnectedWallet()
  console.log('[WC] openWalletForSigning called, wallet:', wallet)
  
  if (!wallet) {
    console.log('[WC] No wallet name stored')
    return
  }
  
  // Use scheme links (open wallet app without leaving Safari)
  const schemeLinks: Partial<Record<WalletName, string>> = {
    metamask: 'metamask://',
    rabby: 'rabby://',
    phantom: 'phantom://',
    trust: 'trust://',
    rainbow: 'rainbow://',
    coinbase: 'cbwallet://',
    leap: 'leapcosmoswallet://',
  }
  
  const link = schemeLinks[wallet]
  
  if (link) {
    console.log('[WC] Opening wallet via scheme:', wallet, link)
    // Use window.open to avoid page navigation
    // This keeps the WebSocket connection alive!
    const w = window.open(link, '_blank')
    if (!w) {
      // Fallback: show alert to user
      alert(`Please open ${wallet} to approve the signature request`)
    }
  } else {
    alert(`Please open your wallet to approve the signature request`)
  }
}

/**
 * Sign a message using WalletConnect
 */
export async function signMessageWC(message: string): Promise<string | null> {
  console.log('[WC] signMessageWC called')
  
  // Use shared SignClient to ensure we have access to sessions from Local Proxy
  const sharedClient = getSignClientSync()
  const sharedSession = getCurrentSession()
  
  // Try local client first, then shared
  let clientToUse = signClient || sharedClient
  let sessionToUse = currentSession || sharedSession
  
  // Try to restore session if lost
  if (!sessionToUse && clientToUse) {
    const sessions = clientToUse.session.getAll()
    console.log('[WC] No session, checking stored sessions:', sessions.length)
    if (sessions.length > 0) {
      sessionToUse = sessions[sessions.length - 1]
      currentSession = sessionToUse // Update local reference
      console.log('[WC] Restored session for signing')
    }
  }
  
  if (!clientToUse || !sessionToUse) {
    console.error('[WC] No active session - client:', !!clientToUse, 'session:', !!sessionToUse)
    return null
  }
  
  const address = getSessionAddress()
  if (!address) return null
  
  try {
    // Convert message to hex for personal_sign
    const msgHex = '0x' + Array.from(new TextEncoder().encode(message))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    
    // Use the chain we actually connected to (from session namespaces)
    const connectedChains = sessionToUse.namespaces?.eip155?.chains || ['eip155:1']
    const chainToUse = connectedChains[0] || 'eip155:1'
    console.log('[WC] Signing on chain:', chainToUse)
    
    // Open wallet so user can see the signing request
    openWalletForSigning()
    
    // Use a longer timeout (5 minutes) for mobile signing
    // User might take a while to return from wallet
    const result = await clientToUse.request({
      topic: sessionToUse.topic,
      chainId: chainToUse,
      request: {
        method: 'personal_sign',
        params: [msgHex, address],
      },
    })
    
    return result as string
  } catch (e) {
    console.error('[WC] Sign error:', e)
    return null
  }
}

/**
 * Restore session from storage (called on page load)
 */
export async function restoreSession(): Promise<MobileWalletConnectResult | null> {
  try {
    const client = await getSignClient()
    const sessions = client.session.getAll()
    
    if (sessions.length > 0) {
      // Use the most recent session
      currentSession = sessions[sessions.length - 1]
      const address = getSessionAddress()
      
      if (address) {
        console.log('[WC] Restored session for:', address)
        return {
          success: true,
          address,
          chainId: INITIA_CHAIN,
        }
      }
    }
    
    return null
  } catch (e) {
    console.error('[WC] Restore session error:', e)
    return null
  }
}
