/**
 * Opening a screen should land at its top.
 *
 * The app scrolls an inner element (the shell's `<main>`), not the document, so
 * `window.scrollTo` does nothing: pushing a new screen left the old scroll
 * position, and a unit opened from halfway down the army list appeared already
 * scrolled past its stat line — the reason you opened it.
 *
 * The scrolling ancestor is found rather than named, so this keeps working if
 * the shell's layout changes.
 */

/** The element that actually scrolls around `from`, when there is one. */
export function scrollParent(from: Element | null): Element | null {
  for (let el = from?.parentElement ?? null; el; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) return el
  }
  return null
}

/** Scrolls whatever actually scrolls around `from` back to the top. */
export function scrollToTop(from: Element | null): void {
  const el = scrollParent(from)
  if (el) el.scrollTop = 0
  else window.scrollTo({ top: 0 })
}
