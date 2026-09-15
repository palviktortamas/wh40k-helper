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

/**
 * What a whole option group is: a set of steppers, a one-of-N choice, or a
 * fixed list the data leaves nothing to decide about.
 *
 * The entry-level reading above only catches wargear whose *own* entry is
 * fixed — which is how a rank-and-file model's slugga and choppa are written.
 * Most of a character's loadout is written the other way round: a group that
 * must hold exactly one, with the alternatives inside it ("Weapon: Lord's
 * blade / Staff of light"). Rendered as a row of 0/1 steppers that is the same
 * lie in a different place — it reads as four optional weapons, when it is one
 * choice between four. On the two fixture factions the group form is 45 groups
 * and the entry form 374 entries, so neither can be skipped.
 *
 * `limit` is the evaluator's cap *after* modifiers, not the raw constraint: a
 * cap a rule raises ("one per ten models") is not a fixed choice, and reading
 * the raw number would freeze a group the data means to grow.
 */
export type GroupShape =
  /** Everything offered here is compulsory: state it, do not offer it. */
  | 'all'
  /** Exactly one of several: a choice, not a row of counters. */
  | 'one'
  /** Anything else — counts the player sets. */
  | 'many'

export function groupShape({
  min,
  limit,
  candidates,
}: {
  /** The group's minimum, 0 when it has none. */
  min: number
  /** The group's cap as the evaluator reads it, if any. */
  limit: number | undefined
  /** How many options the group actually offers here. */
  candidates: number
}): GroupShape {
  if (min <= 0 || limit !== min) return 'many'
  if (candidates <= min) return 'all'
  return min === 1 ? 'one' : 'many'
}
