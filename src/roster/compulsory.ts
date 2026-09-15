/**
 * Which parts of a loadout the data settles, and which it leaves to the player.
 *
 * A datasheet's wargear is a mix of the two: "every Boy carries a slugga and a
 * choppa" is not an option, "one in ten may take a rokkit launcha" is. BSData
 * writes both the same way — an entry with a min and a max — and the editor
 * used to render both as a 0-to-N stepper. That reads as though the compulsory
 * half were optional, and it *is* removable, which leaves a model with nothing
 * to roll and no hint of what it lost.
 *
 * Model counts are deliberately not settled here: how big a unit is has its own
 * rules, its own controls (size, Reinforced) and the constraint evaluator to
 * police it.
 */

import type { ResolvedEntry } from './resolve'

const limit = (entry: ResolvedEntry, type: 'min' | 'max'): number | undefined => {
  const found = entry.constraints.find((c) => c.type === type && c.scope === 'parent' && c.value >= 0)
  return found?.value
}

/** How many of this entry its parent must keep — 0 when the data asks for none. */
export const compulsoryCount = (entry: ResolvedEntry): number =>
  entry.type === 'model' ? 0 : (limit(entry, 'min') ?? 0)

/**
 * The data allows exactly one number here, so there is nothing to choose: the
 * editor states it rather than offering a stepper that cannot move.
 */
export const isFixedLoadout = (entry: ResolvedEntry): boolean => {
  const min = compulsoryCount(entry)
  return min > 0 && limit(entry, 'max') === min
}
