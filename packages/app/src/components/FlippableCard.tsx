/**
 * FlippableCard — CSS 3D flip wrapper
 * Front face (children[0]) and back face (children[1])
 */
import React, { useEffect, useRef } from 'react'
import { playCardFlip } from '../lib/sound'

interface Props {
  flipped:    boolean
  width?:     number
  height?:    number
  children:   [React.ReactNode, React.ReactNode]  // [front, back]
}

export function FlippableCard({ flipped, width = 360, height = 227, children }: Props) {
  // Play flip whoosh sound on flip state change (skip initial mount)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    playCardFlip()
  }, [flipped])
  return (
    <div style={{ perspective: 1200, width, height, flexShrink: 0 }}>
      <div style={{
        position:        'relative',
        width:           '100%',
        height:          '100%',
        transformStyle:  'preserve-3d',
        transition:      'transform 0.75s cubic-bezier(.4,0,.2,1)',
        transform:       flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}>
        {/* Front — iOS Safari needs explicit visibility toggle after flip */}
        <div style={{
          position: 'absolute', inset: 0,
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
          // After animation completes, fully hide front so nothing bleeds through on iOS
          visibility: flipped ? 'hidden' : 'visible',
          transition: flipped
            ? 'visibility 0s 0.38s'   // hide after half-flip (0.75s / 2)
            : 'visibility 0s 0s',     // show immediately when unflipping
        }}>
          {children[0]}
        </div>
        {/* Back */}
        <div style={{
          position: 'absolute', inset: 0,
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
          visibility: flipped ? 'visible' : 'hidden',
          transition: flipped
            ? 'visibility 0s 0s'      // show immediately when flipping
            : 'visibility 0s 0.38s',  // hide after half-flip
        }}>
          {children[1]}
        </div>
      </div>
    </div>
  )
}
