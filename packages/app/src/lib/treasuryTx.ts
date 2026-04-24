/**
 * Build a Move tx to transfer iUSD FA tokens directly to treasury.
 * Uses initia_std::primary_fungible_store::transfer.
 * This is equivalent to a standard token send.
 */

import { IUSD_FA } from '../networks'

const IUSD_METADATA = IUSD_FA.startsWith('0x') ? IUSD_FA : `0x${IUSD_FA}`

// Convert init1 bech32 or 0x hex address to the proper 0x-prefixed format

// Convert init1 bech32 to 0x via the fact we know treasury = init19qh7s28mj64t393qeh264t46hacu4d6hccqghp
const TREASURY_0X = import.meta.env.VITE_MODULE_ADDRESS || ''

/**
 * Build a /initia.move.v1.MsgExecuteJSON message that transfers `amountMicro` iUSD to treasury.
 *
 * @param senderAddress   User's init1... bech32 (IK address)
 * @param _treasury       Treasury bech32 (unused — we use constant 0x)
 * @param amountMicro     Amount in μUSD as bigint
 */
export async function buildTreasuryDepositTx(
  senderAddress: string,
  _treasury: string,
  amountMicro: bigint,
): Promise<any> {
  return {
    typeUrl: '/initia.move.v1.MsgExecuteJSON',
    value: {
      sender: senderAddress,
      moduleAddress: '0x1',
      moduleName: 'primary_fungible_store',
      functionName: 'transfer',
      typeArgs: [],
      // JSON-encoded args: metadata_address, to_address, amount (as string for u64)
      args: [
        `"${IUSD_METADATA}"`,
        `"${TREASURY_0X}"`,
        `"${amountMicro.toString()}"`,
      ],
    },
  }
}
