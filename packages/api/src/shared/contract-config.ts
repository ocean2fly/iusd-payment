/**
 * Contract & pool address configuration.
 * Reads directly from environment variables.
 */

const PAY_POOL_ADDRESS = process.env.IPAY_POOL_ADDRESS || ''
const GIFT_POOL_ADDRESS = process.env.GIFT_POOL_ADDRESS || ''
const MODULE_ADDRESS = process.env.MODULE_ADDRESS || ''

interface ContractConfig {
  poolAddress: string
  giftPoolAddress: string
  moduleAddress: string
}

let _config: ContractConfig | null = null

export function initContractConfig(): void {
  if (!PAY_POOL_ADDRESS) {
    throw new Error('[config] FATAL: IPAY_POOL_ADDRESS environment variable is required')
  }
  _config = {
    poolAddress: PAY_POOL_ADDRESS,
    giftPoolAddress: GIFT_POOL_ADDRESS,
    moduleAddress: MODULE_ADDRESS,
  }
  console.log('[config] Pay pool:', _config.poolAddress)
  console.log('[config] Gift pool:', _config.giftPoolAddress)
  console.log('[config] Module:', _config.moduleAddress)
}

export function getPoolAddress(): string {
  if (!_config) initContractConfig()
  return _config!.poolAddress
}

export function getGiftPoolAddress(): string {
  if (!_config) initContractConfig()
  return _config!.giftPoolAddress
}

export function getModuleAddress(): string {
  if (!_config) initContractConfig()
  return _config!.moduleAddress
}

export function getContractConfig(): ContractConfig {
  if (!_config) initContractConfig()
  return { ..._config! }
}

export function isInitialized(): boolean {
  return _config !== null
}
