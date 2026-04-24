/**
 * useAuth — single source of truth for auth state.
 *
 * State machine (linear, no concurrent branches):
 *   idle → connected → signing → checking → registered | unregistered
 *
 * The "connected" state means a wallet is linked but no session exists yet.
 * Signing must be triggered manually (via triggerSign) from a user click
 * handler so the Privy popup is not blocked by the browser.
 *
 * Uses IK offlineSigner (EIP-191) for authentication.
 * On disconnect: call handleDisconnect(address) to wipe local data.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { getSession, hasValidSession, login, clearSession } from '../services/auth'
import { getMyAccount } from '../services/account'
import { ikSign } from '../services/ikSigner'
import type { ApiAccount as Account } from '@ipay/shared'
import { setContactsToken } from '../lib/contactsStore'
import { isMobile } from '../lib/browserDetection'
import { API_BASE } from '../config'
import i18n from '../i18n'

export type AuthStatus =
  | 'idle'
  | 'connected'
  | 'signing'
  | 'checking'
  | 'registered'
  | 'unregistered'
  | 'error'

export type AuthErrorKind =
  | 'connector'
  | 'cancelled'
  | 'network'
  | 'popup'
  | 'unknown'

export interface AuthState {
  status: AuthStatus
  address: string | null
  token: string | null
  account: Account | null
  error: string | null
  /** Machine-readable category (locale-independent) for UI to react on */
  errorKind: AuthErrorKind | null
  /** IK is still restoring its session (address not yet set) */
  ikLoading: boolean
  retry: () => void
  /** Call after registration to update status without full page reload */
  refreshAccount: () => Promise<void>
  /** Manually trigger sign-in (call from a click handler to avoid popup blockers) */
  triggerSign: () => void
}

export function useAuth(): AuthState {
  const { address, offlineSigner, isLoading: ikLoading } = useInterwovenKit() as any
  const [status, setStatus] = useState<AuthStatus>('idle')
  const [token, setToken] = useState<string | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<AuthErrorKind | null>(null)
  // Unique run ID — each runAuth call gets a number; only the latest can commit state
  const runIdRef = useRef<number>(0)
  // Prefetched nonce so Sign click can skip /auth/nonce fetch and keep
  // window.open() inside ikSign in the same sync frame as the click —
  // required to preserve iOS Safari transient activation when popups are
  // set to Block (the default). Expires after 4 min to stay server-valid.
  const prefetchedNonceRef = useRef<{ nonce: string; fetchedAt: number } | null>(null)

  const signFn = useCallback(async (msg: string): Promise<string> => {
    if (!offlineSigner) throw new Error('No signer')
    // NOTE: ikSign is imported eagerly (not dynamic import) so iOS Safari's
    // transient activation isn't burned on a module fetch before window.open.
    try {
      const sig = await ikSign(offlineSigner, msg)
      if (!sig) throw new Error('Signing failed or cancelled')
      return sig
    } catch (e: any) {
      // viem's "Failed to initialize request" right after a fresh connect
      // on iOS Safari is almost always a provider-warm-up race: the
      // Web3Auth EIP-1193 transport is returned to us before its internal
      // state has fully settled. A single short delay + retry clears it in
      // practice, and avoids sending the user into a reconnect loop that
      // never resolves (because reconnecting doesn't change the race).
      // We scope the retry to this specific error so real cancels / popup
      // blocks / other failures still surface immediately.
      const errMsg: string = e?.message ?? ''
      if (/failed to initialize request/i.test(errMsg)) {
        console.warn('[ikSign] provider warm-up race, retrying after 1.5s...')
        await new Promise(r => setTimeout(r, 1500))
        const sig2 = await ikSign(offlineSigner, msg)
        if (!sig2) throw new Error('Signing failed or cancelled')
        return sig2
      }
      throw e
    }
  }, [offlineSigner])

  const runAuth = useCallback(async (addr: string) => {
    // Each call gets a unique ID — if a newer call starts, this one becomes stale
    const myRunId = ++runIdRef.current
    const stale = () => runIdRef.current !== myRunId

    setError(null)

    try {
      // 1. Get or create session
      let tok = getSession(addr)?.token ?? null
      if (!tok) {
        setStatus('signing')
        // Use a prefetched nonce if still fresh so login() can skip its
        // fetch() and call signMessage in the same sync frame as the click
        // handler (required for iOS Safari transient activation).
        const cached = prefetchedNonceRef.current
        const isFresh = cached && (Date.now() - cached.fetchedAt < 4 * 60 * 1000)
        const useNonce = isFresh ? cached!.nonce : undefined
        // Consume on attempt — a nonce is one-shot on the server side.
        prefetchedNonceRef.current = null
        tok = await login(addr, signFn, useNonce)
        if (stale()) return  // abort if a newer auth started during signing
      }

      setToken(tok)

      // 2. Check account
      setStatus('checking')
      const acct = await getMyAccount(tok)
      if (stale()) return  // abort before committing result

      if (acct) {
        setAccount(acct)
        // Wire contacts store with token + shortId so fire-and-forget upserts
        // use the public shortId as the URL key (privacy invariant).
        setContactsToken(tok, acct.shortId)
        setStatus('registered')
        // (return-path restore handled by RequireAuth in App.tsx)
      }
      else setStatus('unregistered')
    } catch (e: any) {
      if (stale()) return  // ignore errors from stale runs — don't clobber newer run's state

      // Clear stale session so next retry will re-sign
      clearSession(addr)

      const msg: string = e?.message ?? ''
      let userMsg = i18n.t('auth.signFailed')
      let kind: AuthErrorKind = 'unknown'
      // Stage-prefix detection is authoritative for the two fetch-only stages:
      // [nonce] and [verify] don't involve a wallet popup, so any failure
      // there is a network/API issue — never a popup block. Classifying them
      // as 'network' keeps the iOS Safari popup guide from misleading users
      // into tweaking browser settings that can't fix an API/CORS/TLS error.
      // The [sign] stage is the only one that can actually be popup-blocked,
      // so we let it fall through to the regex chain below.
      if (/^\[nonce\]|^\[verify\]/.test(msg)) {
        userMsg = i18n.t('auth.networkBlocked')
        kind = 'network'
      } else if (/getChainId|connector|interwoven signing failed|failed to initialize request/i.test(msg)) {
        // viem's "Failed to initialize request" and IK's "Interwoven signing
        // failed" are provider-layer failures — usually a stale Web3Auth
        // session, ITP storage partition, or expired transient activation on
        // iOS Safari. Not a browser popup-block, so we surface a Reconnect
        // action instead of the misleading settings walkthrough.
        userMsg = i18n.t('auth.connectionLost')
        kind = 'connector'
      } else if (/cancel|reject|denied/i.test(msg)) {
        userMsg = i18n.t('auth.signatureCancelled')
        kind = 'cancelled'
      } else if (/network|fetch|failed to fetch|load failed|cors|preflight/i.test(msg)) {
        userMsg = i18n.t('auth.networkBlocked')
        kind = 'network'
      } else if (/popup/i.test(msg)) {
        userMsg = isMobile()
          ? i18n.t('auth.popupBlockedMobile')
          : i18n.t('auth.popupBlockedDesktop')
        kind = 'popup'
      }
      // Diagnostic: surface the raw underlying error alongside the localized
      // fallback for ALL kinds (not just unknown), so users without a
      // Mac+cable setup can read the real failure straight from the UI and
      // report it back. Also log the full error + stack to console.
      console.error('[useAuth] Sign-in failure:', { kind, msg, err: e })
      if (msg) {
        userMsg = `${userMsg} — [${kind}] ${msg.slice(0, 200)}`
      }
      setError(userMsg)
      setErrorKind(kind)
      setStatus('error')
    }
  }, [signFn])

  useEffect(() => {
    if (!address) {
      runIdRef.current++  // cancel any in-flight auth
      setStatus('idle')
      setToken(null)
      setAccount(null)
      setError(null)
      setErrorKind(null)
      return
    }

    // Debounce: IK address can oscillate rapidly during connect/reconnect.
    // Wait 800ms for address to settle before triggering auth.
    const timer = setTimeout(() => {
      if (hasValidSession(address)) {
        // Existing session — auto-check account (no popup needed)
        const myRunId = ++runIdRef.current
        const tok = getSession(address)!.token
        setToken(tok)
        setStatus('checking')
        getMyAccount(tok)
          .then(acct => {
            if (runIdRef.current !== myRunId) return
            if (acct) {
        setAccount(acct)
        setStatus('registered')
        // (return-path restore handled by RequireAuth in App.tsx)
      }
            else setStatus('unregistered')
          })
          .catch(e => {
            if (runIdRef.current !== myRunId) return
            // Stale/invalid token (e.g. after DB reset) → clear and re-auth
            if (e.message.includes('401') || e.message.includes('403')) {
              clearSession(address)
              setToken(null)
              // Don't auto re-sign — set to 'connected' so user can click Sign in
              setStatus('connected')
            } else {
              setError(e.message)
              setStatus('error')
            }
          })
      } else {
        // No session — wait for user to click "Sign in" to avoid popup blocker
        setStatus('connected')
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch /auth/nonce in the background while the wallet is connected but
  // no session exists yet. At Sign-click time, runAuth can then skip the
  // nonce fetch — which is what burns iOS Safari's transient activation
  // window before window.open() inside ikSign can fire. See note on
  // prefetchedNonceRef above.
  useEffect(() => {
    if (status !== 'connected' || !address || token) {
      prefetchedNonceRef.current = null
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d?.nonce) {
          prefetchedNonceRef.current = { nonce: d.nonce, fetchedAt: Date.now() }
        }
      })
      .catch(() => { /* silent — runAuth will fall back to fetching */ })
    return () => { cancelled = true }
  }, [status, address, token])

  const retry = useCallback(() => {
    if (address) runAuth(address)
  }, [address, runAuth])

  const triggerSign = useCallback(() => {
    if (!address) return
    runAuth(address)
  }, [address, runAuth])

  async function refreshAccount() {
    if (!token) return
    try {
      const acct = await getMyAccount(token)
      if (acct) {
        setAccount(acct)
        setStatus('registered')
        // (return-path restore handled by RequireAuth in App.tsx)
      }
    } catch {}
  }

  return { status, address: address ?? null, token, account, error, errorKind, ikLoading: !!ikLoading, retry, refreshAccount, triggerSign }
}

export function handleDisconnect(address: string) {
  clearSession(address)
}
