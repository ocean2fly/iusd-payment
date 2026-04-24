/**
 * Mobile Wallet Protocol (MWP) — iPay Implementation
 * 
 * Simplified to support only MetaMask and Phantom
 * Other wallets: Users copy URL and paste in wallet browser
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SupportedWallet = 'metamask' | 'phantom'

export interface WalletConfig {
  name: string
  icon: string
  scheme: string
  wcScheme: string
  universalLink: string
}

// ── Wallet Configs ────────────────────────────────────────────────────────────

export const WALLET_CONFIGS: Record<SupportedWallet, WalletConfig> = {
  metamask: {
    name: 'MetaMask',
    icon: '/images/metamask.svg',
    scheme: 'metamask://',
    wcScheme: 'metamask://wc?uri=',
    universalLink: 'https://metamask.app.link/dapp/',
  },
  phantom: {
    name: 'Phantom',
    icon: '/images/phantom.webp',
    scheme: 'phantom://',
    wcScheme: 'phantom://wc?uri=',
    universalLink: 'https://phantom.app/ul/browse/',
  },
}

// ── Open Wallet ───────────────────────────────────────────────────────────────

/**
 * Open wallet app with current URL
 */
export function openInWalletBrowser(wallet: SupportedWallet): void {
  const host = window.location.host
  const path = window.location.pathname
  const currentUrl = window.location.href
  
  let link: string
  
  switch (wallet) {
    case 'metamask':
      link = `metamask://dapp/${host}${path}`
      break
    case 'phantom':
      link = `https://phantom.app/ul/browse/${encodeURIComponent(currentUrl)}`
      break
  }
  
  window.location.href = link
}

// ── Detect Wallet Browser ─────────────────────────────────────────────────────

/**
 * Detect if running inside a wallet's embedded browser
 */
export function detectWalletBrowser(): SupportedWallet | null {
  const ua = navigator.userAgent.toLowerCase()
  
  if (ua.includes('metamask')) return 'metamask'
  if (ua.includes('phantom')) return 'phantom'
  
  // Check for injected providers
  if (typeof window !== 'undefined') {
    const w = window as any
    if (w.ethereum?.isMetaMask) return 'metamask'
    if (w.phantom?.ethereum) return 'phantom'
  }
  
  return null
}
