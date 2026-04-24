#!/usr/bin/env node
/**
 * Create test bot accounts — real wallets, real auth, real registration.
 *
 * Usage: node scripts/create-test-bots.js [count]
 *   Default: 100 bots
 *
 * Each bot:
 *   1. Generates a random mnemonic → derives wallet
 *   2. GET /auth/nonce/:address → gets challenge nonce
 *   3. Signs nonce with EIP-191 → POST /auth/verify → session token
 *   4. POST /account/register → creates account with random nickname
 *
 * Outputs: bots.json with { address, bech32, shortId, nickname, token, mnemonic }
 */

const { ethers } = require('ethers')
const { bech32 } = require('bech32')
const fs = require('fs')

const API_BASE = process.env.API_BASE || 'https://api.iusd-pay.xyz/v1'
const COUNT = parseInt(process.argv[2] || '100', 10)
const OUTPUT_FILE = process.argv[3] || 'bots.json'

function toBech32(evmAddr) {
  const hex = evmAddr.toLowerCase().replace('0x', '')
  const words = bech32.toWords(Buffer.from(hex, 'hex'))
  return bech32.encode('init', words)
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function createBot(index) {
  // 1. Generate wallet
  const wallet = ethers.Wallet.createRandom()
  const bech32Addr = toBech32(wallet.address)

  // 2. Get nonce
  const nonceRes = await fetch(`${API_BASE}/auth/nonce/${bech32Addr}`)
  if (!nonceRes.ok) {
    const err = await nonceRes.text()
    throw new Error(`Nonce failed for ${bech32Addr}: ${err}`)
  }
  const { nonce } = await nonceRes.json()

  // 3. Sign nonce (EIP-191)
  const signature = await wallet.signMessage(nonce)

  // 4. Verify → get session token
  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: bech32Addr, signature, nonce }),
  })
  if (!verifyRes.ok) {
    const err = await verifyRes.text()
    throw new Error(`Verify failed for ${bech32Addr}: ${err}`)
  }
  const { token } = await verifyRes.json()

  // 5. Register account
  const regRes = await fetch(`${API_BASE}/account/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}), // Random nickname auto-generated
  })
  if (!regRes.ok) {
    const err = await regRes.text()
    throw new Error(`Register failed for ${bech32Addr}: ${err}`)
  }
  const { account } = await regRes.json()

  return {
    index,
    address: wallet.address,
    bech32: bech32Addr,
    shortId: account.shortId,
    nickname: account.nickname,
    token,
    mnemonic: wallet.mnemonic.phrase,
  }
}

async function main() {
  console.log(`Creating ${COUNT} bot accounts...`)
  console.log(`API: ${API_BASE}`)
  console.log()

  const bots = []
  const errors = []

  // Process in batches of 10 to avoid overwhelming the API
  const BATCH = 10
  for (let i = 0; i < COUNT; i += BATCH) {
    const batch = []
    const end = Math.min(i + BATCH, COUNT)
    for (let j = i; j < end; j++) {
      batch.push(
        createBot(j)
          .then(bot => {
            console.log(`  [${j + 1}/${COUNT}] ${bot.nickname} — ${bot.shortId}`)
            return bot
          })
          .catch(err => {
            console.error(`  [${j + 1}/${COUNT}] FAILED: ${err.message}`)
            errors.push({ index: j, error: err.message })
            return null
          })
      )
    }
    const results = await Promise.all(batch)
    bots.push(...results.filter(Boolean))

    // Small delay between batches
    if (end < COUNT) await sleep(500)
  }

  // Save results
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(bots, null, 2))
  console.log()
  console.log(`Done! ${bots.length} bots created, ${errors.length} failed.`)
  console.log(`Saved to ${OUTPUT_FILE}`)

  if (errors.length > 0) {
    console.log('\nErrors:')
    errors.forEach(e => console.log(`  #${e.index}: ${e.error}`))
  }
}

main().catch(console.error)
