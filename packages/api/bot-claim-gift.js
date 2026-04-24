#!/usr/bin/env node
/**
 * Bot claim gift — all bots claim a group gift and send thank-you.
 *
 * Usage: node scripts/bot-claim-gift.js <packetId> <claimKey> [bots.json]
 *
 * Each bot:
 *   1. POST /gift/claim-queue → queue for claim
 *   2. Poll /gift/packet/:id until claimed
 *   3. POST /gift/thank → send 💋 kiss
 */

const fs = require('fs')

const API_BASE = process.env.API_BASE || 'https://api.iusd-pay.xyz/v1'
const PACKET_ID = process.argv[2]
const CLAIM_KEY = process.argv[3]
const BOTS_FILE = process.argv[4] || 'bots.json'

if (!PACKET_ID || !CLAIM_KEY) {
  console.error('Usage: node bot-claim-gift.js <packetId> <claimKey> [bots.json]')
  process.exit(1)
}

const THANK_OPTIONS = [
  { emoji: '💋', message: 'Love you!' },
  { emoji: '🫡', message: 'Thank you Boss!' },
  { emoji: '🙏', message: 'Much appreciated!' },
  { emoji: '🎉', message: 'This made my day!' },
  { emoji: '❤️', message: 'So kind of you!' },
  { emoji: '🔥', message: "You're the best!" },
  { emoji: '💋', message: 'Kiss kiss!' },
  { emoji: '🥰', message: 'You are amazing!' },
  { emoji: '🌟', message: 'Shining bright!' },
  { emoji: '🎁', message: 'Best gift ever!' },
]

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function claimAndThank(bot, index, total) {
  const { token, nickname, shortId } = bot

  // 1. Claim
  try {
    const claimRes = await fetch(`${API_BASE}/gift/claim-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ packetId: PACKET_ID, claimKey: CLAIM_KEY }),
    })
    const claimData = await claimRes.json()
    if (!claimRes.ok) {
      console.log(`  [${index + 1}/${total}] ${nickname} — claim failed: ${claimData.error}`)
      return false
    }
    console.log(`  [${index + 1}/${total}] ${nickname} — ${claimData.status}`)

    // 2. Wait for claim to complete (poll max 30s)
    if (claimData.status !== 'claimed') {
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(3000)
        const statusRes = await fetch(`${API_BASE}/gift/packet/${PACKET_ID}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (statusRes.ok) {
          const d = await statusRes.json()
          if (d.myClaimStatus === 'claimed') {
            console.log(`  [${index + 1}/${total}] ${nickname} — claimed! amount=${d.myAmount}`)
            break
          }
        }
      }
    }

    // 3. Send thank you
    await sleep(1000)
    const thank = THANK_OPTIONS[Math.floor(Math.random() * THANK_OPTIONS.length)]
    const thankRes = await fetch(`${API_BASE}/gift/thank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ packetId: PACKET_ID, emoji: thank.emoji, message: thank.message }),
    })
    if (thankRes.ok) {
      console.log(`  [${index + 1}/${total}] ${nickname} — sent ${thank.emoji} "${thank.message}"`)
    } else {
      const err = await thankRes.json().catch(() => ({}))
      console.log(`  [${index + 1}/${total}] ${nickname} — thank failed: ${err.error ?? 'unknown'}`)
    }

    return true
  } catch (e) {
    console.error(`  [${index + 1}/${total}] ${nickname} — error: ${e.message}`)
    return false
  }
}

async function main() {
  if (!fs.existsSync(BOTS_FILE)) {
    console.error(`Bots file not found: ${BOTS_FILE}`)
    console.error('Run create-test-bots.js first')
    process.exit(1)
  }

  const bots = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'))
  console.log(`Claiming gift ${PACKET_ID.slice(0, 16)}... with ${bots.length} bots`)
  console.log()

  let success = 0, failed = 0

  // Process sequentially to avoid overwhelming the queue
  for (let i = 0; i < bots.length; i++) {
    const ok = await claimAndThank(bots[i], i, bots.length)
    if (ok) success++; else failed++
    // Small delay between bots
    await sleep(500)
  }

  console.log()
  console.log(`Done! ${success} claimed, ${failed} failed.`)
}

main().catch(console.error)
