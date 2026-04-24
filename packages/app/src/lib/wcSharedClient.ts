/**
 * Shared WalletConnect SignClient
 * 
 * Single instance shared across all WC functionality
 * to ensure sessions are accessible everywhere.
 */

import SignClient from '@walletconnect/sign-client'

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID || '3a8170812b534d0ff9d794f19a901d64'

let signClient: SignClient | null = null
let initPromise: Promise<SignClient> | null = null

/**
 * Get the shared SignClient instance (singleton)
 */
export async function getSharedSignClient(): Promise<SignClient> {
  if (signClient) return signClient
  
  if (initPromise) return initPromise
  
  console.log('[WC Shared] Initializing SignClient...')
  initPromise = SignClient.init({
    projectId: WC_PROJECT_ID,
    metadata: {
      name: 'iPay',
      description: 'iUSD Payment App',
      url: 'https://iusd-pay.xyz',
      icons: ['https://iusd-pay.xyz/images/iusd.png?v=20260414'],
    },
  })
  
  signClient = await initPromise
  console.log('[WC Shared] SignClient ready')
  return signClient
}

/**
 * Get SignClient if already initialized (sync check)
 */
export function getSignClientSync(): SignClient | null {
  return signClient
}

/**
 * Check if there's an active session
 */
export function hasSession(): boolean {
  if (!signClient) return false
  const sessions = signClient.session.getAll()
  return sessions.length > 0
}

/**
 * Get the most recent session
 */
export function getCurrentSession() {
  if (!signClient) return null
  const sessions = signClient.session.getAll()
  return sessions.length > 0 ? sessions[sessions.length - 1] : null
}

/**
 * Get address from current session
 */
export function getSessionAddress(): string | null {
  const session = getCurrentSession()
  if (!session) return null
  
  const accounts = session.namespaces?.eip155?.accounts || []
  const firstAccount = accounts[0] // format: "eip155:1:0x..."
  return firstAccount?.split(':')[2] || null
}
