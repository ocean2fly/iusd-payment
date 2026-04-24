/**
 * Shared pay_v3 refund helper.
 *
 * Used by /history, /inbox, /request — anywhere a recipient (status=3 confirmed)
 * needs to refund the sender. Chain-side key is sha256(plain payment_id), see
 * api/lib/payKeyHash.ts. The plain id is what the UI/DB stores.
 *
 * Caller passes a `requestTxBlock` from useInterwovenKit() so this helper stays
 * hook-free and reusable from any component.
 */

import { getPayPoolAddress, getModuleAddress } from './contractConfig'
import { bcsEncodeVecU8, bcsEncodeAddress } from './orderCrypto'

export async function buildRefundTx(plainPaymentIdHex: string) {
  const id = plainPaymentIdHex.replace(/^0x/, '')
  const plainBytes = new Uint8Array(id.match(/../g)!.map(b => parseInt(b, 16)))
  const idBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', plainBytes as any))
  return {
    typeUrl: '/initia.move.v1.MsgExecute',
    value: {
      // sender filled in by interwovenkit from connected address
      moduleAddress: getModuleAddress(),
      moduleName: 'pay_v3',
      functionName: 'refund',
      typeArgs: [],
      args: [bcsEncodeAddress(getPayPoolAddress()), bcsEncodeVecU8(idBytes)],
    },
  }
}

export async function refundPayment(
  requestTxBlock: (req: { messages: any[] }) => Promise<any>,
  senderAddress: string,
  plainPaymentIdHex: string,
): Promise<void> {
  const tx = await buildRefundTx(plainPaymentIdHex)
  ;(tx.value as any).sender = senderAddress
  const res = await requestTxBlock({ messages: [tx] })
  if (res?.code !== 0) throw new Error((res as any)?.rawLog ?? 'Refund failed')
}
