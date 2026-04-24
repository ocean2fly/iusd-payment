#!/usr/bin/env node
/**
 * Compare every locale JSON against en.json (the authoritative baseline).
 *
 * Fails with exit code 1 if any locale is missing keys present in en OR
 * has keys no longer present in en (stale). Run in CI and locally via
 * `pnpm --filter @ipay/app i18n:check`.
 *
 * Output format: one line per issue — easy to read in GitHub Actions
 * logs and easy to grep locally.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = join(__dirname, '..', 'src', 'i18n', 'locales')
const BASELINE = 'en'

function flatten(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v, key))
    } else {
      out.push(key)
    }
  }
  return out
}

function load(code) {
  const path = join(LOCALES_DIR, `${code}.json`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const baseline = new Set(flatten(load(BASELINE)))

const files = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))
let errors = 0

for (const file of files) {
  const code = file.replace(/\.json$/, '')
  if (code === BASELINE) continue
  const keys = new Set(flatten(load(code)))

  const missing = [...baseline].filter(k => !keys.has(k))
  const stale   = [...keys].filter(k => !baseline.has(k))

  if (missing.length) {
    console.error(`✗ ${code}: missing ${missing.length} key(s) present in ${BASELINE}`)
    missing.slice(0, 10).forEach(k => console.error(`    - ${k}`))
    if (missing.length > 10) console.error(`    … and ${missing.length - 10} more`)
    errors++
  }
  if (stale.length) {
    console.error(`✗ ${code}: has ${stale.length} stale key(s) not in ${BASELINE}`)
    stale.slice(0, 10).forEach(k => console.error(`    - ${k}`))
    if (stale.length > 10) console.error(`    … and ${stale.length - 10} more`)
    errors++
  }
  if (!missing.length && !stale.length) {
    console.log(`✓ ${code}: ${keys.size} keys`)
  }
}

if (errors) {
  console.error(`\nFAIL — ${errors} locale issue(s) found`)
  process.exit(1)
}
console.log(`\nAll locales in sync with ${BASELINE}.json`)
