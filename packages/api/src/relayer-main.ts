import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({
  path: fs.existsSync('.env.relayer') ? '.env.relayer' : '.env',
  override: true,
})

import { initContractConfig, getContractConfig } from './shared/contract-config'
import { startExpiryCron } from './services/relayer/expiryCron'
import { startAutoClaimScheduler } from './services/relayer/autoClaim'
import { startRelayerService, getAllRelayerAddresses } from './services/relayer'
import { startGiftRelayer } from './services/relayer/giftRelayer'
import { startGiftClaimWorker } from './services/relayer/giftClaimWorker'
import {
  RELAYER_PAY_COUNT,
  RELAYER_GIFT_COUNT,
  RELAYER_SWEEP_COUNT,
} from './shared/config'

async function start() {
  try {
    await initContractConfig()
  } catch (err) {
    console.error('[relayer] Contract config verification failed:', err)
    process.exit(1)
  }

  try {
    await startRelayerService()
    startGiftRelayer()
    startGiftClaimWorker()
    startExpiryCron()
    startAutoClaimScheduler()

    const contractConfig = getContractConfig()
    const allAddrs = getAllRelayerAddresses()

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  iPay Multi-Relayer Worker                                       ║
╠══════════════════════════════════════════════════════════════════╣
║  Contract:    ${contractConfig.poolAddress.padEnd(46)}║
║  Module:      ${contractConfig.moduleAddress.padEnd(46)}║
║  Version:     ${'7.0.0'.padEnd(46)}║
║  Pay pool:    ${String(RELAYER_PAY_COUNT + ' instance(s)').padEnd(46)}║
║  Gift pool:   ${String(RELAYER_GIFT_COUNT + ' instance(s)').padEnd(46)}║
║  Sweep pool:  ${String(RELAYER_SWEEP_COUNT + ' instance(s)').padEnd(46)}║
║  Total:       ${String(allAddrs.length + ' unique wallet(s)').padEnd(46)}║
╚══════════════════════════════════════════════════════════════════╝
    `.trim())
  } catch (err) {
    console.error('[relayer] Failed to start worker:', err)
    process.exit(1)
  }
}

if (require.main === module) {
  start()
}
