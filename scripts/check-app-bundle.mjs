#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const assetsDir = path.join(root, 'packages', 'app', 'dist', 'assets')

if (!fs.existsSync(assetsDir)) {
  console.error('❌ Missing build output:', assetsDir)
  process.exit(1)
}

const files = fs.readdirSync(assetsDir)
const jsFiles = files.filter(f => f.endsWith('.js'))

const indexChunk = jsFiles.find(f => /^index-.*\.js$/.test(f))
const vendorChunks = jsFiles.filter(f => /^vendor-.*\.js$/.test(f))
const vendorKit = jsFiles.find(f => /^vendor-kit-.*\.js$/.test(f))

if (!indexChunk) {
  console.error('❌ index chunk not found in dist/assets')
  process.exit(1)
}
if (!vendorKit) {
  console.error('❌ vendor-kit chunk not found in dist/assets')
  process.exit(1)
}

const stat = (name) => fs.statSync(path.join(assetsDir, name)).size
const indexBytes = stat(indexChunk)
const vendorBytes = stat(vendorKit)

// Stability-first thresholds (raw, minified bytes)
const MAX_INDEX_BYTES = 260 * 1024       // 260 KB
const MAX_VENDOR_BYTES = 9.5 * 1024 * 1024 // 9.5 MB
const MAX_VENDOR_CHUNKS = 1

console.log(`index chunk: ${indexChunk} (${Math.round(indexBytes/1024)} KB)`)
console.log(`vendor chunk: ${vendorKit} (${(vendorBytes/1024/1024).toFixed(2)} MB)`)
console.log(`vendor chunks: ${vendorChunks.length}`)

if (vendorChunks.length > MAX_VENDOR_CHUNKS) {
  console.error(`❌ Too many vendor chunks (${vendorChunks.length} > ${MAX_VENDOR_CHUNKS})`)
  process.exit(1)
}
if (indexBytes > MAX_INDEX_BYTES) {
  console.error(`❌ index chunk too large (${indexBytes} > ${MAX_INDEX_BYTES})`)
  process.exit(1)
}
if (vendorBytes > MAX_VENDOR_BYTES) {
  console.error(`❌ vendor-kit chunk too large (${vendorBytes} > ${MAX_VENDOR_BYTES})`)
  process.exit(1)
}

console.log('✅ Bundle guard passed.')
