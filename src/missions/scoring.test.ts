/**
 * Which scoring lines of a secondary apply in the mode being played.
 *
 * A card can price the same deed differently in Fixed and Tactical, and can
 * carry lines that exist only in one mode — so showing every line, or falling
 * back to the card's plain VP, puts the other mode's scoring in front of the
 * player mid-game.
 *
 * Invented cards — the repo holds no real mission content.
 */

import { describe, expect, it } from 'vitest'
import { linesForMode, vpForMode } from './scoring'
import type { ScoreLine } from './types'

const line = (text: string, vp: Partial<ScoreLine>): ScoreLine => ({
  text,
  cumulative: false,
  ...vp,
})

describe('linesForMode', () => {
  it('shows every line when the card scores the same either way', () => {
    const lines = [line('a', { vp: 2 }), line('b', { vp: 3 })]
    expect(linesForMode(lines, 'tactical').map((l) => l.text)).toEqual(['a', 'b'])
    expect(linesForMode(lines, 'fixed').map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('shows a line priced for both modes in both', () => {
    const lines = [line('a', { fixedVp: 4, tacticalVp: 5 })]
    expect(linesForMode(lines, 'tactical')).toHaveLength(1)
    expect(linesForMode(lines, 'fixed')).toHaveLength(1)
  })

  it('keeps a fixed-only line out of tactical, and the plain line out of fixed', () => {
    // The shape of a card that scores per-kill in Fixed and all-or-nothing in
    // Tactical: the priced lines are the Fixed ones, the plain line is the
    // Tactical one.
    const lines = [
      line('per character', { vp: 3, fixedVp: 3 }),
      line('per tough character', { vp: 1, fixedVp: 1 }),
      line('any character at all', { vp: 5 }),
    ]
    expect(linesForMode(lines, 'fixed').map((l) => l.text)).toEqual(['per character', 'per tough character'])
    expect(linesForMode(lines, 'tactical').map((l) => l.text)).toEqual(['any character at all'])
  })

  it('keeps a tactical-only line out of fixed', () => {
    const lines = [line('tactical deed', { tacticalVp: 5 }), line('either way', { vp: 2 })]
    expect(linesForMode(lines, 'tactical').map((l) => l.text)).toEqual(['tactical deed'])
    expect(linesForMode(lines, 'fixed').map((l) => l.text)).toEqual(['either way'])
  })
})

describe('vpForMode', () => {
  it('pays the mode’s own price when the line names one', () => {
    expect(vpForMode(line('a', { fixedVp: 4, tacticalVp: 5 }), 'fixed')).toBe(4)
    expect(vpForMode(line('a', { fixedVp: 4, tacticalVp: 5 }), 'tactical')).toBe(5)
  })

  it('falls back to the card’s plain value', () => {
    expect(vpForMode(line('a', { vp: 2 }), 'fixed')).toBe(2)
    expect(vpForMode(line('a', { vp: 2 }), 'tactical')).toBe(2)
  })

  it('reports no value for a line that only reads as text', () => {
    expect(vpForMode(line('a', {}), 'tactical')).toBeUndefined()
  })
})
