/**
 * InterwovenKit EIP-191 Signer
 *
 * IK-only policy:
 *   - Use offlineSigner.signMessage only
 *   - Do NOT fallback to window.ethereum / EIP-1193 provider
 *
 * Reason: avoid provider conflicts from browser extensions
 * (MetaMask/Rabby/etc overriding global window.ethereum).
 */

export async function ikSign(
  signer: unknown,
  message: string
): Promise<string | null> {
  if (!signer) {
    console.log('[ikSigner] No signer provided')
    return null
  }

  const s = signer as any

  // ── Patch missing getChainId on Privy connector ─────────────────────
  // Privy's embedded wallet connector doesn't implement getChainId,
  // causing signMessage to throw. Patch it before calling.
  try {
    const connector = s?.connector ?? s?.provider?.connector ?? s?._connector
    if (connector && typeof connector.getChainId !== 'function') {
      console.log('[ikSigner] Patching connector.getChainId for Privy...')
      connector.getChainId = () => Promise.resolve(1)
    }
  } catch {}

  // ── IK-only signing path: offlineSigner.signMessage ──────────────────
  if (typeof s.signMessage !== 'function') {
    throw new Error('Interwoven signer unavailable. Please reconnect via InterwovenKit.')
  }

  // Produce the hex-encoded signature from signMessage output (string or bytes).
  const toHex = (sig: any): string =>
    typeof sig === 'string'
      ? (sig.startsWith('0x') ? sig : `0x${sig}`)
      : '0x' + Array.from(sig as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('')

  try {
    console.log('[ikSigner] Signing with signMessage (EIP-191)...')
    const sig = await s.signMessage(message)
    if (!sig) throw new Error('No signature returned from Interwoven signer')
    console.log('[ikSigner] ✅ Signed via offlineSigner')
    return toHex(sig)
  } catch (e: any) {
    const errMsg: string = e?.message ?? 'unknown error'

    // Provider-state recovery: viem/IK reports "Must call 'eth_requestAccounts'
    // before personal_sign" when the underlying EIP-1193 provider hasn't
    // completed its accounts handshake (seen on mobile Chrome where the
    // initial connect path doesn't wire the provider up fully). Explicitly
    // trigger the handshake, then retry signMessage once. Idempotent for
    // already-authorized providers — returns the current accounts.
    if (/eth_requestAccounts/i.test(errMsg)) {
      console.warn('[ikSigner] provider needs eth_requestAccounts, initializing...')
      try {
        const connector = s?.connector ?? s?.provider?.connector ?? s?._connector
        const provider =
          s?.provider ??
          connector?.provider ??
          (typeof connector?.getProvider === 'function'
            ? await connector.getProvider().catch(() => null)
            : null)
        if (provider && typeof provider.request === 'function') {
          await provider.request({ method: 'eth_requestAccounts' })
          console.log('[ikSigner] eth_requestAccounts OK')
        } else {
          console.log('[ikSigner] no reachable provider on signer — cannot initialize')
        }
      } catch (initErr: any) {
        console.log('[ikSigner] eth_requestAccounts init threw:', initErr?.message)
      }
      try {
        const sig = await s.signMessage(message)
        if (!sig) throw new Error('No signature returned from Interwoven signer')
        console.log('[ikSigner] ✅ Signed via offlineSigner (after re-init)')
        return toHex(sig)
      } catch (e2: any) {
        console.error('[ikSigner] Sign failed after re-init:', e2?.message ?? e2)
        throw new Error(`Interwoven signing failed: ${e2?.message ?? 'unknown error'}`)
      }
    }

    console.error('[ikSigner] Sign failed:', errMsg)
    throw new Error(`Interwoven signing failed: ${errMsg}`)
  }
}

