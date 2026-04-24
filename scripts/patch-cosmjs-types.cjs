#!/usr/bin/env node
/**
 * Patches cosmjs-types to add exports map (required by Vite + InterwovenKit).
 * Run after pnpm install via "postinstall" in root package.json.
 */
const fs = require('fs')
const path = require('path')

function patchCosmjsTypes(pkgDir) {
  const pkgFile = path.join(pkgDir, 'package.json')
  if (!fs.existsSync(pkgFile)) return false
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  if (pkg.exports && Object.keys(pkg.exports).length > 10) return false

  const exports = { '.': { require: './index.js', default: './index.js' } }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'node_modules') { walk(full); continue }
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue
      const rel = './' + path.relative(pkgDir, full).replace(/\\/g, '/')
      exports[rel]       = { require: rel, default: rel }
      exports[rel.slice(0,-3)] = { require: rel, default: rel }
    }
  }
  walk(pkgDir)
  pkg.exports = exports
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2))
  return true
}

const storeRoot = path.join(__dirname, '..', 'node_modules', '.pnpm')
if (!fs.existsSync(storeRoot)) { console.log('No .pnpm store, skipping'); process.exit(0) }

let patched = 0
for (const entry of fs.readdirSync(storeRoot)) {
  if (!entry.startsWith('cosmjs-types@')) continue
  const pkgDir = path.join(storeRoot, entry, 'node_modules', 'cosmjs-types')
  if (patchCosmjsTypes(pkgDir)) { console.log('Patched: ' + entry); patched++ }
}
if (patched === 0) console.log('cosmjs-types: already patched or not found')
else console.log('cosmjs-types: ' + patched + ' package(s) patched')
