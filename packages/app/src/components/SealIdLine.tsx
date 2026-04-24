/**
 * SealIdLine — renders HEAD ◆—◆—◆ [TAIL_frame] in full Identity Seal style
 * Exact DNA port from packages/api/src/services/identity-seal.ts
 * No nickname, no @ — card-use only.
 */

import React from 'react'

// ── Helpers (mirrors identity-seal.ts) ───────────────────────────────────
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function bytes(addr: string, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(fnv(addr + i) & 0xff)
  return out
}
function idHue(addr: string) { return fnv(addr.toLowerCase()) % 360 }
function hsl(h: number, s: number, l: number, a = 1) {
  return a < 1 ? `hsla(${h},${s}%,${l}%,${a})` : `hsl(${h},${s}%,${l}%)`
}

const FRAME_SHAPES   = ['sharp','round','bracket','hexClip','double'] as const
const CORNER_STYLES  = ['tick','dot','diamond','cross','ring'] as const
const EDGE_PATTERNS  = ['dashes','dots','ticks','zigzag','none'] as const
const BADGE_TYPES    = ['topDot','corner','midLine','none','arc'] as const
const SEP_SHAPES     = ['diamond','circle','star5','ellipseH','leaf','drop',
                        'hexagon','cross','arrow','crescent','heart','shield'] as const

function frameDNA(addr: string) {
  const b = bytes(addr, 48)
  return {
    b,
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
  }
}

// Render one separator dot at (px, cy) with given radius and fill color
function SepDot({ shape, px, cy, sz, fill, op, bright, bop }: {
  shape: typeof SEP_SHAPES[number]
  px: number; cy: number; sz: number
  fill: string; op: string; bright: string; bop: string
}): React.ReactElement {
  if (shape === 'circle') return (
    <g>
      <circle cx={px} cy={cy} r={sz} fill={fill} opacity={op}/>
      <circle cx={px} cy={cy} r={sz*.5} fill={bright} opacity={bop}/>
    </g>
  )
  if (shape === 'star5') {
    const pts = Array.from({length:10},(_,i)=>{
      const a = (i*Math.PI/5) - Math.PI/2
      const r = i%2===0 ? sz : sz*0.42
      return `${px+Math.cos(a)*r},${cy+Math.sin(a)*r}`
    }).join(' ')
    return (
      <g>
        <polygon points={pts} fill={fill} opacity={op}/>
        <polygon points={pts} fill={bright} opacity={bop} transform={`scale(0.45) translate(${px*1.22} ${cy*1.22})`}/>
      </g>
    )
  }
  if (shape === 'ellipseH') return (
    <g>
      <ellipse cx={px} cy={cy} rx={sz*1.55} ry={sz*0.72} fill={fill} opacity={op}/>
      <ellipse cx={px} cy={cy} rx={sz*0.8} ry={sz*0.36} fill={bright} opacity={bop}/>
    </g>
  )
  if (shape === 'leaf') {
    const d = `M${px} ${cy-sz} C${px+sz} ${cy-sz} ${px+sz} ${cy+sz} ${px} ${cy+sz} C${px-sz} ${cy+sz} ${px-sz} ${cy-sz} ${px} ${cy-sz} Z`
    return (
      <g>
        <path d={d} fill={fill} opacity={op}/>
        <path d={d} fill={bright} opacity={bop} transform={`scale(0.5,0.5) translate(${px} ${cy})`}/>
      </g>
    )
  }
  if (shape === 'drop') {
    const d = `M${px} ${cy-sz*1.25} C${px+sz*0.85} ${cy-sz*0.25} ${px+sz} ${cy+sz*0.55} ${px} ${cy+sz} C${px-sz} ${cy+sz*0.55} ${px-sz*0.85} ${cy-sz*0.25} ${px} ${cy-sz*1.25} Z`
    return (
      <g>
        <path d={d} fill={fill} opacity={op}/>
        <path d={d} fill={bright} opacity={bop} transform={`scale(0.45,0.45) translate(${px*1.22} ${cy*1.22})`}/>
      </g>
    )
  }
  if (shape === 'hexagon') {
    const hpts = Array.from({length:6},(_,i)=>{const a=i*Math.PI/3-Math.PI/6;return `${px+Math.cos(a)*sz},${cy+Math.sin(a)*sz}`}).join(' ')
    return <g><polygon points={hpts} fill={fill} opacity={op}/></g>
  }
  if (shape === 'cross') {
    const arm = sz * 0.4
    return (
      <g>
        <rect x={px-sz} y={cy-arm} width={sz*2} height={arm*2} fill={fill} opacity={op} rx={arm*0.4}/>
        <rect x={px-arm} y={cy-sz} width={arm*2} height={sz*2} fill={fill} opacity={op} rx={arm*0.4}/>
      </g>
    )
  }
  if (shape === 'arrow') {
    return <g><polygon points={`${px-sz},${cy-sz*0.6} ${px},${cy-sz} ${px+sz},${cy} ${px},${cy+sz} ${px-sz},${cy+sz*0.6}`} fill={fill} opacity={op}/></g>
  }
  if (shape === 'crescent') {
    return <g><path d={`M${px} ${cy-sz} A${sz} ${sz} 0 1 1 ${px} ${cy+sz} A${sz*0.65} ${sz*0.65} 0 1 0 ${px} ${cy-sz} Z`} fill={fill} opacity={op}/></g>
  }
  if (shape === 'heart') {
    const hx = sz * 0.72
    return <g><path d={`M${px},${cy+sz} C${px-sz*1.4},${cy} ${px-sz*1.4},${cy-sz*0.8} ${px-hx},${cy-sz*0.8} C${px-hx*0.4},${cy-sz*1.3} ${px},${cy-sz*0.6} ${px},${cy-sz*0.6} C${px},${cy-sz*0.6} ${px+hx*0.4},${cy-sz*1.3} ${px+hx},${cy-sz*0.8} C${px+sz*1.4},${cy-sz*0.8} ${px+sz*1.4},${cy} ${px},${cy+sz} Z`} fill={fill} opacity={op}/></g>
  }
  if (shape === 'shield') {
    return <g><path d={`M${px} ${cy-sz} L${px+sz} ${cy-sz*0.4} L${px+sz} ${cy+sz*0.2} Q${px+sz} ${cy+sz} ${px} ${cy+sz} Q${px-sz} ${cy+sz} ${px-sz} ${cy+sz*0.2} L${px-sz} ${cy-sz*0.4} Z`} fill={fill} opacity={op}/></g>
  }
  // default: diamond
  return (
    <g>
      <rect x={px-sz} y={cy-sz} width={sz*2} height={sz*2} fill={fill} opacity={op} transform={`rotate(45 ${px} ${cy})`}/>
      <rect x={px-sz*.5} y={cy-sz*.5} width={sz} height={sz} fill={bright} opacity={bop} transform={`rotate(45 ${px} ${cy})`}/>
    </g>
  )
}

interface Props {
  address: string
  fontSize?: number
}

export function SealIdLine({ address, fontSize: fs = 13 }: Props) {
  const clean = address.replace(/^0x/i,'').replace(/[^0-9a-fA-F]/g,'').toLowerCase()
  const b36 = (() => {
    try { return BigInt('0x' + clean).toString(36).padStart(8, '0') } catch { return clean.padStart(8,'0').slice(-8) }
  })()
  const head = b36.slice(0, 4).toUpperCase()
  const tail = b36.slice(-3).toUpperCase()

  const dna  = frameDNA(address)
  const hue  = idHue(address)
  const DK   = true

  // Colors (dark mode only for card)
  const mc       = hsl(hue, DK ? 70 : 65, DK ? 72 : 38)
  const mcBright = hsl(hue, 90, DK ? 82 : 50)
  const sepCol   = hsl(hue, DK ? 50 : 45, DK ? 45 : 58)
  const fp       = hsl(hue, DK ? 60 : 58, DK ? 62 : 44)
  const fs2      = hsl(hue, DK ? 45 : 42, DK ? 42 : 62)
  const ff       = hsl(hue, DK ? 35 : 32, DK ? 32 : 75)
  const tailFill = hsl(hue, DK ? 45 : 40, DK ? 10 : 94)

  // Geometry
  const monoW    = fs * 0.605
  const headW    = Math.round(head.length * monoW)
  const tailW    = Math.round(tail.length * monoW)

  const sepSz  = Math.max(2, Math.round(fs * 0.22))
  const sepGap = Math.round(fs * 0.18)
  const sepLn  = Math.round(fs * 0.30)
  const sepW   = sepSz*6 + (sepGap + sepLn + sepGap) * 2

  const g     = Math.round(fs * 0.45)
  const tFPx  = Math.round(fs * 0.65)
  const tFW   = tailW + tFPx * 2
  const tFH   = Math.round(fs * 1.65)
  const H     = tFH + 4
  const cy    = H / 2

  const headX = 2
  const sepX  = headX + headW + g
  const tFX   = sepX + sepW + g
  const tFY   = cy - tFH / 2
  const W     = tFX + tFW + 4

  // Frame metrics
  const sw   = Math.max(0.5, dna.strokeW * fs / 13)
  const swT  = sw * 0.65
  const ds   = Math.max(1, Math.round(fs * 0.08))
  const cSz  = Math.round(tFH * dna.cornerSize)
  const tick = Math.round(tFH * 0.12)
  const ig   = dna.innerGap
  const sh   = dna.shape
  const fX   = tFX, fY = tFY, fW = tFW, fH = tFH

  // Separator diamond positions
  const dPos = [
    sepX + sepSz,
    sepX + sepSz + sepGap + sepLn + sepGap + sepSz*2,
    sepX + sepSz + 2*(sepGap + sepLn + sepGap) + sepSz*4,
  ]

  // Corner points
  const pts: [number,number][] = [[fX,fY],[fX+fW,fY],[fX+fW,fY+fH],[fX,fY+fH]]
  const dirs: [number,number][] = [[-1,-1],[1,-1],[1,1],[-1,1]]

  // Edge marks (same logic as server)
  function edgeMarks(pattern: string, x1: number, y1: number, x2: number, y2: number, count: number, isVert: boolean): React.ReactElement[] {
    const elems: React.ReactElement[] = []
    for (let i = 0; i < count; i++) {
      const t  = (i+1)/(count+1)
      const mx = x1+(x2-x1)*t
      const my = y1+(y2-y1)*t
      const jit = (dna.b[(i*7+3)%48]%4)-2
      const key = `em${x1}${y1}${i}`
      if (pattern === 'dashes') {
        if (isVert) elems.push(<line key={key} x1={mx-tick} y1={my+jit} x2={mx+tick} y2={my+jit} stroke={fs2} strokeWidth={swT} strokeLinecap="round" opacity=".45"/>)
        else        elems.push(<line key={key} x1={mx+jit} y1={my-tick} x2={mx+jit} y2={my+tick} stroke={fs2} strokeWidth={swT} strokeLinecap="round" opacity=".45"/>)
      } else if (pattern === 'dots') {
        elems.push(<circle key={key} cx={mx+jit*.5} cy={my+jit*.5} r={ds} fill={ff} opacity=".55"/>)
      } else if (pattern === 'ticks') {
        if (isVert) elems.push(<line key={key} x1={mx} y1={my} x2={mx+(tick*1.2)*(x1<fX+fW/2?-1:1)} y2={my} stroke={fs2} strokeWidth={swT} strokeLinecap="round" opacity=".4"/>)
        else        elems.push(<line key={key} x1={mx} y1={my} x2={mx} y2={my+(tick*1.2)*(y1<cy?-1:1)} stroke={fs2} strokeWidth={swT} strokeLinecap="round" opacity=".4"/>)
      } else if (pattern === 'zigzag') {
        const zs = tick*.8; const dir = i%2===0?1:-1
        if (isVert) elems.push(<line key={key} x1={mx-zs*dir} y1={my} x2={mx} y2={my} stroke={ff} strokeWidth={swT} opacity=".35"/>)
        else        elems.push(<line key={key} x1={mx} y1={my-zs*dir} x2={mx} y2={my} stroke={ff} strokeWidth={swT} opacity=".35"/>)
      }
    }
    return elems
  }

  // Frame fill
  const rx = sh==='round' ? Math.round(fH*.35) : sh==='double'||sh==='sharp' ? 2 : 0

  return (
    <div>
      <div style={{ fontSize: 6.5, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.3)', marginBottom: 6, fontFamily: 'system-ui,sans-serif' }}>ACCOUNT</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>

        {/* HEAD text */}
        <text x={headX} y={cy} fontFamily="monospace" fontSize={fs} fill={mc}
          dominantBaseline="central" letterSpacing="0.1em" opacity=".85">{head}</text>

        {/* Separator lines */}
        <line x1={dPos[0]+sepSz+sepGap} y1={cy} x2={dPos[1]-sepSz-sepGap} y2={cy} stroke={sepCol} strokeWidth="0.9" strokeLinecap="round" opacity=".6"/>
        <line x1={dPos[1]+sepSz+sepGap} y1={cy} x2={dPos[2]-sepSz-sepGap} y2={cy} stroke={sepCol} strokeWidth="0.9" strokeLinecap="round" opacity=".6"/>

        {/* Separator dots — shape from DNA */}
        {dPos.map((px, i) => {
          const scale = i===1 ? 1.3 : 1
          const sz = sepSz * scale
          return (
            <SepDot key={i} shape={dna.sepShape} px={px} cy={cy} sz={sz}
              fill={sepCol} op={i===1?'.65':'.45'}
              bright={mcBright} bop={i===1?'.35':'.2'}/>
          )
        })}

        {/* Tail frame fill */}
        {sh !== 'bracket' && sh !== 'hexClip' && (
          <rect x={fX} y={fY} width={fW} height={fH} rx={rx} fill={tailFill} opacity=".55"/>
        )}

        {/* Tail frame border */}
        {sh === 'sharp'  && <rect x={fX} y={fY} width={fW} height={fH} rx="1" fill="none" stroke={fp} strokeWidth={sw} opacity=".85"/>}
        {sh === 'round'  && <rect x={fX} y={fY} width={fW} height={fH} rx={Math.round(fH*.35)} fill="none" stroke={fp} strokeWidth={sw} opacity=".85"/>}
        {sh === 'double' && <>
          <rect x={fX} y={fY} width={fW} height={fH} rx="2" fill="none" stroke={fp} strokeWidth={sw} opacity=".85"/>
          <rect x={fX+ig} y={fY+ig} width={fW-ig*2} height={fH-ig*2} rx="1" fill="none" stroke={fs2} strokeWidth={swT} opacity=".5"/>
        </>}
        {sh === 'bracket' && <>
          <path d={`M${fX+Math.round(fH*.3)} ${fY}L${fX} ${fY}L${fX} ${fY+fH}L${fX+Math.round(fH*.3)} ${fY+fH}`} fill="none" stroke={fp} strokeWidth={sw} strokeLinecap="round" opacity=".85"/>
          <path d={`M${fX+fW-Math.round(fH*.3)} ${fY}L${fX+fW} ${fY}L${fX+fW} ${fY+fH}L${fX+fW-Math.round(fH*.3)} ${fY+fH}`} fill="none" stroke={fp} strokeWidth={sw} strokeLinecap="round" opacity=".85"/>
        </>}
        {sh === 'hexClip' && (() => {
          const hx = Math.round(fH*.25)
          return <path d={`M${fX+hx} ${fY}L${fX+fW-hx} ${fY}L${fX+fW} ${cy}L${fX+fW-hx} ${fY+fH}L${fX+hx} ${fY+fH}L${fX} ${cy}Z`} fill={tailFill} opacity=".55" stroke={fp} strokeWidth={sw} strokeLinejoin="round"/>
        })()}

        {/* Corner decorations */}
        {pts.map(([px,py], i) => {
          const [dx,dy] = dirs[i]
          const co = dna.corner
          if (co === 'tick') return (
            <g key={i}>
              <line x1={px} y1={py} x2={px-dx*cSz} y2={py} stroke={fp} strokeWidth={sw*1.2} strokeLinecap="round" opacity=".85"/>
              <line x1={px} y1={py} x2={px} y2={py-dy*cSz} stroke={fp} strokeWidth={sw*1.2} strokeLinecap="round" opacity=".85"/>
            </g>
          )
          if (co === 'dot') return <circle key={i} cx={px-dx*2} cy={py-dy*2} r={ds*1.8} fill={fp} opacity=".7"/>
          if (co === 'diamond') {
            const dd = ds*2.5
            return <rect key={i} x={px-dx*3-dd/2} y={py-dy*3-dd/2} width={dd} height={dd} fill="none" stroke={fp} strokeWidth={swT} opacity=".6" transform={`rotate(45 ${px-dx*3} ${py-dy*3})`}/>
          }
          if (co === 'cross') {
            const cc = cSz*.6
            return (
              <g key={i}>
                <line x1={px-dx-cc} y1={py-dy} x2={px-dx+cc} y2={py-dy} stroke={fp} strokeWidth={swT} strokeLinecap="round" opacity=".6"/>
                <line x1={px-dx} y1={py-dy-cc} x2={px-dx} y2={py-dy+cc} stroke={fp} strokeWidth={swT} strokeLinecap="round" opacity=".6"/>
              </g>
            )
          }
          // ring
          return (
            <g key={i}>
              <circle cx={px-dx*2} cy={py-dy*2} r={ds*2} fill="none" stroke={fp} strokeWidth={swT} opacity=".6"/>
              <circle cx={px-dx*2} cy={py-dy*2} r={ds*.8} fill={fp} opacity=".5"/>
            </g>
          )
        })}

        {/* Edge marks */}
        {edgeMarks(dna.topEdge,   fX,    fY,    fX+fW, fY,    dna.edgeDensity, false)}
        {edgeMarks(dna.botEdge,   fX,    fY+fH, fX+fW, fY+fH, dna.edgeDensity, false)}
        {edgeMarks(dna.sideDecor, fX,    fY,    fX,    fY+fH, dna.sideDots, true)}
        {edgeMarks(dna.sideDecor, fX+fW, fY,    fX+fW, fY+fH, dna.sideDots, true)}

        {/* TAIL text */}
        <text x={fX + fW/2} y={cy} fontFamily="monospace" fontSize={fs} fill={fp}
          textAnchor="middle" dominantBaseline="central" letterSpacing="0.12em" opacity=".92">{tail}</text>

      </svg>
    </div>
  )
}
