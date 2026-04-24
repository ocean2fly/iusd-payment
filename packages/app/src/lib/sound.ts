/**
 * sound.ts — Central sound manager.
 *
 * - Lazy-initialized AudioContext (Chrome requires user gesture)
 * - Global mute preference persisted in localStorage
 * - Short, subtle sounds; don't compete with the app UX
 */

const MUTE_KEY = 'ipay_sound_muted'
const STYLE_KEY = 'ipay_sound_style'
const CARDFLIP_KEY = 'ipay_card_flip_style'
const GIFT_KEY = 'ipay_gift_style'
const TXN_KEY = 'ipay_transaction_style'
const MENU_KEY = 'ipay_menu_style'

// Each category supports 'silent' to mute just that category
// ── Click (button) styles ──
export type TickStyle =
  | 'keyboard' | 'pop'   | 'tic'    | 'chime' | 'glass'
  | 'coin'     | 'digital' | 'drip' | 'paper' | 'piano' | 'silent'

export const TICK_STYLES: { id: TickStyle; name: string; desc: string }[] = [
  { id: 'keyboard', name: 'Keyboard',  desc: 'Mechanical keyboard click' },
  { id: 'pop',      name: 'Soft Pop',  desc: 'Bubble pop' },
  { id: 'tic',      name: 'Tic',       desc: 'Short high tick' },
  { id: 'chime',    name: 'Chime',     desc: 'Soft bell ding' },
  { id: 'glass',    name: 'Glass',     desc: 'Glass ting' },
  { id: 'coin',     name: 'Coin',      desc: 'Metallic ching' },
  { id: 'digital',  name: 'Digital',   desc: '8-bit blip' },
  { id: 'drip',     name: 'Drip',      desc: 'Water drop' },
  { id: 'paper',    name: 'Paper',     desc: 'Paper tap' },
  { id: 'piano',    name: 'Piano',     desc: 'Gentle piano note' },
  { id: 'silent',   name: 'Silent',    desc: 'No click sound' },
]

// ── Card flip styles ──
export type CardFlipStyle =
  | 'breeze' | 'dream_bells' | 'page_turn' | 'whoosh' | 'soft_pop' | 'silent'

export const CARD_FLIP_STYLES: { id: CardFlipStyle; name: string; desc: string }[] = [
  { id: 'breeze',      name: 'Breeze',       desc: 'Soft wind passing by' },
  { id: 'dream_bells', name: 'Dream Bells',  desc: 'Glass wind-chime shimmer' },
  { id: 'page_turn',   name: 'Page Turn',    desc: 'Paper rustle' },
  { id: 'whoosh',      name: 'Whoosh',       desc: 'Quick swoosh' },
  { id: 'soft_pop',    name: 'Soft Pop',     desc: 'Gentle double-pop' },
  { id: 'silent',      name: 'Silent',       desc: 'No flip sound' },
]

// ── Gift celebration styles ──
export type GiftStyle =
  | 'celebration' | 'sparkle' | 'fanfare' | 'bell_cascade' | 'soft_bell' | 'silent'

export const GIFT_STYLES: { id: GiftStyle; name: string; desc: string }[] = [
  { id: 'celebration',  name: 'Celebration',  desc: 'Rising chord C-E-G-C' },
  { id: 'sparkle',      name: 'Sparkle',      desc: 'High twinkle notes' },
  { id: 'fanfare',      name: 'Fanfare',      desc: 'Brassy ta-da' },
  { id: 'bell_cascade', name: 'Bell Cascade', desc: 'Descending bells' },
  { id: 'soft_bell',    name: 'Soft Bell',    desc: 'Single gentle bell' },
  { id: 'silent',       name: 'Silent',       desc: 'No gift sound' },
]

// ── Transaction styles (transfer, request, paid, invoice) ──
export type TransactionStyle =
  | 'whoosh_up' | 'coin_drop' | 'pneumatic' | 'confirm_chime' | 'paper_slide' | 'silent'

export const TRANSACTION_STYLES: { id: TransactionStyle; name: string; desc: string }[] = [
  { id: 'whoosh_up',     name: 'Whoosh Up',     desc: 'Ascending swoosh' },
  { id: 'coin_drop',     name: 'Coin Drop',     desc: 'Metallic coin landing' },
  { id: 'pneumatic',     name: 'Pneumatic',     desc: 'Retro tube delivery' },
  { id: 'confirm_chime', name: 'Confirm Chime', desc: 'Double-tone confirmation' },
  { id: 'paper_slide',   name: 'Paper Slide',   desc: 'Paper sliding across' },
  { id: 'silent',        name: 'Silent',        desc: 'No transaction sound' },
]

// ── Menu / modal open styles ──
export type MenuStyle =
  | 'slide' | 'soft_pop' | 'swish' | 'silent'

export const MENU_STYLES: { id: MenuStyle; name: string; desc: string }[] = [
  { id: 'slide',    name: 'Slide',    desc: 'Slide panel in' },
  { id: 'soft_pop', name: 'Soft Pop', desc: 'Gentle pop open' },
  { id: 'swish',    name: 'Swish',    desc: 'Air swish' },
  { id: 'silent',   name: 'Silent',   desc: 'No menu sound' },
]

let _ctx: AudioContext | null = null
let _muted: boolean = (() => {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
})()
let _style: TickStyle = (() => {
  try {
    const s = localStorage.getItem(STYLE_KEY) as TickStyle | null
    if (s && TICK_STYLES.some(x => x.id === s)) return s
  } catch {}
  return 'paper'
})()
let _cardFlipStyle: CardFlipStyle = (() => {
  try {
    const s = localStorage.getItem(CARDFLIP_KEY) as CardFlipStyle | null
    if (s && CARD_FLIP_STYLES.some(x => x.id === s)) return s
  } catch {}
  return 'whoosh'
})()
let _giftStyle: GiftStyle = (() => {
  try {
    const s = localStorage.getItem(GIFT_KEY) as GiftStyle | null
    if (s && GIFT_STYLES.some(x => x.id === s)) return s
  } catch {}
  return 'celebration'
})()
let _txnStyle: TransactionStyle = (() => {
  try {
    const s = localStorage.getItem(TXN_KEY) as TransactionStyle | null
    if (s && TRANSACTION_STYLES.some(x => x.id === s)) return s
  } catch {}
  return 'confirm_chime'
})()
let _menuStyle: MenuStyle = (() => {
  try {
    const s = localStorage.getItem(MENU_KEY) as MenuStyle | null
    if (s && MENU_STYLES.some(x => x.id === s)) return s
  } catch {}
  return 'soft_pop'
})()

export function getTickStyle(): TickStyle { return _style }
export function setTickStyle(s: TickStyle) {
  _style = s
  try { localStorage.setItem(STYLE_KEY, s) } catch {}
}
export function getCardFlipStyle(): CardFlipStyle { return _cardFlipStyle }
export function setCardFlipStyle(s: CardFlipStyle) {
  _cardFlipStyle = s
  try { localStorage.setItem(CARDFLIP_KEY, s) } catch {}
}
export function getGiftStyle(): GiftStyle { return _giftStyle }
export function setGiftStyle(s: GiftStyle) {
  _giftStyle = s
  try { localStorage.setItem(GIFT_KEY, s) } catch {}
}
export function getTransactionStyle(): TransactionStyle { return _txnStyle }
export function setTransactionStyle(s: TransactionStyle) {
  _txnStyle = s
  try { localStorage.setItem(TXN_KEY, s) } catch {}
}
export function getMenuStyle(): MenuStyle { return _menuStyle }
export function setMenuStyle(s: MenuStyle) {
  _menuStyle = s
  try { localStorage.setItem(MENU_KEY, s) } catch {}
}

function getCtx(): AudioContext | null {
  if (_muted) return null
  if (_ctx) return _ctx
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    _ctx = new AC()
    // Resume on first call — Chrome requires gesture
    _ctx?.resume?.()
    return _ctx
  } catch {
    return null
  }
}

export function isMuted(): boolean { return _muted }

export function setMuted(v: boolean) {
  _muted = v
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0') } catch {}
}

export function toggleMuted(): boolean {
  setMuted(!_muted)
  return _muted
}

// Cache a short white-noise buffer for the keyboard click (reused every call)
let _noiseBuffer: AudioBuffer | null = null
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (_noiseBuffer) return _noiseBuffer
  const sr = ctx.sampleRate
  const len = Math.floor(sr * 0.05) // 50ms
  const buf = ctx.createBuffer(1, len, sr)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  _noiseBuffer = buf
  return buf
}

// ── 10 tick style implementations ────────────────────────────────

function tickKeyboard(ctx: AudioContext, now: number) {
  const noise = ctx.createBufferSource()
  noise.buffer = getNoiseBuffer(ctx)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2200
  hp.Q.value = 0.8
  const nGain = ctx.createGain()
  nGain.gain.setValueAtTime(0, now)
  nGain.gain.linearRampToValueAtTime(0.09, now + 0.002)
  nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)
  noise.connect(hp).connect(nGain).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.05)

  const o = ctx.createOscillator()
  const og = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(180, now)
  o.frequency.exponentialRampToValueAtTime(90, now + 0.03)
  og.gain.setValueAtTime(0, now)
  og.gain.linearRampToValueAtTime(0.05, now + 0.003)
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
  o.connect(og).connect(ctx.destination)
  o.start(now); o.stop(now + 0.06)
}

function tickPop(ctx: AudioContext, now: number) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(420, now)
  o.frequency.exponentialRampToValueAtTime(180, now + 0.08)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.1, now + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
  o.connect(g).connect(ctx.destination)
  o.start(now); o.stop(now + 0.15)
}

function tickTic(ctx: AudioContext, now: number) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(1400, now)
  o.frequency.exponentialRampToValueAtTime(800, now + 0.03)
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(0.06, now + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  o.connect(g).connect(ctx.destination)
  o.start(now); o.stop(now + 0.08)
}

function tickChime(ctx: AudioContext, now: number) {
  // A5 + E6 overtone, bell-like long tail
  ;[880, 1318.51].forEach((freq, i) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    const atk = 0.005
    const vol = i === 0 ? 0.08 : 0.03
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(vol, now + atk)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6)
    o.connect(g).connect(ctx.destination)
    o.start(now); o.stop(now + 0.7)
  })
}

function tickGlass(ctx: AudioContext, now: number) {
  // High sine with gentle decay + tiny sparkle
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(1800, now)
  o.frequency.linearRampToValueAtTime(1700, now + 0.03)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.08, now + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
  o.connect(g).connect(ctx.destination)
  o.start(now); o.stop(now + 0.3)

  const o2 = ctx.createOscillator()
  const g2 = ctx.createGain()
  o2.type = 'sine'
  o2.frequency.value = 3600
  g2.gain.setValueAtTime(0, now)
  g2.gain.linearRampToValueAtTime(0.025, now + 0.005)
  g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
  o2.connect(g2).connect(ctx.destination)
  o2.start(now); o2.stop(now + 0.15)
}

function tickCoin(ctx: AudioContext, now: number) {
  // Metallic double-sine with quick rise (ching!)
  ;[2200, 3300].forEach((freq, i) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, now + i * 0.015)
    g.gain.linearRampToValueAtTime(0.06, now + i * 0.015 + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.015 + 0.2)
    o.connect(g).connect(ctx.destination)
    o.start(now + i * 0.015); o.stop(now + i * 0.015 + 0.22)
  })
}

function tickDigital(ctx: AudioContext, now: number) {
  // 8-bit square wave blip
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'square'
  o.frequency.setValueAtTime(880, now)
  o.frequency.setValueAtTime(1100, now + 0.02)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.06, now + 0.003)
  g.gain.setValueAtTime(0.06, now + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  o.connect(g).connect(ctx.destination)
  o.start(now); o.stop(now + 0.07)
}

function tickDrip(ctx: AudioContext, now: number) {
  // Quick pitch drop with bandpass filter → watery
  const o = ctx.createOscillator()
  const bp = ctx.createBiquadFilter()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(900, now)
  o.frequency.exponentialRampToValueAtTime(280, now + 0.07)
  bp.type = 'bandpass'
  bp.frequency.value = 600
  bp.Q.value = 2
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.11, now + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)
  o.connect(bp).connect(g).connect(ctx.destination)
  o.start(now); o.stop(now + 0.17)
}

function tickPaper(ctx: AudioContext, now: number) {
  // Bandpass-filtered noise burst → paper rustle
  const noise = ctx.createBufferSource()
  noise.buffer = getNoiseBuffer(ctx)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 600
  bp.Q.value = 0.8
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.12, now + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.035)
  noise.connect(bp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.04)
}

function tickPiano(ctx: AudioContext, now: number) {
  // Triangle fundamental + sine overtone, natural-ish piano pluck
  const notes: [number, number][] = [[523.25, 0.07], [1046.50, 0.025]] // C5 + C6
  notes.forEach(([freq, vol]) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = freq < 800 ? 'triangle' : 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(vol, now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)
    o.connect(g).connect(ctx.destination)
    o.start(now); o.stop(now + 0.5)
  })
}

const TICK_IMPLS: Record<TickStyle, (ctx: AudioContext, now: number) => void> = {
  keyboard: tickKeyboard,
  pop:      tickPop,
  tic:      tickTic,
  chime:    tickChime,
  glass:    tickGlass,
  coin:     tickCoin,
  digital:  tickDigital,
  drip:     tickDrip,
  paper:    tickPaper,
  piano:    tickPiano,
  silent:   () => {},
}

/** Short, neutral click — dispatches to the current style. */
export function playTick() {
  if (_style === 'silent') return
  const ctx = getCtx()
  if (!ctx) return
  try {
    const impl = TICK_IMPLS[_style] ?? TICK_IMPLS.keyboard
    impl(ctx, ctx.currentTime)
  } catch {}
}

/**
 * Pull-to-refresh — reuses the Breeze card-flip sound (soft wind).
 */
export function playRefresh() {
  const ctx = getCtx()
  if (!ctx) return
  try { cfBreeze(ctx, ctx.currentTime) } catch {}
}

/** Preview a style (used by Settings picker; always plays even if that
 *  style is not the current one) */
export function previewTick(style: TickStyle) {
  const ctx = getCtx()
  if (!ctx) return
  if (style === 'silent') return
  try { (TICK_IMPLS[style] ?? TICK_IMPLS.keyboard)(ctx, ctx.currentTime) } catch {}
}
export function previewCardFlip(style: CardFlipStyle) {
  const ctx = getCtx()
  if (!ctx) return
  const impl = CARD_FLIP_IMPLS[style]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}
export function previewGift(style: GiftStyle) {
  const ctx = getCtx()
  if (!ctx) return
  const impl = GIFT_IMPLS[style]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}
export function previewTransaction(style: TransactionStyle) {
  const ctx = getCtx()
  if (!ctx) return
  const impl = TXN_IMPLS[style]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}
export function previewMenu(style: MenuStyle) {
  const ctx = getCtx()
  if (!ctx) return
  const impl = MENU_IMPLS[style]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}

// ── Card flip implementations ────────────────────────────────

function longNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * seconds)
  const buf = ctx.createBuffer(1, len, sr)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.9
  return buf
}

function cfBreeze(ctx: AudioContext, now: number) {
  // Soft wind: filtered noise, gentle swell
  const noise = ctx.createBufferSource()
  noise.buffer = longNoiseBuffer(ctx, 1.2)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.7
  bp.frequency.setValueAtTime(500, now)
  bp.frequency.exponentialRampToValueAtTime(900, now + 0.4)
  bp.frequency.exponentialRampToValueAtTime(300, now + 1.0)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.08, now + 0.15)
  g.gain.linearRampToValueAtTime(0.05, now + 0.6)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1)
  noise.connect(bp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 1.2)
}

function cfDreamBells(ctx: AudioContext, now: number) {
  // Glass wind-chime pentatonic shimmer
  const notes = [659.25, 830.61, 987.77, 1318.51]
  notes.forEach((freq, i) => {
    const o1 = ctx.createOscillator()
    const g1 = ctx.createGain()
    o1.type = 'sine'
    o1.frequency.setValueAtTime(freq * 0.97, now + i * 0.05)
    o1.frequency.linearRampToValueAtTime(freq, now + i * 0.05 + 0.04)
    g1.gain.setValueAtTime(0, now + i * 0.05)
    g1.gain.linearRampToValueAtTime(0.06, now + i * 0.05 + 0.02)
    g1.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 1.2)
    o1.connect(g1).connect(ctx.destination)
    o1.start(now + i * 0.05); o1.stop(now + i * 0.05 + 1.4)
    const o2 = ctx.createOscillator()
    const g2 = ctx.createGain()
    o2.type = 'sine'
    o2.frequency.value = freq * 2
    g2.gain.setValueAtTime(0, now + i * 0.05)
    g2.gain.linearRampToValueAtTime(0.015, now + i * 0.05 + 0.01)
    g2.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.5)
    o2.connect(g2).connect(ctx.destination)
    o2.start(now + i * 0.05); o2.stop(now + i * 0.05 + 0.6)
  })
}

function cfPageTurn(ctx: AudioContext, now: number) {
  // Paper rustle: short sharp band-passed noise
  ;[0, 0.1].forEach((delay) => {
    const noise = ctx.createBufferSource()
    noise.buffer = longNoiseBuffer(ctx, 0.2)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800
    bp.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, now + delay)
    g.gain.linearRampToValueAtTime(0.12, now + delay + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.15)
    noise.connect(bp).connect(g).connect(ctx.destination)
    noise.start(now + delay); noise.stop(now + delay + 0.18)
  })
}

function cfWhoosh(ctx: AudioContext, now: number) {
  // Quick downward swoosh
  const noise = ctx.createBufferSource()
  noise.buffer = longNoiseBuffer(ctx, 0.4)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.5
  bp.frequency.setValueAtTime(2500, now)
  bp.frequency.exponentialRampToValueAtTime(600, now + 0.3)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.15, now + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
  noise.connect(bp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.4)
}

function cfSoftPop(ctx: AudioContext, now: number) {
  // Two gentle descending pops
  ;[320, 200].forEach((freq, i) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(freq, now + i * 0.1)
    o.frequency.exponentialRampToValueAtTime(freq / 2, now + i * 0.1 + 0.1)
    g.gain.setValueAtTime(0, now + i * 0.1)
    g.gain.linearRampToValueAtTime(0.08, now + i * 0.1 + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.15)
    o.connect(g).connect(ctx.destination)
    o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.2)
  })
}

const CARD_FLIP_IMPLS: Record<CardFlipStyle, ((ctx: AudioContext, now: number) => void) | null> = {
  breeze:      cfBreeze,
  dream_bells: cfDreamBells,
  page_turn:   cfPageTurn,
  whoosh:      cfWhoosh,
  soft_pop:    cfSoftPop,
  silent:      null,
}

/** Card flip — uses current CardFlipStyle. */
export function playCardFlip() {
  const ctx = getCtx()
  if (!ctx) return
  const impl = CARD_FLIP_IMPLS[_cardFlipStyle]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}

// ── Gift celebration implementations ────────────────────────────

function gCelebration(ctx: AudioContext, now: number) {
  // C5 E5 G5 C6 ascending
  const notes = [523.25, 659.25, 783.99, 1046.50]
  notes.forEach((freq, i) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, now + i * 0.1)
    g.gain.linearRampToValueAtTime(0.12, now + i * 0.1 + 0.04)
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.5)
    o.connect(g).connect(ctx.destination)
    o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.55)
  })
}

function gSparkle(ctx: AudioContext, now: number) {
  // Random high notes twinkle
  const base = [1318.51, 1567.98, 1760.00, 2093.00, 2349.32]
  for (let i = 0; i < 8; i++) {
    const freq = base[Math.floor(Math.random() * base.length)]
    const delay = i * 0.08 + Math.random() * 0.03
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, now + delay)
    g.gain.linearRampToValueAtTime(0.07, now + delay + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.4)
    o.connect(g).connect(ctx.destination)
    o.start(now + delay); o.stop(now + delay + 0.45)
  }
}

function gFanfare(ctx: AudioContext, now: number) {
  // Brassy "ta-da": G5 → C6 → E6 (triangle wave feels more brass-like)
  const notes = [[783.99, 0.12], [1046.50, 0.12], [1318.51, 0.35]]
  let t = now
  notes.forEach(([freq, dur]) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.1, t + 0.02)
    g.gain.setValueAtTime(0.1, t + dur - 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15)
    o.connect(g).connect(ctx.destination)
    o.start(t); o.stop(t + dur + 0.2)
    t += dur
  })
}

function gBellCascade(ctx: AudioContext, now: number) {
  // Descending bells
  const notes = [1318.51, 1046.50, 783.99, 659.25, 523.25]
  notes.forEach((freq, i) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, now + i * 0.11)
    g.gain.linearRampToValueAtTime(0.1, now + i * 0.11 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.8)
    o.connect(g).connect(ctx.destination)
    o.start(now + i * 0.11); o.stop(now + i * 0.11 + 0.85)
  })
}

function gSoftBell(ctx: AudioContext, now: number) {
  // Single gentle A5 bell with long tail
  const o1 = ctx.createOscillator()
  const g1 = ctx.createGain()
  o1.type = 'sine'
  o1.frequency.value = 880
  g1.gain.setValueAtTime(0, now)
  g1.gain.linearRampToValueAtTime(0.1, now + 0.02)
  g1.gain.exponentialRampToValueAtTime(0.0001, now + 1.5)
  o1.connect(g1).connect(ctx.destination)
  o1.start(now); o1.stop(now + 1.6)
  // overtone
  const o2 = ctx.createOscillator()
  const g2 = ctx.createGain()
  o2.type = 'sine'
  o2.frequency.value = 2640
  g2.gain.setValueAtTime(0, now)
  g2.gain.linearRampToValueAtTime(0.025, now + 0.01)
  g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.8)
  o2.connect(g2).connect(ctx.destination)
  o2.start(now); o2.stop(now + 0.9)
}

const GIFT_IMPLS: Record<GiftStyle, ((ctx: AudioContext, now: number) => void) | null> = {
  celebration:  gCelebration,
  sparkle:      gSparkle,
  fanfare:      gFanfare,
  bell_cascade: gBellCascade,
  soft_bell:    gSoftBell,
  silent:       null,
}

/** Gift celebration — for wrap success / claim reveal. Uses current GiftStyle. */
export function playGift() {
  const ctx = getCtx()
  if (!ctx) return
  const impl = GIFT_IMPLS[_giftStyle]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}

// ── Transaction implementations ────────────────────────────

function txnWhooshUp(ctx: AudioContext, now: number) {
  const noise = ctx.createBufferSource()
  noise.buffer = longNoiseBuffer(ctx, 0.4)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 2
  bp.frequency.setValueAtTime(400, now)
  bp.frequency.exponentialRampToValueAtTime(2000, now + 0.25)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.15, now + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
  noise.connect(bp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.35)
}

function txnCoinDrop(ctx: AudioContext, now: number) {
  // Two metallic ping hops
  ;[[2200, 0], [1800, 0.12], [2400, 0.22]].forEach(([freq, delay]) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'triangle'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, now + delay)
    g.gain.linearRampToValueAtTime(0.08, now + delay + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.3)
    o.connect(g).connect(ctx.destination)
    o.start(now + delay); o.stop(now + delay + 0.35)
  })
}

function txnPneumatic(ctx: AudioContext, now: number) {
  // Retro pneumatic tube: low rumble + high whoosh
  const noise = ctx.createBufferSource()
  noise.buffer = longNoiseBuffer(ctx, 0.5)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 800
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.2, now + 0.05)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)
  noise.connect(lp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.5)
  // thud at end
  const o = ctx.createOscillator()
  const og = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(120, now + 0.4)
  o.frequency.exponentialRampToValueAtTime(60, now + 0.5)
  og.gain.setValueAtTime(0, now + 0.4)
  og.gain.linearRampToValueAtTime(0.1, now + 0.41)
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.52)
  o.connect(og).connect(ctx.destination)
  o.start(now + 0.4); o.stop(now + 0.55)
}

function txnConfirmChime(ctx: AudioContext, now: number) {
  // Two-tone confirm: G5 → C6
  ;[[783.99, 0], [1046.50, 0.1]].forEach(([freq, delay]) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0, now + delay)
    g.gain.linearRampToValueAtTime(0.1, now + delay + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.4)
    o.connect(g).connect(ctx.destination)
    o.start(now + delay); o.stop(now + delay + 0.45)
  })
}

function txnPaperSlide(ctx: AudioContext, now: number) {
  const noise = ctx.createBufferSource()
  noise.buffer = longNoiseBuffer(ctx, 0.5)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1200
  bp.Q.value = 0.6
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.13, now + 0.08)
  g.gain.linearRampToValueAtTime(0.13, now + 0.3)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)
  noise.connect(bp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.5)
}

const TXN_IMPLS: Record<TransactionStyle, ((ctx: AudioContext, now: number) => void) | null> = {
  whoosh_up:     txnWhooshUp,
  coin_drop:     txnCoinDrop,
  pneumatic:     txnPneumatic,
  confirm_chime: txnConfirmChime,
  paper_slide:   txnPaperSlide,
  silent:        null,
}

/** Transaction sound — for transfer/request/paid/invoice moments. */
export function playTransaction() {
  const ctx = getCtx()
  if (!ctx) return
  const impl = TXN_IMPLS[_txnStyle]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}

// ── Menu implementations ────────────────────────────

function menuSlide(ctx: AudioContext, now: number) {
  const noise = ctx.createBufferSource()
  noise.buffer = longNoiseBuffer(ctx, 0.2)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(800, now)
  bp.frequency.exponentialRampToValueAtTime(1800, now + 0.15)
  bp.Q.value = 1
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.12, now + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  noise.connect(bp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.2)
}

function menuSoftPop(ctx: AudioContext, now: number) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(350, now)
  o.frequency.exponentialRampToValueAtTime(500, now + 0.06)
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.08, now + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
  o.connect(g).connect(ctx.destination)
  o.start(now); o.stop(now + 0.12)
}

function menuSwish(ctx: AudioContext, now: number) {
  const noise = ctx.createBufferSource()
  noise.buffer = longNoiseBuffer(ctx, 0.25)
  const bp = ctx.createBiquadFilter()
  bp.type = 'highpass'
  bp.frequency.value = 2000
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.1, now + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  noise.connect(bp).connect(g).connect(ctx.destination)
  noise.start(now); noise.stop(now + 0.22)
}

const MENU_IMPLS: Record<MenuStyle, ((ctx: AudioContext, now: number) => void) | null> = {
  slide:    menuSlide,
  soft_pop: menuSoftPop,
  swish:    menuSwish,
  silent:   null,
}

/** Menu / modal open sound. */
export function playMenu() {
  const ctx = getCtx()
  if (!ctx) return
  const impl = MENU_IMPLS[_menuStyle]
  if (!impl) return
  try { impl(ctx, ctx.currentTime) } catch {}
}

/** Welcome fanfare — C5 E5 G5 C6 ascending sparkle for Registered page */
export function playWelcome() {
  const ctx = getCtx()
  if (!ctx) return
  try {
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99, 1046.50]
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0, now + i * 0.12)
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.12 + 0.04)
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.6)
      o.connect(g).connect(ctx.destination)
      o.start(now + i * 0.12)
      o.stop(now + i * 0.12 + 0.7)
    })
    // A sprinkle of high notes for magic
    setTimeout(() => {
      const ctx2 = getCtx()
      if (!ctx2) return
      const t2 = ctx2.currentTime
      ;[1318.51, 1567.98, 2093.00].forEach((freq, i) => {
        const o = ctx2.createOscillator()
        const g = ctx2.createGain()
        o.type = 'sine'
        o.frequency.value = freq
        g.gain.setValueAtTime(0, t2 + i * 0.08)
        g.gain.linearRampToValueAtTime(0.06, t2 + i * 0.08 + 0.02)
        g.gain.exponentialRampToValueAtTime(0.001, t2 + i * 0.08 + 0.4)
        o.connect(g).connect(ctx2.destination)
        o.start(t2 + i * 0.08)
        o.stop(t2 + i * 0.08 + 0.5)
      })
    }, 500)
  } catch {}
}

/**
 * Install a global click listener that plays a tick on any <button> click.
 * Call once from main.tsx / App.
 *
 * Excludes buttons marked data-no-sound="true".
 */
export function installGlobalClickSound() {
  if (typeof document === 'undefined') return
  if ((installGlobalClickSound as any)._installed) return
  ;(installGlobalClickSound as any)._installed = true
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null
    if (!t) return
    // Walk up to find a button (covers <button>, [role=button], <a>)
    const btn = t.closest('button, [role="button"]') as HTMLElement | null
    if (!btn) return
    if (btn.dataset?.noSound === 'true') return
    if ((btn as any).disabled) return
    playTick()
  }, true)
}
