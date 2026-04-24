/**
 * WalletConnect Backend Proxy Client
 * 
 * Instead of maintaining WebSocket on client (breaks on iOS),
 * use backend API to manage WC sessions.
 */

import { WALLET_CONFIGS, type SupportedWallet } from './mobileWalletProtocol'

import { API_BASE } from '../config'

const POLL_INTERVAL = 1000 // 1 second
const MAX_POLL_TIME = 5 * 60 * 1000 // 5 minutes

interface ConnectionResult {
  id: string
  uri: string
  expiresAt: number
}

interface ConnectionStatus {
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  address?: string
  sessionTopic?: string
}

interface SignatureResult {
  id: string
  expiresAt: number
}

interface SignatureStatus {
  status: 'pending' | 'signed' | 'rejected' | 'expired'
  signature?: string
  error?: string
}

/**
 * Create a WalletConnect connection via backend proxy
 */
async function createConnection(wallet?: string): Promise<ConnectionResult> {
  const res = await fetch(`${API_BASE}/v1/wc/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet }),
  })
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to create connection')
  }
  
  return res.json()
}

/**
 * Poll for connection status
 */
async function pollConnectionStatus(id: string): Promise<ConnectionStatus> {
  const res = await fetch(`${API_BASE}/v1/wc/connect/${id}`)
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to get connection status')
  }
  
  return res.json()
}

/**
 * Request a signature via backend proxy
 */
async function requestSignature(
  sessionTopic: string,
  message: string,
  address: string
): Promise<SignatureResult> {
  const res = await fetch(`${API_BASE}/v1/wc/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionTopic, message, address }),
  })
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to request signature')
  }
  
  return res.json()
}

/**
 * Poll for signature status
 */
async function pollSignatureStatus(id: string): Promise<SignatureStatus> {
  const res = await fetch(`${API_BASE}/v1/wc/sign/${id}`)
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to get signature status')
  }
  
  return res.json()
}

/**
 * Build wallet deep link for WC URI
 */
function buildDeepLink(wallet: string, wcUri: string): string {
  const config = WALLET_CONFIGS[wallet as SupportedWallet]
  if (!config?.wcScheme) {
    return `https://link.wc.com/wc?uri=${encodeURIComponent(wcUri)}`
  }
  return `${config.wcScheme}${encodeURIComponent(wcUri)}`
}

/**
 * Storage key for session info
 */
const SESSION_KEY = 'ipay_wc_backend_session'

interface StoredSession {
  sessionTopic: string
  address: string
  wallet: string
}

export function storeSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function getStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearStoredSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

/**
 * Connect wallet via backend proxy
 * 
 * Flow:
 * 1. Call backend to create WC connection
 * 2. Open wallet with WC URI
 * 3. Poll backend for approval status
 * 4. Return address when approved
 */
export async function connectViaBackend(
  wallet: string,
  onProgress: (status: string) => void,
  onOpenWallet: (deepLink: string) => void
): Promise<{ success: boolean; address?: string; sessionTopic?: string; error?: string }> {
  try {
    onProgress('Creating connection...')
    const { id, uri } = await createConnection(wallet)
    
    onProgress('Opening wallet...')
    const deepLink = buildDeepLink(wallet, uri)
    onOpenWallet(deepLink)
    
    onProgress('Waiting for approval...')
    const startTime = Date.now()
    
    // Poll for approval
    while (Date.now() - startTime < MAX_POLL_TIME) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      
      const status = await pollConnectionStatus(id)
      
      if (status.status === 'approved' && status.address) {
        // Store session for later signing
        storeSession({
          sessionTopic: status.sessionTopic!,
          address: status.address,
          wallet,
        })
        return { success: true, address: status.address, sessionTopic: status.sessionTopic }
      }
      
      if (status.status === 'rejected') {
        return { success: false, error: 'Connection rejected' }
      }
      
      if (status.status === 'expired') {
        return { success: false, error: 'Connection expired' }
      }
      
      onProgress(`Waiting for approval... (${Math.floor((Date.now() - startTime) / 1000)}s)`)
    }
    
    return { success: false, error: 'Connection timeout' }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/**
 * Sign a message via backend proxy
 * 
 * Flow:
 * 1. Call backend to request signature
 * 2. Open wallet (optional, might auto-receive via push)
 * 3. Poll backend for signature status
 * 4. Return signature when signed
 */
export async function signViaBackend(
  message: string,
  onProgress?: (status: string) => void,
  onOpenWallet?: (wallet: string) => void
): Promise<{ success: boolean; signature?: string; error?: string }> {
  const session = getStoredSession()
  if (!session) {
    return { success: false, error: 'No active session' }
  }
  
  try {
    onProgress?.('Requesting signature...')
    const { id } = await requestSignature(session.sessionTopic, message, session.address)
    
    // Optionally open wallet
    if (onOpenWallet) {
      onOpenWallet(session.wallet)
    }
    
    onProgress?.('Waiting for signature...')
    const startTime = Date.now()
    
    // Poll for signature
    while (Date.now() - startTime < MAX_POLL_TIME) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      
      const status = await pollSignatureStatus(id)
      
      if (status.status === 'signed' && status.signature) {
        return { success: true, signature: status.signature }
      }
      
      if (status.status === 'rejected') {
        return { success: false, error: status.error || 'Signature rejected' }
      }
      
      if (status.status === 'expired') {
        return { success: false, error: 'Signature request expired' }
      }
      
      onProgress?.(`Waiting for signature... (${Math.floor((Date.now() - startTime) / 1000)}s)`)
    }
    
    return { success: false, error: 'Signature timeout' }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/**
 * Check if we have an active backend session
 */
export function hasBackendSession(): boolean {
  return getStoredSession() !== null
}
