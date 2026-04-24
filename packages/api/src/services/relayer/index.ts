/**
 * Multi-relayer service entrypoint.
 *
 * Creates three independent RelayerPools:
 *   - payPool:   for pay auto-claim + fee grants
 *   - giftPool:  for gift claim sponsorship
 *   - sweepPool: for expiry sweep
 *
 * Each pool has N instances, each with its own wallet and serial queue.
 * Configure via env vars: RELAYER_PAY_COUNT, RELAYER_GIFT_COUNT, RELAYER_SWEEP_COUNT
 */

import { bech32 } from 'bech32'
import { RelayerPool } from '../../lib/RelayerPool'
import {
  RELAYER_MNEMONIC,
  RELAYER_PAY_COUNT,
  RELAYER_GIFT_COUNT,
  RELAYER_SWEEP_COUNT,
  RELAYER_MNEMONICS_PAY,
  RELAYER_MNEMONICS_GIFT,
  RELAYER_MNEMONIC_SWEEP,
  REST_URL,
  MODULE_ADDRESS,
} from '../../shared/config'
import { getPoolAddress, getGiftPoolAddress } from '../../shared/contract-config'

let _payPool: RelayerPool | null = null
let _giftPool: RelayerPool | null = null
let _sweepPool: RelayerPool | null = null
let started = false

function buildPool(
  explicitMnemonics: string,
  count: number,
  baseMnemonic: string,
  namePrefix: string,
  accountIndex: number,
): RelayerPool {
  if (explicitMnemonics) {
    const mnemonics = explicitMnemonics.split(',').map(m => m.trim()).filter(Boolean)
    return RelayerPool.fromMnemonics(mnemonics, namePrefix)
  }
  return RelayerPool.fromMnemonic(baseMnemonic, count, namePrefix, accountIndex)
}

export async function startRelayerService(): Promise<void> {
  if (started) return

  if (!RELAYER_MNEMONIC) {
    console.warn('[Relayer] No RELAYER_MNEMONIC set, all sponsorship disabled')
    started = true
    return
  }

  _payPool = buildPool(RELAYER_MNEMONICS_PAY, RELAYER_PAY_COUNT, RELAYER_MNEMONIC, 'pay', 10)
  _giftPool = buildPool(RELAYER_MNEMONICS_GIFT, RELAYER_GIFT_COUNT, RELAYER_MNEMONIC, 'gift', 20)
  _sweepPool = buildPool(RELAYER_MNEMONIC_SWEEP, RELAYER_SWEEP_COUNT, RELAYER_MNEMONIC, 'sweep', 30)

  started = true

  // Print relayer info
  console.log(`\n[Relayer] Initialized:`)
  console.log(`  Pay pool:   ${_payPool.size} instance(s)`)
  _payPool.getAddresses().forEach((a, i) => console.log(`    pay-${i}: ${a}`))
  console.log(`  Gift pool:  ${_giftPool.size} instance(s)`)
  _giftPool.getAddresses().forEach((a, i) => console.log(`    gift-${i}: ${a}`))
  console.log(`  Sweep pool: ${_sweepPool.size} instance(s)`)
  _sweepPool.getAddresses().forEach((a, i) => console.log(`    sweep-${i}: ${a}`))
  console.log()

  // Check sponsor registration
  await checkSponsorStatus()
}

export function getPayPool(): RelayerPool {
  if (!_payPool) throw new Error('Relayer service not started')
  return _payPool
}

export function getGiftPool(): RelayerPool {
  if (!_giftPool) throw new Error('Relayer service not started')
  return _giftPool
}

export function getSweepPool(): RelayerPool {
  if (!_sweepPool) throw new Error('Relayer service not started')
  return _sweepPool
}

export function getRelayerServiceAddress(): string {
  if (_payPool) return _payPool.getAddresses()[0]
  return process.env.RELAYER_ADDRESS || ''
}

/** Get all unique relayer addresses across all pools. */
export function getAllRelayerAddresses(): string[] {
  const addrs = new Set<string>()
  if (_payPool) _payPool.getAddresses().forEach(a => addrs.add(a))
  if (_giftPool) _giftPool.getAddresses().forEach(a => addrs.add(a))
  if (_sweepPool) _sweepPool.getAddresses().forEach(a => addrs.add(a))
  return [...addrs]
}

// ── Sponsor Registration Check ──────────────────────────────────

async function checkSponsorForPool(
  poolType: string,
  poolAddress: string,
  moduleName: string,
  addresses: string[],
): Promise<void> {
  const unregistered: string[] = []

  for (const addr of addresses) {
    try {
      const poolB64 = Buffer.from(poolAddress.replace(/^0x/, '').padStart(64, '0'), 'hex').toString('base64')

      // Convert bech32 address to hex for BCS encoding
      const decoded = bech32.decode(addr)
      const addrHex = Buffer.from(bech32.fromWords(decoded.words)).toString('hex').padStart(64, '0')
      const addrB64 = Buffer.from(addrHex, 'hex').toString('base64')

      const url = `${REST_URL}/initia/move/v1/accounts/${MODULE_ADDRESS}/view_functions/${moduleName}/is_sponsor`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type_args: [], args: [poolB64, addrB64] }),
      })

      if (res.ok) {
        const data = await res.json() as any
        const isSponsor = data.data === '["true"]' || data.data === 'true' || (Array.isArray(JSON.parse(data.data || '[]')) && JSON.parse(data.data)[0] === 'true')
        if (!isSponsor) unregistered.push(addr)
      } else {
        unregistered.push(addr)
      }
    } catch {
      // Can't verify, assume not registered
      unregistered.push(addr)
    }
  }

  if (unregistered.length > 0) {
    console.warn(`\n[Relayer] ⚠️  ${unregistered.length} ${poolType} relayer(s) NOT registered as sponsor:`)
    for (const addr of unregistered) {
      console.warn(`  ${addr}`)
    }
    console.warn(`\n  Register with:`)
    for (const addr of unregistered) {
      console.warn(`  initiad tx move execute \\`)
      console.warn(`    ${MODULE_ADDRESS} \\`)
      console.warn(`    ${moduleName} add_sponsor \\`)
      console.warn(`    --args 'object:${poolAddress}' 'address:${addr}' \\`)
      console.warn(`    --from <deployer-key> --chain-id interwoven-1 --node https://rpc.initia.xyz:443 \\`)
      console.warn(`    --gas auto --gas-adjustment 1.5 --gas-prices 0.015uinit -y`)
      console.warn()
    }
  }
}

async function checkSponsorStatus(): Promise<void> {
  if (!_payPool || !_giftPool || !_sweepPool) return

  const payPoolAddr = getPoolAddress()
  const giftPoolAddr = getGiftPoolAddress()

  // All relayer addresses that need pay_v3 sponsor
  const payAddrs = [...new Set([..._payPool.getAddresses()])]
  // All relayer addresses that need gift_v3 sponsor
  const giftAddrs = [...new Set([..._giftPool.getAddresses(), ..._sweepPool.getAddresses()])]

  if (payPoolAddr) {
    await checkSponsorForPool('pay', payPoolAddr, 'pay_v3', payAddrs)
  }
  if (giftPoolAddr) {
    await checkSponsorForPool('gift', giftPoolAddr, 'gift_v3', giftAddrs)
  }
}
