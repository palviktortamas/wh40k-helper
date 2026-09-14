import type { ReactNode } from 'react'
import './Units.css'

export type JumpTarget = {
  /** The id of the element to scroll to. */
  id: string
  /** The chip's text — two or three letters that read across a table. */
  label: string
  /** What it jumps to, for a screen reader. */
  name: string
}

/**
 * A toolbar at the top edge: the way back, then a chip per part of a long
 * screen. Both the game screen and the roster editor run to many screenfuls on
 * a phone, and scrolling them a thumb at a time is what the bar is for.
 *
 * Horizontal on purpose — a rail down the side takes a column from every screen
 * it sits on, which is the width a stat line and a unit's buttons actually
 * need. It scrolls sideways rather than wrapping when the chips outgrow a
 * narrow phone.
 */
export function JumpBar({ targets, children }: { targets: JumpTarget[]; children?: ReactNode }) {
  return (
    <div className="gamebar">
      {children}
      {targets.length > 1 && (
        <nav className="jump" aria-label="Jump to a part of this screen">
          {targets.map((target) => (
            <button
              key={target.id}
              className="jump__btn tap"
              aria-label={`Jump to ${target.name}`}
              onClick={() =>
                document.getElementById(target.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {target.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
