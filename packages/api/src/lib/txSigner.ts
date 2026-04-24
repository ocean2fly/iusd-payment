/**
 * Transaction signer for Initia Move execute calls.
 *
 * Uses ethers wallet (from RELAYER_MNEMONIC) + REST API broadcast.
 * Initia uses ethsecp256k1 keys with EIP-191 signing + protobuf-encoded tx.
 */

import { ethers } from 'ethers'
import { bech32 } from 'bech32'
import { CHAIN_ID, REST_URL } from '../shared/config'

const GAS_LIMIT = '500000'
const GAS_PRICE = '0.015'  // uinit
const FEE_AMOUNT = String(Math.ceil(parseInt(GAS_LIMIT) * parseFloat(GAS_PRICE)))

// ── Minimal Protobuf Writer ─────────────────────────────────────

class PbWriter {
  private buf: number[] = []
  writeVarint(v: number | bigint): this {
    let n = typeof v === 'bigint' ? v : BigInt(v)
    while (n > 0x7fn) { this.buf.push(Number(n & 0x7fn) | 0x80); n >>= 7n }
    this.buf.push(Number(n)); return this
  }
  writeTag(field: number, wireType: number): this { return this.writeVarint((field << 3) | wireType) }
  writeString(field: number, s: string): this {
    const b = Buffer.from(s, 'utf8')
    return this.writeTag(field, 2).writeVarint(b.length).writeRaw(b)
  }
  writeBytes(field: number, b: Uint8Array): this {
    return this.writeTag(field, 2).writeVarint(b.length).writeRaw(b)
  }
  writeUint64(field: number, v: number | bigint): this { return this.writeTag(field, 0).writeVarint(v) }
  writeRaw(b: Uint8Array): this { for (const byte of b) this.buf.push(byte); return this }
  writeSubmessage(field: number, encodeFn: (w: PbWriter) => void): this {
    const sub = new PbWriter(); encodeFn(sub); const bytes = sub.finish()
    return this.writeTag(field, 2).writeVarint(bytes.length).writeRaw(bytes)
  }
  finish(): Uint8Array { return new Uint8Array(this.buf) }
}

// ── Wallet ───────────────────────────────────────────────────────

let _wallet: ethers.HDNodeWallet | null = null
let _bech32Address = ''

export function initWallet(mnemonic: string): { address: string; bech32: string } {
  _wallet = ethers.Wallet.fromPhrase(mnemonic)
  const evmAddr = _wallet.address.toLowerCase().replace('0x', '')
  const words = bech32.toWords(Buffer.from(evmAddr, 'hex'))
  _bech32Address = bech32.encode('init', words)
  return { address: _wallet.address, bech32: _bech32Address }
}

export function getSignerAddress(): string { return _bech32Address }
export function getSignerHex(): string { return _wallet?.address?.toLowerCase() ?? '' }

// ── Account Info ─────────────────────────────────────────────────

async function getAccountInfo(): Promise<{ accountNumber: string; sequence: string }> {
  const res = await fetch(`${REST_URL}/cosmos/auth/v1beta1/accounts/${_bech32Address}`)
  if (!res.ok) throw new Error(`Failed to get account info: ${res.status}`)
  const data = await res.json() as any
  const account = data.account || {}
  return {
    accountNumber: account.account_number || '0',
    sequence: account.sequence || '0',
  }
}

// ── BCS Encoding Helpers (for Move args) ─────────────────────────

function bcsAddress(addr: string): string {
  const hex = addr.replace(/^0x/i, '').padStart(64, '0')
  return Buffer.from(hex, 'hex').toString('base64')
}

function bcsU64(n: number | bigint): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(BigInt(n))
  return buf.toString('base64')
}

function bcsVecU8(hex: string): string {
  const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex')
  const len = uleb128Buf(bytes.length)
  return Buffer.concat([len, bytes]).toString('base64')
}

function bcsString(str: string): string {
  const bytes = Buffer.from(str, 'utf8')
  const len = uleb128Buf(bytes.length)
  return Buffer.concat([len, bytes]).toString('base64')
}

function uleb128Buf(value: number): Buffer {
  const bytes: number[] = []
  do {
    let byte = value & 0x7f
    value >>= 7
    if (value > 0) byte |= 0x80
    bytes.push(byte)
  } while (value > 0)
  return Buffer.from(bytes)
}

// ── Arg Encoding ─────────────────────────────────────────────────

export type MoveArg =
  | { type: 'object'; value: string }
  | { type: 'address'; value: string }
  | { type: 'u64'; value: number | bigint }
  | { type: 'raw_hex'; value: string }
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }

function encodeArg(arg: MoveArg): string {
  switch (arg.type) {
    case 'object':
    case 'address': return bcsAddress(arg.value)
    case 'u64':     return bcsU64(arg.value)
    case 'raw_hex': return bcsVecU8(arg.value)
    case 'string':  return bcsString(arg.value)
    case 'bool':    return Buffer.from([arg.value ? 1 : 0]).toString('base64')
  }
}

// ── Protobuf Encoding ────────────────────────────────────────────

// SIGN_MODE_EIP_191 = 191
const SIGN_MODE_EIP_191 = 191

interface MsgExecuteParams {
  moduleAddress: string
  moduleName: string
  functionName: string
  typeArgs?: string[]
  args: MoveArg[]
}

function encodeMsgExecuteProto(sender: string, params: MsgExecuteParams): Uint8Array {
  const w = new PbWriter()
  w.writeString(1, sender)
  w.writeString(2, params.moduleAddress)
  w.writeString(3, params.moduleName)
  w.writeString(4, params.functionName)
  for (const t of (params.typeArgs ?? [])) w.writeString(5, t)
  for (const arg of params.args) w.writeBytes(6, Buffer.from(encodeArg(arg), 'base64'))
  return w.finish()
}

function encodeTxBody(messages: Array<{ typeUrl: string; value: Uint8Array }>, memo: string): Uint8Array {
  const w = new PbWriter()
  for (const msg of messages) {
    w.writeSubmessage(1, (aw) => {
      aw.writeString(1, msg.typeUrl)
      aw.writeBytes(2, msg.value)
    })
  }
  if (memo) w.writeString(2, memo)
  // timeout_height = 0 (omit, default)
  return w.finish()
}

function encodePubKey(compressedPubKeyBytes: Uint8Array): Uint8Array {
  // Any { type_url: "/initia.crypto.v1beta1.ethsecp256k1.PubKey", value: PubKey { key: bytes } }
  const pubKeyInner = new PbWriter()
  pubKeyInner.writeBytes(1, compressedPubKeyBytes)
  const pubKeyAny = new PbWriter()
  pubKeyAny.writeString(1, '/initia.crypto.v1beta1.ethsecp256k1.PubKey')
  pubKeyAny.writeBytes(2, pubKeyInner.finish())
  return pubKeyAny.finish()
}

function encodeModeInfo(): Uint8Array {
  // ModeInfo { single: { mode: SIGN_MODE_EIP_191 } }
  const w = new PbWriter()
  w.writeSubmessage(1, (sw) => {
    sw.writeUint64(1, SIGN_MODE_EIP_191)
  })
  return w.finish()
}

function encodeAuthInfo(pubKeyBytes: Uint8Array, sequence: number, feeAmount: string, gasLimit: string): Uint8Array {
  const w = new PbWriter()
  // SignerInfo
  w.writeSubmessage(1, (si) => {
    si.writeBytes(1, encodePubKey(pubKeyBytes))       // public_key (Any)
    si.writeBytes(2, encodeModeInfo())                 // mode_info
    if (sequence > 0) si.writeUint64(3, sequence)      // sequence
  })
  // Fee
  w.writeSubmessage(2, (fw) => {
    // Coin { denom, amount }
    fw.writeSubmessage(1, (cw) => {
      cw.writeString(1, 'uinit')
      cw.writeString(2, feeAmount)
    })
    fw.writeUint64(2, BigInt(gasLimit))
    // payer = "" (omit), granter = "" (omit)
  })
  return w.finish()
}

function encodeTxRaw(bodyBytes: Uint8Array, authInfoBytes: Uint8Array, signatures: Uint8Array[]): Uint8Array {
  const w = new PbWriter()
  w.writeBytes(1, bodyBytes)
  w.writeBytes(2, authInfoBytes)
  for (const sig of signatures) w.writeBytes(3, sig)
  return w.finish()
}

// ── Sign & Broadcast ─────────────────────────────────────────────

export async function signAndBroadcast(
  params: MsgExecuteParams,
  memo = '',
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (!_wallet) return { success: false, error: 'Wallet not initialized' }

  try {
    const { accountNumber, sequence } = await getAccountInfo()

    // Compressed public key (33 bytes)
    const compressedPubKey = ethers.SigningKey.computePublicKey(_wallet.signingKey.publicKey, true)
    const pubKeyBytes = Buffer.from(compressedPubKey.replace('0x', ''), 'hex')

    // 1. Encode protobuf body & authInfo for broadcast
    const msgValue = encodeMsgExecuteProto(_bech32Address, params)
    const bodyBytes = encodeTxBody(
      [{ typeUrl: '/initia.move.v1.MsgExecute', value: msgValue }],
      memo,
    )
    const authInfoBytes = encodeAuthInfo(pubKeyBytes, parseInt(sequence), FEE_AMOUNT, GAS_LIMIT)

    // 2. Build amino sign doc for EIP-191 signing
    //    Amino convention: omit empty arrays and zero-value fields
    const aminoMsgValue: Record<string, any> = {
      sender: _bech32Address,
      module_address: params.moduleAddress,
      module_name: params.moduleName,
      function_name: params.functionName,
    }
    if (params.typeArgs && params.typeArgs.length > 0) aminoMsgValue.type_args = params.typeArgs
    const encodedArgs = params.args.map(encodeArg)
    if (encodedArgs.length > 0) aminoMsgValue.args = encodedArgs

    const signDoc = {
      chain_id: CHAIN_ID,
      account_number: accountNumber,
      sequence,
      fee: { amount: [{ denom: 'uinit', amount: FEE_AMOUNT }], gas: GAS_LIMIT },
      msgs: [{ type: 'move/MsgExecute', value: aminoMsgValue }],
      memo,
    }

    const signBytes = Buffer.from(JSON.stringify(sortObject(signDoc)))

    // EIP-191: ethers.signMessage handles prefix + keccak256 internally
    const sigHex = await _wallet.signMessage(signBytes)
    // signMessage returns 65 bytes: r(32) + s(32) + v(1) — all 65 bytes are needed
    const sigBytes = Buffer.from(sigHex.replace('0x', ''), 'hex')

    // 3. Encode TxRaw and broadcast as tx_bytes
    const txRawBytes = encodeTxRaw(bodyBytes, authInfoBytes, [sigBytes])
    const txBytesB64 = Buffer.from(txRawBytes).toString('base64')

    const broadcastRes = await fetch(`${REST_URL}/cosmos/tx/v1beta1/txs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_bytes: txBytesB64, mode: 'BROADCAST_MODE_SYNC' }),
    })

    const broadcastData = await broadcastRes.json() as any
    const txResponse = broadcastData.tx_response || broadcastData

    if (txResponse.code && txResponse.code !== 0) {
      const errMsg = txResponse.raw_log || txResponse.log || `TX failed with code ${txResponse.code}`
      console.error(`[TxSigner] TX failed: code=${txResponse.code} raw_log=${txResponse.raw_log}`)
      return { success: false, error: errMsg }
    }

    const txHash = txResponse.txhash || ''
    console.log(`[TxSigner] TX broadcast: ${txHash}`)

    // Poll for on-chain confirmation (SYNC only checks mempool)
    if (txHash) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(r => setTimeout(r, 1500))
        try {
          const queryRes = await fetch(`${REST_URL}/cosmos/tx/v1beta1/txs/${txHash}`)
          if (queryRes.ok) {
            const queryData = await queryRes.json() as any
            const txResult = queryData.tx_response || queryData
            if (txResult.code && txResult.code !== 0) {
              const errMsg = txResult.raw_log || txResult.log || `TX failed on-chain with code ${txResult.code}`
              console.error(`[TxSigner] TX on-chain fail: ${txHash} code=${txResult.code}`)
              return { success: false, txHash, error: errMsg }
            }
            console.log(`[TxSigner] TX confirmed: ${txHash}`)
            return { success: true, txHash }
          }
        } catch {}
      }
      // If we couldn't confirm after retries, return txHash but flag as unconfirmed
      console.warn(`[TxSigner] TX unconfirmed after polling: ${txHash}`)
    }

    return { success: true, txHash }

  } catch (error: any) {
    console.error('[TxSigner] Error:', error.message)
    return { success: false, error: error.message }
  }
}

// ── Convenience: Execute a Move function ─────────────────────────

export async function executeMove(
  moduleAddress: string,
  moduleName: string,
  functionName: string,
  args: MoveArg[],
  memo?: string,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  return signAndBroadcast({ moduleAddress, moduleName, functionName, args }, memo)
}

// ── Fee Grant ────────────────────────────────────────────────────

/**
 * Grant fee allowance (feegrant) to a user address.
 * Hand-coded protobuf encoding since cosmjs Registry doesn't know Initia feegrant types.
 */
export async function signAndBroadcastFeeGrant(
  granteeAddress: string,
  spendLimitUinit: string,
  allowedMessages: string[],
  memo = '',
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (!_wallet) return { success: false, error: 'Wallet not initialized' }

  try {
    const { accountNumber, sequence } = await getAccountInfo()
    const compressedPubKey = ethers.SigningKey.computePublicKey(_wallet.signingKey.publicKey, true)
    const pubKeyBytes = Buffer.from(compressedPubKey.replace('0x', ''), 'hex')

    // Protobuf encode MsgGrantAllowance
    // BasicAllowance { spend_limit: [Coin] }
    const basicAllowance = new PbWriter()
    basicAllowance.writeSubmessage(1, (cw) => { cw.writeString(1, 'uinit'); cw.writeString(2, spendLimitUinit) })

    // AllowedMsgAllowance { allowance: Any(BasicAllowance), allowed_messages: string[] }
    const allowedMsgAllowance = new PbWriter()
    allowedMsgAllowance.writeSubmessage(1, (aw) => {
      aw.writeString(1, '/cosmos.feegrant.v1beta1.BasicAllowance')
      aw.writeBytes(2, basicAllowance.finish())
    })
    for (const msg of allowedMessages) allowedMsgAllowance.writeString(2, msg)

    // MsgGrantAllowance { granter, grantee, allowance: Any(AllowedMsgAllowance) }
    const msgGrant = new PbWriter()
    msgGrant.writeString(1, _bech32Address)
    msgGrant.writeString(2, granteeAddress)
    msgGrant.writeSubmessage(3, (aw) => {
      aw.writeString(1, '/cosmos.feegrant.v1beta1.AllowedMsgAllowance')
      aw.writeBytes(2, allowedMsgAllowance.finish())
    })

    const bodyBytes = encodeTxBody(
      [{ typeUrl: '/cosmos.feegrant.v1beta1.MsgGrantAllowance', value: msgGrant.finish() }],
      memo,
    )
    const authInfoBytes = encodeAuthInfo(pubKeyBytes, parseInt(sequence), FEE_AMOUNT, GAS_LIMIT)

    // Amino sign doc for EIP-191
    const aminoMsg = {
      type: 'cosmos-sdk/MsgGrantAllowance',
      value: {
        granter: _bech32Address,
        grantee: granteeAddress,
        allowance: {
          type: 'cosmos-sdk/AllowedMsgAllowance',
          value: {
            allowance: {
              type: 'cosmos-sdk/BasicAllowance',
              value: { spend_limit: [{ denom: 'uinit', amount: spendLimitUinit }] },
            },
            allowed_messages: allowedMessages,
          },
        },
      },
    }

    const signDoc = {
      chain_id: CHAIN_ID,
      account_number: accountNumber,
      sequence,
      fee: { amount: [{ denom: 'uinit', amount: FEE_AMOUNT }], gas: GAS_LIMIT },
      msgs: [aminoMsg],
      memo,
    }

    const signBytes = Buffer.from(JSON.stringify(sortObject(signDoc)))
    const sigHex = await _wallet.signMessage(signBytes)
    const sigBytes = Buffer.from(sigHex.replace('0x', ''), 'hex')

    const txRawBytes = encodeTxRaw(bodyBytes, authInfoBytes, [sigBytes])
    const txBytesB64 = Buffer.from(txRawBytes).toString('base64')

    const broadcastRes = await fetch(`${REST_URL}/cosmos/tx/v1beta1/txs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_bytes: txBytesB64, mode: 'BROADCAST_MODE_SYNC' }),
    })

    const data = await broadcastRes.json() as any
    const txResponse = data.tx_response || data
    if (txResponse.code && txResponse.code !== 0) {
      const errMsg = txResponse.raw_log || `TX failed code ${txResponse.code}`
      console.error(`[TxSigner] FeeGrant failed: code=${txResponse.code} raw_log=${txResponse.raw_log}`)
      return { success: false, error: errMsg }
    }
    return { success: true, txHash: txResponse.txhash || '' }
  } catch (error: any) {
    console.error('[TxSigner] FeeGrant error:', error.message)
    return { success: false, error: error.message }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function sortObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sortObject)
  const sorted: any = {}
  for (const key of Object.keys(obj).sort()) sorted[key] = sortObject(obj[key])
  return sorted
}

export function bech32ToHex(addr: string): string {
  if (addr.startsWith('0x')) return addr.toLowerCase()
  const decoded = bech32.decode(addr)
  return '0x' + Buffer.from(bech32.fromWords(decoded.words)).toString('hex')
}

export function hexToBech32(hex: string): string {
  const evmAddr = hex.toLowerCase().replace('0x', '')
  const words = bech32.toWords(Buffer.from(evmAddr, 'hex'))
  return bech32.encode('init', words)
}
