/**
 * Identity Seal — Server-side TypeScript port
 *
 * Format: nickname @ HEAD *** [decorated tail card]
 *
 * - nickname: plain pixel-font text (no frame)
 * - tail card: carries all DNA decorations (frame shape, corners, edge marks, badge)
 * - no [] brackets on the tail display
 */
import { createHash } from 'crypto'

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
  for (let i = 0; i < n; i++) out.push(fnv(s + i) & 0xff)
  return out
}

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
/**
 * Deterministic base36 from any address format (init1 bech32 or 0x EVM).
 * SHA256 hash → 50-char base36 string. Consistent regardless of address format.
 */
function addressToBase36(addr: string): string {
  const normalized = addr.toLowerCase().replace(/\s/g, '')
  const hashHex = createHash('sha256').update(normalized).digest('hex')
  let n = BigInt('0x' + hashHex)
  let out = ''
  const B = 36n
  while (n > 0n) { out = B36[Number(n % B)] + out; n = n / B }
  while (out.length < 50) out = '0' + out
  return out.toUpperCase()
}

function idHue(addr: string): number { return fnv(addr.toLowerCase()) % 360 }
function hsl(h: number, s: number, l: number): string { return `hsl(${h},${s}%,${l}%)` }

const SEP_SHAPES    = ['diamond', 'circle', 'star5', 'ellipseH', 'leaf', 'drop',
                       'hexagon', 'cross', 'arrow', 'crescent', 'heart', 'shield'] as const
const FRAME_SHAPES  = ['sharp', 'round', 'bracket', 'hexClip', 'double'] as const
const CORNER_STYLES = ['tick', 'dot', 'diamond', 'cross', 'ring'] as const
const EDGE_PATTERNS = ['none', 'dashes', 'dots', 'ticks', 'zigzag'] as const
const BADGE_TYPES   = ['none', 'topDot', 'topLine', 'topTriangle', 'sideDiamond'] as const

function frameDNA(addr: string) {
  const b = hashBytes(addr.toLowerCase(), 48)
  return {
    shape:       FRAME_SHAPES[b[0] % FRAME_SHAPES.length],
    corner:      CORNER_STYLES[b[1] % CORNER_STYLES.length],
    topEdge:     EDGE_PATTERNS[b[2] % EDGE_PATTERNS.length],
    botEdge:     EDGE_PATTERNS[b[3] % EDGE_PATTERNS.length],
    sideDecor:   EDGE_PATTERNS[b[4] % EDGE_PATTERNS.length],
    badge:       BADGE_TYPES[b[5] % BADGE_TYPES.length],
    strokeW:     0.6 + (b[6] % 4) * 0.2,
    innerGap:    1.5 + (b[7] % 3),
    cornerSize:  0.3 + (b[8] % 3) * 0.1,
    edgeDensity: 3 + (b[9] % 5),
    sideDots:    2 + (b[10] % 5),
    sepShape:    SEP_SHAPES[b[11] % SEP_SHAPES.length],
    b,
  }
}

// Server-side char-width estimation (no canvas)
// Count visual display width (emoji=2, Latin=1, CJK=2, wide=2)
function visualLen(text: string): number {
  let w = 0
  for (const ch of [...text]) {
    const cp = ch.codePointAt(0) ?? 0
    // True-wide CJK and full-width forms (2 cells in pixel grid)
    if ((cp >= 0x4E00  && cp <= 0x9FFF)  ||  // CJK unified ideographs
        (cp >= 0xF900  && cp <= 0xFAFF)  ||  // CJK compat
        (cp >= 0x3400  && cp <= 0x4DBF)  ||  // CJK Extension A
        (cp >= 0xAC00  && cp <= 0xD7AF)  ||  // Korean Hangul syllables
        (cp >= 0x3040  && cp <= 0x30FF)  ||  // Hiragana + Katakana
        (cp >= 0xFF01  && cp <= 0xFF60)  ||  // Fullwidth forms (！ＡＢＣ…)
        (cp >= 0x3000  && cp <= 0x303F)  ||  // CJK symbols & punctuation
        (cp >= 0x0E00  && cp <= 0x0E7F)) {   // Thai
      w += 1.8
    } else if ((cp >= 0x1F300 && cp <= 0x1FAFF) || cp > 0xFFFF) {
      // Emoji (modern) + astral — tend to be square
      w += 1.8
    } else if ((cp >= 0x2600  && cp <= 0x27BF)  ||  // misc symbols & dingbats
               (cp >= 0x2500  && cp <= 0x25FF)  ||  // box drawing / geometric
               (cp >= 0x2700  && cp <= 0x27BF)  ||  // dingbats
               (cp >= 0x2100  && cp <= 0x214F)  ||  // letterlike symbols
               (cp >= 0x2190  && cp <= 0x21FF)  ||  // arrows
               (cp >= 0x2200  && cp <= 0x22FF)) {   // math operators
      // Misc symbols: Press Start 2P renders these as 1-cell wide
      w += 1.0
    } else {
      w += 1
    }
  }
  return w
}
function cw(text: string, family: 'pixel' | 'mono', size: number): number {
  return visualLen(text) * size * (family === 'pixel' ? 1.02 : 0.605)
}

export interface SealOptions {
  address:       string
  nickname:      string
  fontSize?:     number
  darkMode?:     boolean
  showNickname?: boolean  // false = HEAD◆◆◆TAIL only (no nickname, no @)
}

export function generateIdentitySeal(opts: SealOptions): string {
  const { address, nickname, fontSize = 13, darkMode = true, showNickname = true } = opts
  const DK = darkMode

  const b36  = addressToBase36(address)
  const head = b36.slice(0, 4)
  const tail = b36.slice(12, 16)       // chars 12-15 = TAIL (last 4 of 16-char shortId)
  const hue  = idHue(address)
  const dna  = frameDNA(address)
  const n    = (nickname || 'anon').toLowerCase()
  const fs   = fontSize

  // ── Magical color palette ────────────────────────────────────────────
  const mc       = hsl(hue, DK ? 70 : 65, DK ? 72 : 38)       // main accent (richer)
  const mcBright = hsl(hue, 90, DK ? 82 : 50)                  // brightest spark
  const atCol    = DK ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.18)'
  const sepCol   = hsl(hue, DK ? 50 : 45, DK ? 45 : 58)        // separator diamonds
  const nickCol  = DK ? '#f0efe8' : '#111110'
  const fp       = hsl(hue, DK ? 60 : 58, DK ? 62 : 44)        // frame primary
  const fs2      = hsl(hue, DK ? 45 : 42, DK ? 42 : 62)
  const ff       = hsl(hue, DK ? 35 : 32, DK ? 32 : 75)
  const tailFill = hsl(hue, DK ? 45 : 40, DK ? 10 : 94)        // tail card tinted fill
  const energyCol= hsl(hue, DK ? 60 : 55, DK ? 40 : 70)        // energy line color
  const glowBright = hsl(hue, 80, DK ? 58 : 48)                // nickname halo

  const nkF = `font-family="'Press Start 2P','Silkscreen',monospace" font-weight="900"`
  const mF  = `font-family="monospace" font-weight="500"`

  const nkFs = fs
  const mFs  = Math.round(fs * 1.1)

  // Text widths
  const nkW    = cw(n, 'pixel', nkFs)
  const atW    = cw('@', 'mono', mFs)
  const headW  = cw(head, 'mono', mFs)
  const tailTW = cw(tail, 'mono', mFs)   // tail text (no brackets)

  // Pixel-punk separator geometry (replaces ***)
  const sepSz  = Math.max(2, Math.round(fs * 0.22))   // diamond half-size
  const sepGap = Math.round(fs * 0.18)                // gap between diamond and line
  const sepLn  = Math.round(fs * 0.30)                // line segment length
  const sepW   = sepSz*6 + (sepGap + sepLn + sepGap) * 2  // total separator width

  // Tail frame dimensions
  const tFPx = Math.round(fs * 0.65)
  const tFPy = Math.round(fs * 0.4)
  const tFW  = tailTW + tFPx * 2
  const tFH  = mFs + tFPy * 2

  // Derived
  const sw   = Math.max(0.5, dna.strokeW * fs / 13)
  const swT  = sw * 0.6
  const cSz  = Math.round(tFH * dna.cornerSize)
  const tick = Math.round(fs * 0.15)
  const ds   = Math.max(1, Math.round(fs * 0.08))
  const ig   = dna.innerGap

  // Layout x positions
  const g    = Math.round(fs * 0.25)
  const pad  = Math.round(fs * 0.5)

  // When showNickname=false: HEAD starts at pad (no nickname, no @)
  const nickX = showNickname ? pad : pad
  const atX   = showNickname ? nickX + nkW + g : -999  // hidden off-screen
  const headX = showNickname ? atX + atW + g : pad
  const sepX  = headX + headW + g          // separator starts here
  const tFX   = sepX + sepW + g

  const W  = Math.ceil(tFX + tFW + pad)
  const H  = Math.round(Math.max(nkFs + pad * 2, tFH + pad * 2))
  const cy = H / 2
  const tFY = cy - tFH / 2

  // Nickname glow dimensions
  const glowW = nkW + Math.round(fs * 1.4)
  const glowH = nkFs + Math.round(fs * 1.1)
  const glowX = nickX - Math.round(fs * 0.6)

  // Sparkle positions (deterministic from DNA)
  const sparkles = [0,1,2].map(i => ({
    x: Math.round(nickX + (dna.b[20+i*3] % Math.max(1, Math.round(nkW+sepW))) ),
    y: Math.round(cy - glowH/3 + (dna.b[21+i*3] % Math.round(glowH * 0.8)) - glowH*0.1),
    r: 1 + (dna.b[22+i*3] % 2),
    op: 0.25 + (dna.b[23+i*3] % 30) / 100,
  }))

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:inline-block;vertical-align:middle">`

  // Filters
  svg += `<defs>`
  svg += `<filter id="nkglow" x="-50%" y="-80%" width="200%" height="260%"><feGaussianBlur in="SourceGraphic" stdDeviation="${Math.round(fs * 0.7)}" result="blur"/></filter>`
  svg += `<filter id="eglow" x="-5%" y="-200%" width="110%" height="500%"><feGaussianBlur in="SourceGraphic" stdDeviation="${Math.round(fs * 0.25)}" result="blur"/></filter>`
  svg += `</defs>`

  // ── Energy line ──────────────────────────────────────────────────────
  if (showNickname) {
    svg += `<line x1="${nickX}" y1="${cy}" x2="${tFX+tFW}" y2="${cy}" stroke="${energyCol}" stroke-width="${Math.max(0.4, fs*0.04)}" opacity="${DK?'.12':'.08'}" filter="url(#eglow)"/>`
    // ── Nickname glow halo ──────────────────────────────────────────────
    svg += `<ellipse cx="${glowX + glowW/2}" cy="${cy}" rx="${glowW/2}" ry="${glowH/2}" fill="${glowBright}" opacity="${DK ? '.22' : '.14'}" filter="url(#nkglow)"/>`
    // ── Sparkle micro-dots ──────────────────────────────────────────────
    sparkles.forEach(s => {
      svg += `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${mcBright}" opacity="${s.op}"/>`
    })
    // ── Nickname text ───────────────────────────────────────────────────
    svg += `<text x="${nickX}" y="${cy}" ${nkF} font-size="${nkFs}" fill="${nickCol}" dominant-baseline="central" letter-spacing="0.5">${n}</text>`
    // ── @ symbol ────────────────────────────────────────────────────────
    svg += `<text x="${atX}" y="${cy}" ${mF} font-size="${mFs}" fill="${atCol}" dominant-baseline="central">@</text>`
  }

  // ── HEAD ─────────────────────────────────────────────────────────────
  svg += `<text x="${headX}" y="${cy}" ${mF} font-size="${mFs}" fill="${mc}" dominant-baseline="central">${head}</text>`

  // ── Pixel-punk separator (3 diamonds + connecting lines) ──────────────
  const lw    = Math.max(0.5, fs * 0.06)
  const dPos  = [
    sepX + sepSz,
    sepX + sepSz + sepGap + sepLn + sepGap + sepSz*2,
    sepX + sepSz + 2*(sepGap + sepLn + sepGap) + sepSz*4,
  ]
  // Connecting lines
  svg += `<line x1="${dPos[0]+sepSz+sepGap}" y1="${cy}" x2="${dPos[1]-sepSz-sepGap}" y2="${cy}" stroke="${sepCol}" stroke-width="${lw}" stroke-linecap="round" opacity=".6"/>`
  svg += `<line x1="${dPos[1]+sepSz+sepGap}" y1="${cy}" x2="${dPos[2]-sepSz-sepGap}" y2="${cy}" stroke="${sepCol}" stroke-width="${lw}" stroke-linecap="round" opacity=".6"/>`
  // Diamonds — outer ring + inner fill for depth
  dPos.forEach((px, i) => {
    const scale = i === 1 ? 1.3 : 1
    const sz = sepSz * scale
    const op  = i===1?'.65':'.45', bop = i===1?'.35':'.2'
    const sh  = dna.sepShape
    if (sh === 'circle') {
      svg += `<circle cx="${px}" cy="${cy}" r="${sz}" fill="${sepCol}" opacity="${op}"/><circle cx="${px}" cy="${cy}" r="${sz*.5}" fill="${mcBright}" opacity="${bop}"/>`
    } else if (sh === 'star5') {
      const pts = Array.from({length:10},(_:unknown,j:number)=>{const a=(j*Math.PI/5)-Math.PI/2;const r=j%2===0?sz:sz*0.42;return `${px+Math.cos(a)*r},${cy+Math.sin(a)*r}`}).join(' ')
      svg += `<polygon points="${pts}" fill="${sepCol}" opacity="${op}"/>`
    } else if (sh === 'ellipseH') {
      svg += `<ellipse cx="${px}" cy="${cy}" rx="${sz*1.55}" ry="${sz*0.72}" fill="${sepCol}" opacity="${op}"/><ellipse cx="${px}" cy="${cy}" rx="${sz*0.8}" ry="${sz*0.36}" fill="${mcBright}" opacity="${bop}"/>`
    } else if (sh === 'leaf') {
      const d = `M${px} ${cy-sz} C${px+sz} ${cy-sz} ${px+sz} ${cy+sz} ${px} ${cy+sz} C${px-sz} ${cy+sz} ${px-sz} ${cy-sz} ${px} ${cy-sz} Z`
      svg += `<path d="${d}" fill="${sepCol}" opacity="${op}"/>`
    } else if (sh === 'drop') {
      const d = `M${px} ${cy-sz*1.25} C${px+sz*.85} ${cy-sz*.25} ${px+sz} ${cy+sz*.55} ${px} ${cy+sz} C${px-sz} ${cy+sz*.55} ${px-sz*.85} ${cy-sz*.25} ${px} ${cy-sz*1.25} Z`
      svg += `<path d="${d}" fill="${sepCol}" opacity="${op}"/>`
    } else if (sh === 'hexagon') {
      const hpts = Array.from({length:6},(_:unknown,j:number)=>{const a=j*Math.PI/3-Math.PI/6;return `${px+Math.cos(a)*sz},${cy+Math.sin(a)*sz}`}).join(' ')
      svg += `<polygon points="${hpts}" fill="${sepCol}" opacity="${op}"/>`
    } else if (sh === 'cross') {
      const arm = sz * 0.4
      svg += `<rect x="${px-sz}" y="${cy-arm}" width="${sz*2}" height="${arm*2}" fill="${sepCol}" opacity="${op}" rx="${arm*0.4}"/>`
      svg += `<rect x="${px-arm}" y="${cy-sz}" width="${arm*2}" height="${sz*2}" fill="${sepCol}" opacity="${op}" rx="${arm*0.4}"/>`
    } else if (sh === 'arrow') {
      svg += `<polygon points="${px-sz},${cy-sz*0.6} ${px},${cy-sz} ${px+sz},${cy} ${px},${cy+sz} ${px-sz},${cy+sz*0.6}" fill="${sepCol}" opacity="${op}"/>`
    } else if (sh === 'crescent') {
      svg += `<path d="M${px} ${cy-sz} A${sz} ${sz} 0 1 1 ${px} ${cy+sz} A${sz*0.65} ${sz*0.65} 0 1 0 ${px} ${cy-sz} Z" fill="${sepCol}" opacity="${op}"/>`
    } else if (sh === 'heart') {
      const hx = sz * 0.72
      svg += `<path d="M${px},${cy+sz} C${px-sz*1.4},${cy} ${px-sz*1.4},${cy-sz*0.8} ${px-hx},${cy-sz*0.8} C${px-hx*0.4},${cy-sz*1.3} ${px},${cy-sz*0.6} ${px},${cy-sz*0.6} C${px},${cy-sz*0.6} ${px+hx*0.4},${cy-sz*1.3} ${px+hx},${cy-sz*0.8} C${px+sz*1.4},${cy-sz*0.8} ${px+sz*1.4},${cy} ${px},${cy+sz} Z" fill="${sepCol}" opacity="${op}"/>`
    } else if (sh === 'shield') {
      svg += `<path d="M${px} ${cy-sz} L${px+sz} ${cy-sz*0.4} L${px+sz} ${cy+sz*0.2} Q${px+sz} ${cy+sz} ${px} ${cy+sz} Q${px-sz} ${cy+sz} ${px-sz} ${cy+sz*0.2} L${px-sz} ${cy-sz*0.4} Z" fill="${sepCol}" opacity="${op}"/>`
    } else { // diamond (default)
      svg += `<rect x="${px-sz}" y="${cy-sz}" width="${sz*2}" height="${sz*2}" fill="${sepCol}" opacity="${op}" transform="rotate(45 ${px} ${cy})"/>`
      svg += `<rect x="${px-sz*.5}" y="${cy-sz*.5}" width="${sz}" height="${sz}" fill="${mcBright}" opacity="${bop}" transform="rotate(45 ${px} ${cy})"/>`
    }
  })

  // ── Tail frame (DNA decorations) ──────────────────────────────────────

  // Frame shape
  const sh = dna.shape
  const fX = tFX, fY = tFY, fW = tFW, fH = tFH
  const rx = sh === 'round' ? Math.round(fH*.35) : sh === 'double' ? 2 : sh === 'sharp' ? 1 : 0
  // Tail card: always draw subtle tinted fill first
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
  } else { // double
    svg += `<rect x="${fX}" y="${fY}" width="${fW}" height="${fH}" rx="2" fill="none" stroke="${fp}" stroke-width="${sw}" opacity=".85"/>`
    svg += `<rect x="${fX+ig}" y="${fY+ig}" width="${fW-ig*2}" height="${fH-ig*2}" rx="1" fill="none" stroke="${fs2}" stroke-width="${swT}" opacity=".5"/>`
  }

  // Corners
  const co   = dna.corner
  const pts: [number,number][] = [[fX,fY],[fX+fW,fY],[fX+fW,fY+fH],[fX,fY+fH]]
  const dirs: [number,number][] = [[-1,-1],[1,-1],[1,1],[-1,1]]
  pts.forEach(([px,py], i) => {
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
    } else { // ring
      svg += `<circle cx="${px-dx*2}" cy="${py-dy*2}" r="${ds*2}" fill="none" stroke="${fp}" stroke-width="${swT}" opacity=".6"/>`
      svg += `<circle cx="${px-dx*2}" cy="${py-dy*2}" r="${ds*.8}" fill="${fp}" opacity=".5"/>`
    }
  })

  // Edge marks
  const edgeMarks = (pattern: string, x1: number, y1: number, x2: number, y2: number, count: number, isVert: boolean): string => {
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

  // Badge
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

  // Tail text (centered in frame, no brackets)
  svg += `<text x="${fX+fW/2}" y="${cy}" ${mF} font-size="${mFs}" fill="${mc}" text-anchor="middle" dominant-baseline="central">${tail}</text>`

  svg += `</svg>`
  return svg
}
