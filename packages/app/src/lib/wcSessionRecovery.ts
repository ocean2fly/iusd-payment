/**
 * WalletConnect Session Recovery
 * 
 * The problem: When iOS suspends Safari, WebSocket disconnects.
 * But the session MIGHT have been approved on the relay!
 * 
 * Solution: After reconnecting, check for approved sessions.
 * This is likely how Privy achieves smooth connections.
 */

import SignClient from '@walletconnect/sign-client'

const PENDING_PAIRING_KEY = 'ipay_wc_pending_pairing'
const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID || '3a8170812b534d0ff9d794f19a901d64'

interface PendingPairing {
  topic: string
  uri: string
  wallet: string
  createdAt: number
}

let signClient: SignClient | null = null

/**
 * Get or create SignClient
 */
async function getClient(): Promise<SignClient> {
  if (!signClient) {
    signClient = await SignClient.init({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: 'iPay',
        description: 'iUSD Payment App',
        url: 'https://iusd-pay.xyz',
        icons: ['https://iusd-pay.xyz/images/iusd.png?v=20260414'],
      },
    })
    console.log('[WC Recovery] SignClient initialized')
  }
  return signClient
}

/**
 * Store pending pairing info before opening wallet
 */
export function storePendingPairing(topic: string, uri: string, wallet: string): void {
  const pending: PendingPairing = {
    topic,
    uri,
    wallet,
    createdAt: Date.now(),
  }
  sessionStorage.setItem(PENDING_PAIRING_KEY, JSON.stringify(pending))
  console.log('[WC Recovery] Stored pending pairing:', topic)
}

/**
 * Get pending pairing info
 */
export function getPendingPairing(): PendingPairing | null {
  const raw = sessionStorage.getItem(PENDING_PAIRING_KEY)
  if (!raw) return null
  
  try {
    const pending = JSON.parse(raw) as PendingPairing
    // Expire after 5 minutes
    if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
      sessionStorage.removeItem(PENDING_PAIRING_KEY)
      return null
    }
    return pending
  } catch {
    return null
  }
}

/**
 * Clear pending pairing
 */
export function clearPendingPairing(): void {
  sessionStorage.removeItem(PENDING_PAIRING_KEY)
}

/**
 * Check for approved sessions after page load
 * This is the KEY to Privy-like smooth experience!
 */
export async function checkForApprovedSession(): Promise<{
  found: boolean
  address?: string
  chainId?: string
}> {
  const pending = getPendingPairing()
  if (!pending) {
    console.log('[WC Recovery] No pending pairing found')
    return { found: false }
  }

  console.log('[WC Recovery] Checking for approved session, topic:', pending.topic)

  try {
    const client = await getClient()
    
    // Get all sessions
    const sessions = client.session.getAll()
    console.log('[WC Recovery] All sessions:', sessions.length)
    
    for (const session of sessions) {
      console.log('[WC Recovery] Session:', session.topic, session.namespaces)
      
      // Check if this session matches our pending pairing
      if (session.pairingTopic === pending.topic) {
        console.log('[WC Recovery] Found matching session!')
        
        // Extract address
        const accounts = session.namespaces?.eip155?.accounts || []
        const firstAccount = accounts[0] // format: "eip155:1:0x..."
        const address = firstAccount?.split(':')[2]
        const chainId = firstAccount?.split(':').slice(0, 2).join(':')
        
        if (address) {
          clearPendingPairing()
          return { found: true, address, chainId }
        }
      }
    }
    
    // Also check pending proposals
    const pendingProposals = client.proposal.getAll()
    console.log('[WC Recovery] Pending proposals:', pendingProposals.length)
    
    console.log('[WC Recovery] No matching session found')
    return { found: false }
  } catch (e) {
    console.error('[WC Recovery] Error checking sessions:', e)
    return { found: false }
  }
}

/**
 * Enhanced connect that stores pairing for recovery
 */
export async function connectWithRecovery(
  wallet: string,
  onProgress: (status: string) => void
): Promise<{ success: boolean; address?: string; error?: string }> {
  try {
    onProgress('Initializing...')
    const client = await getClient()
    
    onProgress('Creating connection...')
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        eip155: {
          methods: ['personal_sign'],
          chains: ['eip155:1'],
          events: ['accountsChanged'],
        },
      },
    })
    
    if (!uri) {
      return { success: false, error: 'Failed to generate connection URI' }
    }
    
    // Extract pairing topic from URI
    const pairingTopic = uri.split('@')[0].replace('wc:', '')
    storePendingPairing(pairingTopic, uri, wallet)
    
    console.log('[WC Recovery] URI generated, topic:', pairingTopic)
    console.log('[WC Recovery] URI:', uri.substring(0, 50) + '...')
    
    onProgress('Opening wallet...')
    
    // Return URI for caller to handle deep link
    // The approval promise will wait for WebSocket response
    // BUT if WebSocket disconnects, user can return and we'll recover via checkForApprovedSession
    
    return new Promise((resolve) => {
      // Set up approval handler
      approval()
        .then((session) => {
          console.log('[WC Recovery] Session approved via WebSocket!')
          const accounts = session.namespaces?.eip155?.accounts || []
          const address = accounts[0]?.split(':')[2]
          clearPendingPairing()
          resolve({ success: true, address })
        })
        .catch((e) => {
          console.log('[WC Recovery] Approval promise rejected:', e.message)
          // Don't resolve as error - user might still approve and we'll recover
        })
      
      // Return the URI immediately so caller can open wallet
      // The actual address will come from either:
      // 1. approval() promise (if WebSocket stays connected)
      // 2. checkForApprovedSession() (if user returns after WebSocket disconnected)
    })
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/**
 * Get the WC URI for manual deep linking
 */
export async function generateWCUri(): Promise<{
  uri: string
  pairingTopic: string
} | null> {
  try {
    const client = await getClient()
    
    const { uri } = await client.connect({
      requiredNamespaces: {
        eip155: {
          methods: ['personal_sign'],
          chains: ['eip155:1'],
          events: ['accountsChanged'],
        },
      },
    })
    
    if (!uri) return null
    
    const pairingTopic = uri.split('@')[0].replace('wc:', '')
    return { uri, pairingTopic }
  } catch {
    return null
  }
}
