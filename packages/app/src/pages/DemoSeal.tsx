/**
 * /demo-seal — Identity Seal browser preview
 *
 * No auth required. Input nickname + address → see all style variants.
 * Uses canvas text measurement for pixel-perfect width calculation.
 */

import { useEffect, useState, useMemo } from 'react'
import { IdentityCard } from '../components/IdentityCard'

// ─── Constants ─────────────────────────────────────────────────────────────
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const FRAME_SHAPES  = ['sharp', 'round', 'bracket', 'hexClip', 'double'] as const
const CORNER_STYLES = ['tick', 'dot', 'diamond', 'cross', 'ring'] as const
const EDGE_PATTERNS = ['none', 'dashes', 'dots', 'ticks', 'zigzag'] as const
const BADGE_TYPES   = ['none', 'topDot', 'topLine', 'topTriangle', 'sideDiamond'] as const
const SEP_SHAPES    = ['diamond', 'circle', 'star5', 'ellipseH', 'leaf', 'drop'] as const

type FrameShape  = typeof FRAME_SHAPES[number]
type CornerStyle = typeof CORNER_STYLES[number]
type EdgePattern = typeof EDGE_PATTERNS[number]
type BadgeType   = typeof BADGE_TYPES[number]
type SepShape    = typeof SEP_SHAPES[number]

const GALLERY_DEMOS = [
  { nick: 'jackmorris', addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { nick: 'vitalik',    addr: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B' },
  { nick: 'alice',      addr: '0x1a2B3c4D5e6F7890abCDef1234567890ABcdEF12' },
  { nick: 'swiftFox42', addr: '0xdead000000000000000000000000000000000beef' },
  { nick: '小明',        addr: '0xFEDCBA9876543210FEDCBA9876543210FEDCBA98' },
  { nick: 'treasure',   addr: '0xAAAABBBBCCCCDDDD1111222233334444EEEEFFFF' },
  { nick: 'boldfalcon67', addr: '0x2D6010ccfA9598d2b2eEB9DbcE48adF79a4daB60' },
  { nick: 'zenPanda9',  addr: '0x00000000000000000000000000000000DeaDBeef' },
]

// ─── Hash ──────────────────────────────────────────────────────────────────
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
function hashBytes(s: string, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(fnv(s + i) & 0xFF)
  return out
}

// ─── Base36 ────────────────────────────────────────────────────────────────
function addressToBase36(addr: string): string {
  const clean = addr.replace(/^0x/i, '').replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  let out = ''
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4)
    let val = parseInt(chunk, 16) || 0
    let s = ''
    do { s = B36[val % 36] + s; val = Math.floor(val / 36) } while (val > 0)
    while (s.length < 3) s = '0' + s
    out += s
  }
  return out.toUpperCase()
}

function idHue(addr: string): number { return fnv(addr.toLowerCase()) % 360 }
function hsl(h: number, s: number, l: number): string { return `hsl(${h},${s}%,${l}%)` }

// ─── DNA ───────────────────────────────────────────────────────────────────
function frameDNA(addr: string) {
  const b = hashBytes(addr.toLowerCase(), 48)
  return {
    shape:       FRAME_SHAPES[b[0] % FRAME_SHAPES.length] as FrameShape,
    corner:      CORNER_STYLES[b[1] % CORNER_STYLES.length] as CornerStyle,
    topEdge:     EDGE_PATTERNS[b[2] % EDGE_PATTERNS.length] as EdgePattern,
    botEdge:     EDGE_PATTERNS[b[3] % EDGE_PATTERNS.length] as EdgePattern,
    sideDecor:   EDGE_PATTERNS[b[4] % EDGE_PATTERNS.length] as EdgePattern,
    badge:       BADGE_TYPES[b[5] % BADGE_TYPES.length] as BadgeType,
    strokeW:     0.6 + (b[6] % 4) * 0.2,
    innerGap:    1.5 + (b[7] % 3),
    cornerSize:  0.3 + (b[8] % 3) * 0.1,
    edgeDensity: 3 + (b[9] % 5),
    sideDots:    2 + (b[10] % 5),
    sepShape:    SEP_SHAPES[b[11] % SEP_SHAPES.length] as SepShape,
    b,
  }
}

// ─── Sep dot SVG string ───────────────────────────────────────────────────
function sepDotSvg(shape: SepShape, px: number, cy: number, sz: number, fill: string, op: string, bright: string, bop: string): string {
  if (shape === 'circle') return `<circle cx="${px}" cy="${cy}" r="${sz}" fill="${fill}" opacity="${op}"/><circle cx="${px}" cy="${cy}" r="${sz*.5}" fill="${bright}" opacity="${bop}"/>`
  if (shape === 'star5') {
    const pts = Array.from({length:10},(_,i)=>{const a=(i*Math.PI/5)-Math.PI/2;const r=i%2===0?sz:sz*0.42;return `${px+Math.cos(a)*r},${cy+Math.sin(a)*r}`}).join(' ')
    return `<polygon points="${pts}" fill="${fill}" opacity="${op}"/>`
  }
  if (shape === 'ellipseH') return `<ellipse cx="${px}" cy="${cy}" rx="${sz*1.55}" ry="${sz*0.72}" fill="${fill}" opacity="${op}"/><ellipse cx="${px}" cy="${cy}" rx="${sz*0.8}" ry="${sz*0.36}" fill="${bright}" opacity="${bop}"/>`
  if (shape === 'leaf') {
    const d = `M${px} ${cy-sz} C${px+sz} ${cy-sz} ${px+sz} ${cy+sz} ${px} ${cy+sz} C${px-sz} ${cy+sz} ${px-sz} ${cy-sz} ${px} ${cy-sz} Z`
    return `<path d="${d}" fill="${fill}" opacity="${op}"/>`
  }
  if (shape === 'drop') {
    const d = `M${px} ${cy-sz*1.25} C${px+sz*.85} ${cy-sz*.25} ${px+sz} ${cy+sz*.55} ${px} ${cy+sz} C${px-sz} ${cy+sz*.55} ${px-sz*.85} ${cy-sz*.25} ${px} ${cy-sz*1.25} Z`
    return `<path d="${d}" fill="${fill}" opacity="${op}"/><path d="${d}" fill="${bright}" opacity="${bop}" transform="scale(0.45,0.45) translate(${px*1.22} ${cy*1.22})"/>`
  }
  // diamond
  return `<rect x="${px-sz}" y="${cy-sz}" width="${sz*2}" height="${sz*2}" fill="${fill}" opacity="${op}" transform="rotate(45 ${px} ${cy})"/><rect x="${px-sz*.5}" y="${cy-sz*.5}" width="${sz}" height="${sz}" fill="${bright}" opacity="${bop}" transform="rotate(45 ${px} ${cy})"/>`
}

// ─── Generator (browser version — canvas for exact text widths) ────────────
function generateSeal(address: string, nickname: string, fontSize = 13, dark = true): string {
  const DK = dark
  const b36  = addressToBase36(address)
  const head = b36.slice(0, 4)
  const tail = b36.slice(-3)
  const hue  = idHue(address)
  const dna  = frameDNA(address)
  const n    = (nickname || 'anon').toLowerCase()
  const fs   = fontSize

  const mc       = hsl(hue, DK ? 70 : 65, DK ? 72 : 38)
  const mcBright = hsl(hue, 90, DK ? 82 : 50)
  const atCol    = DK ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.18)'
  const sepCol   = hsl(hue, DK ? 50 : 45, DK ? 45 : 58)
  const nickCol  = DK ? '#f0efe8' : '#111110'
  const fp       = hsl(hue, DK ? 60 : 58, DK ? 62 : 44)
  const fs2      = hsl(hue, DK ? 45 : 42, DK ? 42 : 62)
  const ff       = hsl(hue, DK ? 35 : 32, DK ? 32 : 75)
  const tailFill = hsl(hue, DK ? 45 : 40, DK ? 10 : 94)
  const energyCol= hsl(hue, DK ? 60 : 55, DK ? 40 : 70)
  const glowBright = hsl(hue, 80, DK ? 58 : 48)

  const nkF = `font-family="'Press Start 2P','Silkscreen',monospace" font-weight="900"`
  const mF  = `font-family="monospace" font-weight="500"`
  const nkFs = fs
  const mFs  = Math.round(fs * 1.1)

  // Canvas text measurement
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')!
  ctx.font = `900 ${nkFs}px "Press Start 2P",monospace`
  const nkW = ctx.measureText(n).width
  ctx.font = `500 ${mFs}px monospace`
  const atW   = ctx.measureText('@').width
  const headW = ctx.measureText(head).width

  // Pixel-punk separator (replaces ***)
  const sepSz  = Math.max(2, Math.round(fs * 0.22))
  const sepGap = Math.round(fs * 0.18)
  const sepLn  = Math.round(fs * 0.30)
  const sepW   = sepSz*6 + (sepGap + sepLn + sepGap) * 2

  // Tail frame dimensions (frame moves here, no more nickname frame)
  const tFPx   = Math.round(fs * 0.65)
  const tFPy   = Math.round(fs * 0.4)
  const tailTW = ctx.measureText(tail).width   // no brackets
  const tFW    = tailTW + tFPx * 2
  const tFH    = mFs + tFPy * 2

  const sw   = Math.max(0.5, dna.strokeW * fs / 13)
  const swT  = sw * 0.6
  const cSz  = Math.round(tFH * dna.cornerSize)
  const tick = Math.round(fs * 0.15)
  const ds   = Math.max(1, Math.round(fs * 0.08))
  const ig   = dna.innerGap

  // Layout
  const g    = Math.round(fs * 0.25)
  const pad  = Math.round(fs * 0.5)
  const nickX = pad
  const atX   = nickX + nkW + g
  const headX = atX + atW + g
  const sepX  = headX + headW + g
  const tFX   = sepX + sepW + g

  const W   = Math.ceil(tFX + tFW + pad)
  const H   = Math.round(Math.max(nkFs + pad * 2, tFH + pad * 2))
  const cy  = H / 2
  const tFY = cy - tFH / 2

  // Nickname glow dimensions
  const glowW = nkW + Math.round(fs * 1.4)
  const glowH = nkFs + Math.round(fs * 1.1)
  const glowX = nickX - Math.round(fs * 0.6)

  // Sparkles (deterministic)
  const sparkles = [0,1,2].map(i => ({
    x: Math.round(nickX + (dna.b[20+i*3] % Math.max(1, Math.round(nkW+sepW)))),
    y: Math.round(cy - glowH/3 + (dna.b[21+i*3] % Math.round(glowH * 0.8)) - glowH*0.1),
    r: 1 + (dna.b[22+i*3] % 2),
    op: 0.25 + (dna.b[23+i*3] % 30) / 100,
  }))

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:inline-block;vertical-align:middle">`

  svg += `<defs>`
  svg += `<filter id="nkglow" x="-50%" y="-80%" width="200%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="${Math.round(fs * 0.7)}" result="blur"/></filter>`
  svg += `<filter id="eglow" x="-5%" y="-200%" width="110%" height="500%"><feGaussianBlur in="SourceGraphic" stdDeviation="${Math.round(fs * 0.25)}" result="blur"/></filter>`
  svg += `</defs>`

  // ── Energy line ──
  svg += `<line x1="${nickX}" y1="${cy}" x2="${tFX+tFW}" y2="${cy}" stroke="${energyCol}" stroke-width="${Math.max(0.4, fs*0.04)}" opacity="${DK?'.12':'.08'}" filter="url(#eglow)"/>`

  // ── Nickname glow halo ──
  svg += `<ellipse cx="${glowX + glowW/2}" cy="${cy}" rx="${glowW/2}" ry="${glowH/2}" fill="${glowBright}" opacity="${DK ? '.22' : '.14'}" filter="url(#nkglow)"/>`

  // ── Sparkle dots ──
  sparkles.forEach(s => {
    svg += `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${mcBright}" opacity="${s.op}"/>`
  })

  // ── Nickname text ──
  svg += `<text x="${nickX}" y="${cy}" ${nkF} font-size="${nkFs}" fill="${nickCol}" dominant-baseline="central" letter-spacing="0.5">${n}</text>`

  // ── @ HEAD ──
  svg += `<text x="${atX}" y="${cy}" ${mF} font-size="${mFs}" fill="${atCol}" dominant-baseline="central">@</text>`
  svg += `<text x="${headX}" y="${cy}" ${mF} font-size="${mFs}" fill="${mc}" dominant-baseline="central">${head}</text>`

  // ── Pixel-punk separator ──
  const lw   = Math.max(0.5, fs * 0.06)
  const dPos = [
    sepX + sepSz,
    sepX + sepSz + sepGap + sepLn + sepGap + sepSz*2,
    sepX + sepSz + 2*(sepGap + sepLn + sepGap) + sepSz*4,
  ]
  svg += `<line x1="${dPos[0]+sepSz+sepGap}" y1="${cy}" x2="${dPos[1]-sepSz-sepGap}" y2="${cy}" stroke="${sepCol}" stroke-width="${lw}" stroke-linecap="round" opacity=".6"/>`
  svg += `<line x1="${dPos[1]+sepSz+sepGap}" y1="${cy}" x2="${dPos[2]-sepSz-sepGap}" y2="${cy}" stroke="${sepCol}" stroke-width="${lw}" stroke-linecap="round" opacity=".6"/>`
  dPos.forEach((px, i) => {
    const scale = i === 1 ? 1.3 : 1
    const sz = sepSz * scale
    svg += sepDotSvg(dna.sepShape, px, cy, sz, sepCol, i===1?'.65':'.45', mcBright, i===1?'.35':'.2')
  })

  // ── Tail card with DNA frame ──
  const fX = tFX, fY = tFY, fW = tFW, fH = tFH
  const rx = dna.shape === 'round' ? Math.round(fH*.35) : dna.shape === 'double' ? 2 : dna.shape === 'sharp' ? 1 : 0

  const sh = dna.shape
  // Subtle tinted fill behind tail card
  if (sh !== 'bracket' && sh !== 'hexClip') {
    svg += `<rect x="${fX}" y="${fY}" width="${fW}" height="${fH}" rx="${rx}" fill="${tailFill}" opacity="${DK?'.55':'.4'}"/>`
  }
  if (sh === 'sharp') {
    svg += `<rect x="${fX}" y="${fY}" width="${fW}" height="${fH}" rx="1" fill="none" stroke="${fp}" stroke-width="${sw}" opacity=".85"/>`
  } else if (sh === 'round') {
    svg += `<rect x="${fX}" y="${fY}" width="${fW}" height="${fH}" rx="${Math.round(fH*.35)}" fill="none" stroke="${fp}" stroke-width="${sw}" opacity=".85"/>`
  } else if (sh === 'bracket') {
    const bk = Math.round(fH*.3)
    svg += `<path d="M${fX+bk} ${fY}L${fX} ${fY}L${fX} ${fY+fH}L${fX+bk} ${fY+fH}" fill="none" stroke="${fp}" stroke-width="${sw}" stroke-linecap="round" opacity=".85"/>`
    svg += `<path d="M${fX+fW-bk} ${fY}L${fX+fW} ${fY}L${fX+fW} ${fY+fH}L${fX+fW-bk} ${fY+fH}" fill="none" stroke="${fp}" stroke-width="${sw}" stroke-linecap="round" opacity=".85"/>`
  } else if (sh === 'hexClip') {
    const hx = Math.round(fH*.25)
    svg += `<path d="M${fX+hx} ${fY}L${fX+fW-hx} ${fY}L${fX+fW} ${cy}L${fX+fW-hx} ${fY+fH}L${fX+hx} ${fY+fH}L${fX} ${cy}Z" fill="${tailFill}" opacity="${DK?'.55':'.4'}" stroke="${fp}" stroke-width="${sw}" stroke-linejoin="round"/>`
  } else {
    svg += `<rect x="${fX}" y="${fY}" width="${fW}" height="${fH}" rx="2" fill="none" stroke="${fp}" stroke-width="${sw}" opacity=".85"/>`
    svg += `<rect x="${fX+ig}" y="${fY+ig}" width="${fW-ig*2}" height="${fH-ig*2}" rx="1" fill="none" stroke="${fs2}" stroke-width="${swT}" opacity=".5"/>`
  }

  const co   = dna.corner
  const pts: [number,number][] = [[fX,fY],[fX+fW,fY],[fX+fW,fY+fH],[fX,fY+fH]]
  const dirs: [number,number][] = [[-1,-1],[1,-1],[1,1],[-1,1]]
  pts.forEach(([px,py],i) => {
    const [dx,dy] = dirs[i]
    if (co === 'tick') {
      svg += `<line x1="${px}" y1="${py}" x2="${px-dx*cSz}" y2="${py}" stroke="${fp}" stroke-width="${sw*1.2}" stroke-linecap="round" opacity=".85"/>`
      svg += `<line x1="${px}" y1="${py}" x2="${px}" y2="${py-dy*cSz}" stroke="${fp}" stroke-width="${sw*1.2}" stroke-linecap="round" opacity=".85"/>`
    } else if (co === 'dot') {
      svg += `<circle cx="${px-dx*2}" cy="${py-dy*2}" r="${ds*1.8}" fill="${fp}" opacity=".7"/>`
    } else if (co === 'diamond') {
      const dd = ds*2.5
      svg += `<rect x="${px-dx*3-dd/2}" y="${py-dy*3-dd/2}" width="${dd}" height="${dd}" fill="none" stroke="${fp}" stroke-width="${swT}" opacity=".6" transform="rotate(45 ${px-dx*3} ${py-dy*3})"/>`
    } else if (co === 'cross') {
      const cc = cSz*.6
      svg += `<line x1="${px-dx*1-cc}" y1="${py-dy*1}" x2="${px-dx*1+cc}" y2="${py-dy*1}" stroke="${fp}" stroke-width="${swT}" stroke-linecap="round" opacity=".6"/>`
      svg += `<line x1="${px-dx*1}" y1="${py-dy*1-cc}" x2="${px-dx*1}" y2="${py-dy*1+cc}" stroke="${fp}" stroke-width="${swT}" stroke-linecap="round" opacity=".6"/>`
    } else {
      svg += `<circle cx="${px-dx*2}" cy="${py-dy*2}" r="${ds*2}" fill="none" stroke="${fp}" stroke-width="${swT}" opacity=".6"/>`
      svg += `<circle cx="${px-dx*2}" cy="${py-dy*2}" r="${ds*.8}" fill="${fp}" opacity=".5"/>`
    }
  })

  const edgeMarks = (pattern: string, x1: number, y1: number, x2: number, y2: number, count: number, isVert: boolean) => {
    let s = ''
    for (let i = 0; i < count; i++) {
      const t  = (i+1)/(count+1)
      const mx = x1+(x2-x1)*t
      const my = y1+(y2-y1)*t
      const jit = (dna.b[(i*7+3)%48]%4)-2
      if (pattern === 'dashes') {
        if (isVert) s += `<line x1="${mx-tick}" y1="${my+jit}" x2="${mx+tick}" y2="${my+jit}" stroke="${fs2}" stroke-width="${swT}" stroke-linecap="round" opacity=".45"/>`
        else        s += `<line x1="${mx+jit}" y1="${my-tick}" x2="${mx+jit}" y2="${my+tick}" stroke="${fs2}" stroke-width="${swT}" stroke-linecap="round" opacity=".45"/>`
      } else if (pattern === 'dots') {
        s += `<circle cx="${mx+jit*.5}" cy="${my+jit*.5}" r="${ds}" fill="${ff}" opacity=".55"/>`
      } else if (pattern === 'ticks') {
        if (isVert) s += `<line x1="${mx}" y1="${my}" x2="${mx+(tick*1.2)*(x1<fX+fW/2?-1:1)}" y2="${my}" stroke="${fs2}" stroke-width="${swT}" stroke-linecap="round" opacity=".4"/>`
        else        s += `<line x1="${mx}" y1="${my}" x2="${mx}" y2="${my+(tick*1.2)*(y1<cy?-1:1)}" stroke="${fs2}" stroke-width="${swT}" stroke-linecap="round" opacity=".4"/>`
      } else if (pattern === 'zigzag') {
        const zs  = tick*.8
        const dir = i%2===0?1:-1
        if (isVert) s += `<line x1="${mx-zs*dir}" y1="${my}" x2="${mx}" y2="${my}" stroke="${ff}" stroke-width="${swT}" opacity=".35"/>`
        else        s += `<line x1="${mx}" y1="${my-zs*dir}" x2="${mx}" y2="${my}" stroke="${ff}" stroke-width="${swT}" opacity=".35"/>`
      }
    }
    return s
  }
  const eN = dna.edgeDensity
  svg += edgeMarks(dna.topEdge,   fX,    fY,    fX+fW, fY,    eN, false)
  svg += edgeMarks(dna.botEdge,   fX,    fY+fH, fX+fW, fY+fH, eN, false)
  svg += edgeMarks(dna.sideDecor, fX,    fY,    fX,    fY+fH, dna.sideDots, true)
  svg += edgeMarks(dna.sideDecor, fX+fW, fY,    fX+fW, fY+fH, dna.sideDots, true)

  const badge = dna.badge
  const bcx = fX + fW/2
  if (badge === 'topDot') {
    svg += `<circle cx="${bcx}" cy="${fY-tick-2}" r="${ds*1.8}" fill="${fp}" opacity=".6"/>`
  } else if (badge === 'topLine') {
    const lw = fW*.15
    svg += `<line x1="${bcx-lw}" y1="${fY-tick-2}" x2="${bcx+lw}" y2="${fY-tick-2}" stroke="${ff}" stroke-width="${swT}" opacity=".5"/>`
    svg += `<circle cx="${bcx}" cy="${fY-tick-2}" r="${ds}" fill="${fp}" opacity=".6"/>`
  } else if (badge === 'topTriangle') {
    const ts2 = ds*2.5
    svg += `<polygon points="${bcx},${fY-tick-ts2-1} ${bcx-ts2},${fY-tick-1} ${bcx+ts2},${fY-tick-1}" fill="none" stroke="${fp}" stroke-width="${swT}" opacity=".5"/>`
  } else if (badge === 'sideDiamond') {
    const sd  = ds*2.5
    const sdx = fX+fW+tick+sd+2
    svg += `<rect x="${sdx-sd}" y="${cy-sd}" width="${sd*2}" height="${sd*2}" fill="none" stroke="${ff}" stroke-width="${swT}" opacity=".45" transform="rotate(45 ${sdx} ${cy})"/>`
  }

  // Tail text (no brackets, centered in frame)
  svg += `<text x="${fX+fW/2}" y="${cy}" ${mF} font-size="${mFs}" fill="${mc}" text-anchor="middle" dominant-baseline="central">${tail}</text>`

  svg += `</svg>`
  return svg
}

// ─── Random helpers ────────────────────────────────────────────────────────
function randomAddr(): string {
  let a = '0x'
  for (let i = 0; i < 40; i++) a += '0123456789abcdef'[Math.floor(Math.random() * 16)]
  return a
}

const ADJ  = ['swift','bold','quiet','wild','bright','cool','brave','sharp','lucky','dark','zen','lazy','happy','tiny','mighty','frozen','electric','golden','silver','cosmic']
const NOUN = ['fox','wolf','panda','eagle','tiger','shark','falcon','phoenix','dragon','turtle','rabbit','otter','whale','lynx','cobra','hawk','bear','raven','crane','lion']
function randomNick(): string {
  const a = ADJ[Math.floor(Math.random()*ADJ.length)]
  const n = NOUN[Math.floor(Math.random()*NOUN.length)]
  return `${a}${n.charAt(0).toUpperCase()+n.slice(1)}${Math.floor(Math.random()*99)+1}`
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function DemoSeal() {
  const [nick,  setNick]  = useState('jackmorris')
  const [addr,  setAddr]  = useState('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
  const [dark,  setDark]  = useState(true)
  const [ready, setReady] = useState(false)

  // Wait for fonts
  useEffect(() => {
    document.fonts.ready.then(() => setTimeout(() => setReady(true), 100))
    setTimeout(() => setReady(true), 800)
  }, [])

  const seal16 = ready ? generateSeal(addr, nick, 16, dark) : ''
  const seal13 = ready ? generateSeal(addr, nick, 13, dark) : ''
  const seal10 = ready ? generateSeal(addr, nick, 10, dark) : ''

  // Mock account for card preview
  const mockAccount = useMemo(() => ({
    shortId:             addr.slice(-6).toUpperCase(),
    checksum:            '',
    nickname:            nick,
    address:             addr,
    display:             nick,
    avatarSeed:          null,
    avatarSvg:           ready ? generateSeal(addr, nick, 16, true) : null,
    shortSealSvg:        null,
    defaultClaimAddress: null,
    createdAt:           new Date().toISOString(),
  }), [addr, nick, ready])

  const dna = frameDNA(addr)
  const b36 = addressToBase36(addr)

  const info = ready ? [
    `base36: ${b36.slice(0,12)}…`,
    `hue: ${idHue(addr)}°`,
    `frame: ${dna.shape}`,
    `corner: ${dna.corner}`,
    `top: ${dna.topEdge}`,
    `bottom: ${dna.botEdge}`,
    `badge: ${dna.badge}`,
  ] : []

  const bg  = dark ? '#0f0f0f' : '#f8f7f4'

  return (
    <div className={`min-h-screen px-5 py-8 flex flex-col gap-6`} style={{ background: bg, fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-base font-medium ${dark ? 'text-white/85' : 'text-black/85'}`}>Identity Seal — Preview</h1>
          <p className={`text-[11px] mt-0.5 ${dark ? 'text-white/35' : 'text-black/35'}`}>Address → base36 → deterministic SVG badge</p>
        </div>
        <button
          onClick={() => setDark(v => !v)}
          className={`text-[11px] px-3 py-1.5 rounded-lg border transition-colors ${dark ? 'border-white/15 text-white/50 hover:text-white/70' : 'border-black/15 text-black/50 hover:text-black/70'}`}
        >
          {dark ? '☀ Light' : '🌙 Dark'}
        </button>
      </div>

      {/* Inputs */}
      <div className="flex flex-col gap-3 max-w-xl">
        <div className="flex gap-2 items-center">
          <label className={`text-[10px] w-16 shrink-0 ${dark ? 'text-white/40' : 'text-black/40'}`}>Nickname</label>
          <input
            value={nick}
            onChange={e => setNick(e.target.value)}
            className={`flex-1 text-sm px-3 py-1.5 rounded-lg outline-none border ${dark ? 'bg-white/5 border-white/10 text-white/80 focus:border-white/25' : 'bg-black/5 border-black/10 text-black/80'}`}
          />
        </div>
        <div className="flex gap-2 items-center">
          <label className={`text-[10px] w-16 shrink-0 ${dark ? 'text-white/40' : 'text-black/40'}`}>Address</label>
          <input
            value={addr}
            onChange={e => setAddr(e.target.value)}
            className={`flex-1 font-mono text-xs px-3 py-1.5 rounded-lg outline-none border ${dark ? 'bg-white/5 border-white/10 text-white/80 focus:border-white/25' : 'bg-black/5 border-black/10 text-black/80'}`}
          />
          <button
            onClick={() => { setAddr(randomAddr()); setNick(randomNick()) }}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors ${dark ? 'border-white/15 text-white/50 hover:text-white/70' : 'border-black/15 text-black/50'}`}
          >
            🎲 Random
          </button>
        </div>
      </div>

      {/* DNA info */}
      {ready && (
        <div className={`font-mono text-[10px] leading-loose px-3 py-2 rounded-lg max-w-xl flex flex-wrap gap-x-4 gap-y-0.5 ${dark ? 'bg-white/4 text-white/30' : 'bg-black/4 text-black/30'}`}>
          {info.map(i => <span key={i}>{i}</span>)}
        </div>
      )}

      {/* Sizes */}
      {ready && (
        <div className="flex flex-col gap-4">
          {[
            { label: 'Large (16px)',  html: seal16 },
            { label: 'Medium (13px)', html: seal13 },
            { label: 'Small (10px)',  html: seal10 },
          ].map(({ label, html }) => (
            <div key={label} className="flex flex-col gap-1">
              <p className={`text-[9px] font-mono tracking-widest uppercase ${dark ? 'text-white/25' : 'text-black/25'}`}>{label}</p>
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          ))}

          <div className="flex flex-col gap-1">
            <p className={`text-[9px] font-mono tracking-widest uppercase ${dark ? 'text-white/25' : 'text-black/25'}`}>Inline with text</p>
            <p className={`text-sm leading-loose ${dark ? 'text-white/60' : 'text-black/60'}`}>
              Sent by <span dangerouslySetInnerHTML={{ __html: generateSeal(addr, nick, 12, dark) }} /> just now
            </p>
          </div>
        </div>
      )}

      {/* ── Identity Card preview ── */}
      {ready && (
        <div className="flex flex-col gap-3">
          <p className={`text-[9px] font-mono tracking-widest uppercase ${dark ? 'text-white/25' : 'text-black/25'}`}>
            Identity Card
          </p>
          <div className="overflow-x-auto">
            <IdentityCard account={mockAccount as any} />
          </div>
          <p className={`text-[10px] ${dark ? 'text-white/30' : 'text-black/30'}`}>
            Shown on registration • address hue determines all colors
          </p>
        </div>
      )}

      {/* Divider */}
      <div className={`h-px ${dark ? 'bg-white/[0.07]' : 'bg-black/[0.07]'}`} />

      {/* Gallery */}
      <div className="flex flex-col gap-2">
        <p className={`text-[9px] font-mono tracking-widest uppercase ${dark ? 'text-white/25' : 'text-black/25'}`}>Gallery</p>
        <div className="flex flex-col gap-3">
          {ready && GALLERY_DEMOS.map(d => (
            <button
              key={d.addr}
              onClick={() => { setNick(d.nick); setAddr(d.addr) }}
              className="text-left transition-opacity hover:opacity-70 active:opacity-50"
            >
              <div dangerouslySetInnerHTML={{ __html: generateSeal(d.addr, d.nick, 13, dark) }} />
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
