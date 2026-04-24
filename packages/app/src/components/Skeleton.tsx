/**
 * Skeleton shimmer + SlideIn animation components.
 */
import { useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

// ─── Global CSS (injected once) ──────────────────────────────────────────────
const CSS = `
@keyframes _sk_shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
@keyframes _sk_slide {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
.sk-bar {
  position: relative; overflow: hidden;
  border-radius: 6px;
  background: var(--sk-base, rgba(128,128,128,0.12));
}
.sk-bar::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--sk-hi, rgba(255,255,255,0.22)) 50%,
    transparent 100%);
  animation: _sk_shimmer 1.6s ease-in-out infinite;
}
.sk-page-in {
  animation: _sk_slide 0.38s cubic-bezier(.22,.68,0,1.2) both;
}
`
let injected = false
function injectCss() {
  if (injected || typeof document === 'undefined') return
  injected = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.appendChild(s)
}

// ─── Primitives ───────────────────────────────────────────────────────────────
export function SkeletonBar({ w = '100%', h = 14, r = 6, style }: {
  w?: string | number; h?: number; r?: number; style?: CSSProperties
}) {
  injectCss()
  return <div className="sk-bar" style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />
}

export function SkeletonCircle({ size = 36 }: { size?: number }) {
  injectCss()
  return <div className="sk-bar" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0 }} />
}

// ─── Compound pieces ─────────────────────────────────────────────────────────
function SkeletonListRow({ wide = false }: { wide?: boolean }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px' }}>
      <SkeletonCircle size={34} />
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
        <SkeletonBar w={wide ? '60%' : '50%'} h={13} />
        <SkeletonBar w="32%" h={10} />
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:5, alignItems:'flex-end' }}>
        <SkeletonBar w={52} h={13} />
        <SkeletonBar w={34} h={10} />
      </div>
    </div>
  )
}

function SkeletonListCard({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{
      background:'var(--surface)', border:'1px solid var(--border)',
      borderRadius:14, overflow:'hidden',
    }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ borderBottom: i < rows-1 ? '1px solid var(--border)' : 'none' }}>
          <SkeletonListRow wide={i % 2 === 0} />
        </div>
      ))}
    </div>
  )
}

function SkeletonStatsCard() {
  return (
    <div style={{
      background:'var(--surface)', border:'1px solid var(--border)',
      borderRadius:14, padding:'14px 16px',
      display:'grid', gridTemplateColumns:'1fr 1fr', gap:10,
    }}>
      {[0,1,2,3].map(i => (
        <div key={i} style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <SkeletonBar w="55%" h={10} />
          <SkeletonBar w="70%" h={22} r={6} />
        </div>
      ))}
    </div>
  )
}

// ─── Page-level skeletons ─────────────────────────────────────────────────────
export function SkeletonDashboard() {
  injectCss()
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'14px 16px' }}>
      {/* Identity card placeholder */}
      <div style={{
        background:'var(--surface)', border:'1px solid var(--border)',
        borderRadius:20, padding:'24px 20px',
        display:'flex', flexDirection:'column', gap:14, alignItems:'center',
      }}>
        <SkeletonCircle size={64} />
        <SkeletonBar w="45%" h={16} r={8} />
        <SkeletonBar w="60%" h={11} r={6} />
        <div style={{ display:'flex', gap:10, width:'100%', justifyContent:'center' }}>
          <SkeletonBar w={80} h={28} r={8} />
          <SkeletonBar w={80} h={28} r={8} />
        </div>
      </div>
      {/* Quick actions */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            background:'var(--surface)', border:'1px solid var(--border)',
            borderRadius:12, padding:'14px 8px',
            display:'flex', flexDirection:'column', alignItems:'center', gap:8,
          }}>
            <SkeletonCircle size={24} />
            <SkeletonBar w="60%" h={10} />
          </div>
        ))}
      </div>
      <SkeletonBar w="30%" h={11} style={{ marginLeft:2 }} />
      <SkeletonListCard rows={4} />
    </div>
  )
}

export function SkeletonHistory() {
  injectCss()
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, width:'100%', maxWidth:520 }}>
      {/* Tab bar */}
      <div style={{ display:'flex', gap:4 }}>
        {[70,55,70,70].map((w,i) => <SkeletonBar key={i} w={w} h={30} r={8} />)}
      </div>
      <SkeletonStatsCard />
      <SkeletonListCard rows={5} />
    </div>
  )
}

export function SkeletonInBox() {
  injectCss()
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, width:'100%', maxWidth:480 }}>
      <SkeletonBar w="40%" h={13} />
      <SkeletonListCard rows={4} />
      <SkeletonBar w="30%" h={11} style={{ marginTop:4, marginLeft:2 }} />
      <SkeletonListCard rows={3} />
    </div>
  )
}

export function SkeletonTransfer() {
  injectCss()
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, width:'100%', maxWidth:440, padding:'0 16px' }}>
      <SkeletonBar w="50%" h={13} />
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:16, display:'flex', flexDirection:'column', gap:10 }}>
        <SkeletonBar w="35%" h={11} />
        <SkeletonBar w="100%" h={44} r={10} />
      </div>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:16, display:'flex', flexDirection:'column', gap:10 }}>
        <SkeletonBar w="30%" h={11} />
        <SkeletonBar w="100%" h={52} r={10} />
      </div>
      <SkeletonBar w="100%" h={46} r={12} />
    </div>
  )
}

// ─── SlideIn wrapper ──────────────────────────────────────────────────────────
/**
 * Wraps children in a div that plays a slide-up fade-in animation on mount.
 * Use `delay` (ms) to stagger multiple elements.
 * Changing `key` on this component re-triggers the animation.
 */
export function SlideIn({
  children,
  delay = 0,
  style,
  className,
}: {
  children: ReactNode
  delay?: number
  style?: CSSProperties
  className?: string
}) {
  injectCss()
  return (
    <div
      className={`sk-page-in${className ? ' ' + className : ''}`}
      style={{ animationDelay: delay ? `${delay}ms` : undefined, ...style }}
    >
      {children}
    </div>
  )
}

/**
 * PageIn — wraps an entire page. Shows skeleton while loading,
 * slides content in when done.
 *
 * Usage:
 *   <PageIn loading={loading} skeleton={<SkeletonHistory />}>
 *     {/* real content *\/}
 *   </PageIn>
 */
export function PageIn({
  loading,
  skeleton,
  children,
  style,
}: {
  loading: boolean
  skeleton: ReactNode
  children: ReactNode
  style?: CSSProperties
}) {
  injectCss()
  // Use a counter key so every fresh load triggers re-animation
  const animKey = useRef(0)
  const prevLoading = useRef(loading)
  if (prevLoading.current && !loading) animKey.current++
  prevLoading.current = loading

  if (loading) return <>{skeleton}</>

  return (
    <div key={animKey.current} className="sk-page-in" style={style}>
      {children}
    </div>
  )
}
