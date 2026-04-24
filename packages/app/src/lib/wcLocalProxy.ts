/**
 * WalletConnect Local Proxy
 *
 * Instead of relying on WebSocket staying connected,
 * we poll for session approval. This works even when
 * iOS suspends Safari and WebSocket disconnects.
 *
 * This is the "local proxy" approach - same logic as server proxy,
 * but runs entirely in the browser.
 */

import SignClient from '@walletconnect/sign-client'
import { getSharedSignClient } from './wcSharedClient'
import { WALLET_CONFIGS } from './mobileWalletProtocol'
const PENDING_CONNECTION_KEY = 'ipay_wc_local_proxy'
const POLL_INTERVAL = 1000 // Check every 1 second
const MAX_POLL_TIME = 5 * 60 * 1000 // 5 minutes max

interface PendingConnection {
  pairingTopic: string
  uri: string
  wallet: string
  startedAt: number
}

let pollInterval: ReturnType<typeof setInterval> | null = null

/**
 * Store pending connection
 */
function storePending(data: PendingConnection): void {
  localStorage.setItem(PENDING_CONNECTION_KEY, JSON.stringify(data))
}

/**
 * Get pending connection
 */
export function getPending(): PendingConnection | null {
  const raw = localStorage.getItem(PENDING_CONNECTION_KEY)
  if (!raw) return null

  try {
    const data = JSON.parse(raw) as PendingConnection
    // Expire after MAX_POLL_TIME
    if (Date.now() - data.startedAt > MAX_POLL_TIME) {
      clearPending()
      return null
    }
    return data
  } catch {
    return null
  }
}

/**
 * Clear pending connection
 */
function clearPending(): void {
  localStorage.removeItem(PENDING_CONNECTION_KEY)
  stopPolling()
}

/**
 * Stop polling
 */
function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

/**
 * Check if a session was approved for our pending pairing
 */
async function checkForSession(client: SignClient, pairingTopic: string): Promise<string | null> {
  const sessions = client.session.getAll()
  console.log('[LocalProxy] All sessions:', sessions.length)

  for (const session of sessions) {
    console.log('[LocalProxy] Session:', {
      topic: session.topic,
      pairingTopic: session.pairingTopic,
      namespaces: session.namespaces,
    })
    if (session.pairingTopic === pairingTopic) {
      // Found matching session!
      const accounts = session.namespaces?.eip155?.accounts || []
      const firstAccount = accounts[0] // format: "eip155:1:0x..."
      const address = firstAccount?.split(':')[2]
      console.log('[LocalProxy] Found matching session! Address:', address)
      return address || null
    }
  }

  console.log('[LocalProxy] No matching session for pairing:', pairingTopic)
  return null
}

/**
 * Start polling for session approval
 */
function startPolling(
  client: SignClient,
  pairingTopic: string,
  onSuccess: (address: string) => void,
  onTimeout: () => void
): void {
  const pending = getPending()
  if (!pending) return

  console.log('[LocalProxy] Starting poll for session approval...')

  pollInterval = setInterval(async () => {
    const elapsed = Date.now() - pending.startedAt

    // Check timeout
    if (elapsed > MAX_POLL_TIME) {
      console.log('[LocalProxy] Polling timeout')
      stopPolling()
      clearPending()
      onTimeout()
      return
    }

    // Check for session
    const address = await checkForSession(client, pairingTopic)
    if (address) {
      console.log('[LocalProxy] Session found! Address:', address)
      stopPolling()
      clearPending()
      onSuccess(address)
    } else {
      console.log(`[LocalProxy] Polling... (${Math.floor(elapsed / 1000)}s)`)
    }
  }, POLL_INTERVAL)
}

/**
 * Build wallet deep link for WC URI
 */
function buildDeepLink(wallet: string, wcUri: string): string {
  const config = WALLET_CONFIGS[wallet as keyof typeof WALLET_CONFIGS]
  if (!config?.wcScheme) {
    // Fallback to generic WC link
    return `https://link.wc.com/wc?uri=${encodeURIComponent(wcUri)}`
  }

  // Build deep link: scheme + encoded URI
  return `${config.wcScheme}${encodeURIComponent(wcUri)}`
}

/**
 * Main connect function - Local Proxy approach
 */
export async function connectWithLocalProxy(
  wallet: string,
  onProgress: (status: string) => void,
  onSuccess: (address: string) => void,
  onError: (error: string) => void
): Promise<void> {
  try {
    onProgress('Initializing...')
    const client = await getSharedSignClient()

    onProgress('Creating connection...')

    // Create WC connection
    const { uri, approval } = await client.connect({
      requiredNamespaces: {
        eip155: {
          methods: ['personal_sign', 'eth_sendTransaction'],
          chains: ['eip155:1'], // Ethereum mainnet for compatibility
          events: ['accountsChanged', 'chainChanged'],
        },
      },
    })

    if (!uri) {
      throw new Error('Failed to generate connection URI')
    }

    // Extract pairing topic
    const pairingTopic = uri.split('@')[0].replace('wc:', '')
    console.log('[LocalProxy] Generated URI, pairing topic:', pairingTopic)

    // Store pending connection
    storePending({
      pairingTopic,
      uri,
      wallet,
      startedAt: Date.now(),
    })

    onProgress('Opening wallet...')

    // Start polling BEFORE opening wallet
    // This way we're already checking when user returns
    startPolling(
      client,
      pairingTopic,
      onSuccess,
      () => onError('Connection timeout. Please try again.')
    )

    // Also listen to WebSocket approval (if it stays connected)
    approval()
      .then((session) => {
        console.log('[LocalProxy] WebSocket approval received!')
        stopPolling()
        clearPending()
        const accounts = session.namespaces?.eip155?.accounts || []
        const address = accounts[0]?.split(':')[2]
        if (address) {
          onSuccess(address)
        }
      })
      .catch((e) => {
        // WebSocket might disconnect, but polling will continue
        console.log('[LocalProxy] WebSocket approval failed (polling continues):', e.message)
      })

    // Open wallet via deep link
    const deepLink = buildDeepLink(wallet, uri)
    console.log('[LocalProxy] Opening deep link:', deepLink)
    console.log('[LocalProxy] Stored pending connection:', {
      pairingTopic,
      wallet,
      startedAt: Date.now(),
    })

    // Small delay before opening to ensure storage is complete
    await new Promise(r => setTimeout(r, 100))
    window.location.href = deepLink

  } catch (e: any) {
    console.error('[LocalProxy] Error:', e)
    onError(e.message || 'Connection failed')
  }
}

/**
 * Resume polling when page becomes visible again
 * Call this on page load and visibility change
 */
export async function resumePollingIfNeeded(
  onSuccess: (address: string) => void,
  onTimeout: () => void
): Promise<boolean> {
  const pending = getPending()
  if (!pending) {
    console.log('[LocalProxy] No pending connection found')
    return false
  }

  console.log('[LocalProxy] Found pending connection, resuming poll...', {
    pairingTopic: pending.pairingTopic,
    wallet: pending.wallet,
    elapsed: Date.now() - pending.startedAt,
  })

  try {
    const client = await getSharedSignClient()

    // First check if session already exists
    const address = await checkForSession(client, pending.pairingTopic)
    if (address) {
      console.log('[LocalProxy] Session already approved! Address:', address)
      clearPending()
      onSuccess(address)
      return true
    }

    // Resume polling
    startPolling(client, pending.pairingTopic, onSuccess, onTimeout)
    return true
  } catch (e) {
    console.error('[LocalProxy] Resume error:', e)
    return false
  }
}

/**
 * Cancel pending connection
 */
export function cancelConnection(): void {
  clearPending()
}

/**
 * Check if there's a pending connection
 */
export function hasPendingConnection(): boolean {
  return getPending() !== null
}
