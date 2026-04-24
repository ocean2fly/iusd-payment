/**
 * pressable.ts — give every clickable DOM element a tactile press response.
 *
 * Strategy:
 *   1. CSS rules in index.css handle `<button>` and `[role="button"]` via
 *      `:active` (filter + transform + tap-highlight off).
 *   2. This helper adds the same feel to plain `<div onClick>` / `<a>` /
 *      `<span>` that happen to be interactive, by listening to pointerdown
 *      and flashing the element with the same style.
 *   3. Opt out with `data-no-press="true"`.
 */

const PRESS_CLASS = 'ipay-pressing'

// Detect an element that should be treated as clickable.
function isInteractive(el: HTMLElement): boolean {
  if (!el) return false
  // Explicit opt-out
  if (el.dataset?.noPress === 'true') return false
  // Buttons / role=button already handled by CSS — skip so we don't stack
  if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') return false
  // Disabled check
  if ((el as any).disabled) return false
  // Element with onClick bound via React has no cheap way to detect, so we
  // rely on `style.cursor: pointer` or explicit .ipay-pressable class.
  if (el.classList.contains('ipay-pressable')) return true
  const cs = window.getComputedStyle(el)
  return cs.cursor === 'pointer'
}

export function installPressFeedback() {
  if (typeof document === 'undefined') return
  if ((installPressFeedback as any)._installed) return
  ;(installPressFeedback as any)._installed = true

  // Inject a stylesheet for the transient press class
  const style = document.createElement('style')
  style.textContent = `
    .${PRESS_CLASS} {
      filter: brightness(0.82) saturate(1.15) !important;
      transform: scale(0.97) !important;
      transition: filter 0.12s ease, transform 0.12s ease !important;
    }
  `
  document.head.appendChild(style)

  const PRESSED: WeakSet<HTMLElement> = new WeakSet()

  function release(el: HTMLElement) {
    if (!PRESSED.has(el)) return
    PRESSED.delete(el)
    el.classList.remove(PRESS_CLASS)
  }

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement | null
    if (!t) return
    // Walk up the tree looking for the nearest clickable ancestor
    let el: HTMLElement | null = t
    while (el && el !== document.body) {
      if (isInteractive(el)) break
      el = el.parentElement
    }
    if (!el || el === document.body) return
    PRESSED.add(el)
    el.classList.add(PRESS_CLASS)
  }, true)

  const cleanup = (e: Event) => {
    const t = e.target as HTMLElement | null
    if (!t) return
    // Walk up and release any pressed ancestor
    let el: HTMLElement | null = t
    while (el && el !== document.body) {
      if (PRESSED.has(el)) release(el)
      el = el.parentElement
    }
    // Safety: also release any stray elements after a short delay
    setTimeout(() => {
      document.querySelectorAll('.' + PRESS_CLASS).forEach(n => {
        (n as HTMLElement).classList.remove(PRESS_CLASS)
        PRESSED.delete(n as HTMLElement)
      })
    }, 200)
  }
  document.addEventListener('pointerup', cleanup, true)
  document.addEventListener('pointercancel', cleanup, true)
  document.addEventListener('pointerleave', cleanup, true)
}
