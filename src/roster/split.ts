/**
 * Separating a multi-model pick so each model can be equipped differently.
 *
 * Two Nobz are one selection with `count: 2`, and anything hanging off it is
 * shared — which is right for "two Nobz, both with a big choppa" and useless
 * for "one with a power klaw, one with a kombi-skorcha". Splitting replaces the
 * one selection with as many selections of one as it held, each carrying its
 * own copy of the loadout, so the editor can then show a row per model.
 */

import { cloneSelection } from './defaults'
import type { Selection } from './types'

/**
 * Replaces the selection `id` — anywhere in `root`'s tree — with one selection
 * per copy it held. Returns `root` untouched when the id is not there or the
 * pick is already a single model.
 */
export function splitSelection(root: Selection, id: string): Selection {
  let changed = false

  const visit = (node: Selection): Selection => {
    const selections: Selection[] = []
    for (const child of node.selections) {
      if (child.id === id && child.count > 1) {
        changed = true
        // The first keeps its identity so anything pointing at it still works;
        // the rest are fresh copies, ids and all, or editing one would edit
        // every other.
        selections.push({ ...child, count: 1 })
        for (let copy = 1; copy < child.count; copy++) {
          selections.push({ ...cloneSelection(child), count: 1 })
        }
        continue
      }
      const visited = visit(child)
      selections.push(visited)
    }
    return changed ? { ...node, selections } : node
  }

  const next = visit(root)
  return changed ? next : root
}

/**
 * Above this many copies the separated rows stop being an editor and become a
 * wall — sixteen expandable loadouts on a phone helps nobody, and a big unit's
 * variation is what the data's own special-weapon entries are for.
 */
const MOST_WORTH_SEPARATING = 6

/** Whether this pick can be separated: a few models, and something to equip. */
export const canSplit = (selection: Selection, hasOptions: boolean): boolean =>
  selection.count > 1 && selection.count <= MOST_WORTH_SEPARATING && hasOptions

/** The shape of a selection, ignoring the ids that make copies distinct. */
const sameLoadout = (a: Selection, b: Selection): boolean => {
  if (a.entryId !== b.entryId || a.groupId !== b.groupId || a.count !== b.count) return false
  if (a.selections.length !== b.selections.length) return false
  return a.selections.every((child, index) => sameLoadout(child, b.selections[index]!))
}

/**
 * Puts separated copies back together, so splitting is not a one-way door.
 * Only copies equipped identically can merge — anything else would silently
 * throw away a loadout the owner chose. Returns `root` untouched otherwise.
 */
export function mergeSelection(root: Selection, id: string): Selection {
  let changed = false

  const visit = (node: Selection): Selection => {
    const target = node.selections.find((child) => child.id === id)
    if (target) {
      const twins = node.selections.filter((child) => sameLoadout(child, target))
      if (twins.length > 1) {
        changed = true
        const merged = { ...target, count: twins.reduce((sum, t) => sum + t.count, 0) }
        return {
          ...node,
          selections: node.selections.flatMap((child) =>
            child.id === target.id ? [merged] : twins.includes(child) ? [] : [child],
          ),
        }
      }
      return node
    }
    const selections = node.selections.map(visit)
    return selections.some((child, index) => child !== node.selections[index])
      ? { ...node, selections }
      : node
  }

  const next = visit(root)
  return changed ? next : root
}
