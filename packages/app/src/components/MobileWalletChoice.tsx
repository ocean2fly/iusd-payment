/**
 * Mobile Wallet Choice Dialog
 * 
 * Based on Privy's MWP (Mobile Wallet Protocol) approach:
 * - "Open in wallet" → Universal link to wallet's embedded browser
 * - "Sign and return" → WalletConnect URI via wallet's deep link (faster than QR)
 * 
 * Supported: MetaMask, Keplr, Rabby, Leap, Phantom
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { 
  WALLET_CONFIGS, 
  openInWalletBrowser,
  type SupportedWallet,
} from '../lib/mobileWalletProtocol'
import { type WCConnectionState } from '../lib/walletConnectMobile'
import { connectViaBackend } from '../lib/wcBackendProxy'
import { type WalletName, MOBILE_WALLET_LINKS } from '../lib/browserDetection'

interface MobileWalletChoiceProps {
  wallet: WalletName
  onClose: () => void
  onConnected: (address: string) => void
}

export function MobileWalletChoice({
  wallet,
  onClose,
  onConnected,
}: MobileWalletChoiceProps) {
  const { t } = useTranslation()
  const STATE_LABELS: Record<WCConnectionState, string> = {
    idle: '',
    initializing: t('components.mwc.state.initializing'),
    'generating-uri': t('components.mwc.state.generatingUri'),
    'waiting-approval': t('components.mwc.state.waitingApproval'),
    connected: t('components.mwc.state.connected'),
    error: t('components.mwc.state.failed'),
  }
  const [state, setState] = useState<WCConnectionState>('idle')
  const [error, setError] = useState<string | null>(null)
  
  // Get config (use MOBILE_WALLET_LINKS for icons, WALLET_CONFIGS for MWP)
  const linkConfig = MOBILE_WALLET_LINKS[wallet]
  const mwpConfig = WALLET_CONFIGS[wallet as SupportedWallet]
  
  if (!linkConfig) return null

  const isLoading = ['initializing', 'generating-uri', 'waiting-approval'].includes(state)

  // Option 1: Open in wallet's embedded browser (recommended)
  const handleOpenInWallet = useCallback(() => {
    if (mwpConfig) {
      openInWalletBrowser(wallet as SupportedWallet)
    } else {
      // Fallback to basic link
      window.location.href = linkConfig.link
    }
    onClose()
  }, [wallet, mwpConfig, linkConfig, onClose])

  // Option 2: Sign and return via WalletConnect + Backend Proxy
  // Backend maintains WebSocket, we poll for results (Privy-style!)
  const handleSignAndReturn = useCallback(async () => {
    setError(null)
    setState('initializing')
    
    const result = await connectViaBackend(
      wallet,
      (status) => {
        console.log('[BackendProxy] Status:', status)
        if (status.includes('Creating')) setState('generating-uri')
        else if (status.includes('Opening')) setState('waiting-approval')
        else if (status.includes('Waiting')) setState('waiting-approval')
      },
      (deepLink) => {
        // Open wallet via deep link
        console.log('[BackendProxy] Opening wallet:', deepLink)
        window.location.href = deepLink
      }
    )
    
    if (result.success && result.address) {
      console.log('[BackendProxy] Success! Address:', result.address)
      onConnected(result.address)
      onClose()
    } else {
      console.error('[BackendProxy] Error:', result.error)
      setError(result.error || t('components.mwc.connectionFailed'))
      setState('error')
    }
  }, [wallet, onConnected, onClose])

  // Reset state when dialog opens
  useEffect(() => {
    setState('idle')
    setError(null)
  }, [wallet])

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      onClick={isLoading ? undefined : onClose}
    >
      <div 
        className="w-full max-w-sm rounded-2xl p-6 relative"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        {!isLoading && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-white/30 hover:text-white/60 hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <img 
            src={linkConfig.icon} 
            alt={linkConfig.name} 
            className="w-12 h-12 rounded-xl object-cover"
          />
          <div>
            <h3 className="text-lg font-medium text-white">{linkConfig.name}</h3>
            <p className="text-xs text-white/50">{t('components.mwc.chooseMethod')}</p>
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="py-8 flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-emerald-500" size={32} />
            <p className="text-sm text-white/70">{STATE_LABELS[state]}</p>
            <p className="text-xs text-white/40">
              {state === 'waiting-approval'
                ? t('components.mwc.approveRequest')
                : t('components.mwc.checkWallet')}
            </p>
            {state === 'waiting-approval' && (
              <p className="text-[10px] text-amber-400/80 text-center px-4">
                {t('components.mwc.returnAfterApprove')}
              </p>
            )}
            <button
              onClick={() => { setState('idle'); setError(null) }}
              className="text-xs text-white/40 hover:text-white/60 mt-2"
            >
              {t('components.mwc.cancel')}
            </button>
          </div>
        )}

        {/* Error message */}
        {error && !isLoading && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/30">
            <p className="text-xs text-[var(--error)]">{error}</p>
            <button
              onClick={() => { setState('idle'); setError(null) }}
              className="mt-2 text-xs text-white/50 hover:text-white/70"
            >
              {t('components.mwc.tryAgain')}
            </button>
          </div>
        )}

        {/* Options */}
        {!isLoading && (
          <div className="space-y-3">
            {/* Option 1: Open in wallet browser — RECOMMENDED */}
            <button
              onClick={handleOpenInWallet}
              className="w-full flex items-start gap-3 p-4 rounded-xl transition-all hover:scale-[1.02]"
              style={{ 
                background: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0.1) 100%)', 
                border: '1px solid rgba(16,185,129,0.4)' 
              }}
            >
              <span className="text-2xl mt-0.5">🌐</span>
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white text-sm">{t('components.mwc.openInWallet')}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/40 text-emerald-200 font-bold">{t('components.mwc.best')}</span>
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  {t('components.mwc.continueInBrowser', { name: linkConfig.name })}
                </div>
              </div>
              <span className="text-emerald-400 mt-1 text-lg">→</span>
            </button>

            {/* Option 2: Sign and return via MWP/WC deep link */}
            <button
              onClick={handleSignAndReturn}
              className="w-full flex items-start gap-3 p-4 rounded-xl transition-all hover:bg-white/5"
              style={{ 
                background: 'var(--bg-elevated)', 
                border: '1px solid var(--border)' 
              }}
            >
              <span className="text-2xl mt-0.5">🔗</span>
              <div className="flex-1 text-left">
                <div className="font-medium text-white/80 text-sm">
                  {t('components.mwc.signAndReturn')}
                </div>
                <div className="text-xs text-white/40 mt-0.5">
                  {t('components.mwc.approveAndReturn')}
                </div>
              </div>
              <span className="text-white/30 mt-1 text-lg">→</span>
            </button>
          </div>
        )}

        {/* Footer */}
        {!isLoading && (
          <p className="mt-5 text-center text-[10px] text-white/25">
            {t('components.mwc.directConnection')}
          </p>
        )}
      </div>
    </div>
  )
}
