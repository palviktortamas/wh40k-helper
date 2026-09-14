/**
 * What each unit in a roster is called on screen.
 *
 * Two mobs of the same datasheet are indistinguishable in a list — and in the
 * "attach to" picker, where choosing the wrong one is silent — so copies are
 * numbered. The number is derived from the roster, never stored: delete the
 * first of three and the rest renumber, so "#1" always means "the first one in
 * the list" rather than "the one added first, years ago".
 *
 * An owner's own name always wins and is never numbered.
 */

import type { Roster, Selection } from './types'

/** The owner's name for a unit, if they gave it one. */
export const customNameOf = (unit: Selection): string | undefined => {
  const name = unit.customName?.trim()
  return name ? name : undefined
}

/**
 * Display name per root selection id. Copies of one datasheet are numbered in
 * list order; a datasheet appearing once keeps its plain name.
 */
export function unitNames(roster: Roster): Map<string, string> {
  const copies = new Map<string, number>()
  for (const unit of roster.selections) copies.set(unit.entryId, (copies.get(unit.entryId) ?? 0) + 1)

  const seen = new Map<string, number>()
  const names = new Map<string, string>()
  for (const unit of roster.selections) {
    // A renamed copy still counts towards its datasheet's numbering, so the
    // others keep the number their position implies.
    const ordinal = (seen.get(unit.entryId) ?? 0) + 1
    seen.set(unit.entryId, ordinal)
    const custom = customNameOf(unit)
    if (custom) {
      names.set(unit.id, custom)
      continue
    }
    names.set(unit.id, (copies.get(unit.entryId) ?? 0) > 1 ? `${unit.name} #${ordinal}` : unit.name)
  }
  return names
}

/** One unit's display name, for the places that hold a single selection. */
export const unitName = (roster: Roster, unit: Selection): string =>
  unitNames(roster).get(unit.id) ?? customNameOf(unit) ?? unit.name
