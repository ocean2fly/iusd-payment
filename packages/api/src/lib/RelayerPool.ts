/**
 * RelayerPool — manages N RelayerInstance workers with round-robin distribution.
 *
 * Each instance has its own wallet and serial queue, so N instances
 * can process N transactions in parallel without nonce conflicts.
 */

import { RelayerInstance, type MsgExecuteParams, type TxResult, type MoveArg } from './RelayerInstance'

export class RelayerPool {
  readonly instances: RelayerInstance[]
  private nextIndex = 0

  constructor(instances: RelayerInstance[]) {
    if (instances.length === 0) throw new Error('RelayerPool requires at least one instance')
    this.instances = instances
  }

  /** Create a pool from a single mnemonic with HD derivation paths. */
  static fromMnemonic(mnemonic: string, count: number, namePrefix: string, accountIndex: number): RelayerPool {
    const instances: RelayerInstance[] = []
    for (let i = 0; i < count; i++) {
      const path = `m/44'/60'/${accountIndex}'/0/${i}`
      const name = `${namePrefix}-${i}`
      instances.push(new RelayerInstance(mnemonic, name, path))
    }
    return new RelayerPool(instances)
  }

  /** Create a pool from comma-separated mnemonics (each gets default derivation). */
  static fromMnemonics(mnemonics: string[], namePrefix: string): RelayerPool {
    const instances = mnemonics.map((m, i) =>
      new RelayerInstance(m.trim(), `${namePrefix}-${i}`)
    )
    return new RelayerPool(instances)
  }

  get size(): number { return this.instances.length }

  /** Get all bech32 addresses (for sponsor registration). */
  getAddresses(): string[] {
    return this.instances.map(i => i.bech32Address)
  }

  /** Get all hex addresses. */
  getHexAddresses(): string[] {
    return this.instances.map(i => i.hexAddress)
  }

  /** Submit a Move execute tx, round-robin to least-busy instance. */
  submit(params: MsgExecuteParams, memo = ''): Promise<TxResult> {
    const instance = this.pick()
    return instance.submit(params, memo)
  }

  /** Submit a fee grant tx. */
  submitFeeGrant(granteeAddress: string, spendLimitUinit: string, allowedMessages: string[], memo = ''): Promise<TxResult> {
    const instance = this.pick()
    return instance.submitFeeGrant(granteeAddress, spendLimitUinit, allowedMessages, memo)
  }

  /** Pick the least-busy instance (shortest queue), breaking ties with round-robin. */
  private pick(): RelayerInstance {
    // Find minimum queue length
    let minLen = Infinity
    for (const inst of this.instances) {
      if (inst.queueLength < minLen) minLen = inst.queueLength
    }

    // Among instances with min queue length, pick round-robin
    const candidates = this.instances.filter(i => i.queueLength === minLen)
    const idx = this.nextIndex % candidates.length
    this.nextIndex++
    return candidates[idx]
  }
}
