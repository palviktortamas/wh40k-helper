/**
 * Which of a secondary's scoring lines apply in the mode being played.
 *
 * A card can price the same deed differently in Fixed and Tactical, and can
 * carry lines that exist in only one of them: one card scores per enemy
 * character killed in Fixed, and all-or-nothing in Tactical, on the same face.
 * Showing every line puts the other mode's scoring in front of the player
 * mid-game, and paying the card's plain value for a line priced only for the
 * *other* mode pays the wrong number.
 *
 * The deck marks a line for a mode by giving it that mode's price, so that is
 * what decides. A line with no price of its own belongs to whichever mode the
 * card did not price explicitly — which is exactly how the printed cards read.
 */

import type { SecondaryMode } from '@/play/types'
import type { ScoreLine } from './types'

/** The value this line pays in `mode`, or undefined when it is only text. */
export const vpForMode = (line: ScoreLine, mode: SecondaryMode): number | undefined =>
  (mode === 'fixed' ? line.fixedVp : line.tacticalVp) ?? line.vp

/** The lines of one scoring block that apply in `mode`. */
export function linesForMode(lines: readonly ScoreLine[], mode: SecondaryMode): ScoreLine[] {
  const priced = (line: ScoreLine, m: SecondaryMode) =>
    (m === 'fixed' ? line.fixedVp : line.tacticalVp) !== undefined

  const own = lines.filter((line) => priced(line, mode))
  const other = lines.filter((line) => priced(line, mode === 'fixed' ? 'tactical' : 'fixed'))

  // Nothing on the card is mode-specific: it scores the same either way.
  if (own.length === 0 && other.length === 0) return [...lines]
  // This mode has its own priced lines — they are the whole of it.
  if (own.length > 0) return own
  // Only the other mode was priced, so what is left unpriced is this mode's.
  return lines.filter((line) => !priced(line, mode === 'fixed' ? 'tactical' : 'fixed'))
}
