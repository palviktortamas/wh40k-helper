/**
 * Instantiating a catalogue entry as a roster selection.
 *
 * An entry is rarely complete on its own: a weapon combo has sub-groups that
 * each demand one choice, and a model has default wargear. Adding a unit without
 * filling those in would open the editor on a list of errors the user did not
 * cause, so required choices are taken automatically and the user overrides
 * them afterwards.
 */

import type { ResolvedEntry, ResolvedGroup } from './resolve'
import type { Selection } from './types'

let counter = 0
/** Instance ids only need to be unique within a roster. */
export const newSelectionId = (): string =>
  `sel-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** The minimum a constraint demands of this entry within its parent. */
const minimumFor = (entry: ResolvedEntry): number => {
  const min = entry.constraints.find((c) => c.type === 'min' && c.scope === 'parent')
  return min ? Math.max(0, min.value) : 0
}

const groupMinimum = (group: ResolvedGroup): number => {
  const min = group.constraints.find((c) => c.type === 'min' && c.scope === 'parent')
  return min ? Math.max(0, min.value) : 0
}

const groupMaximum = (group: ResolvedGroup): number | undefined => {
  const max = group.constraints.find((c) => c.type === 'max' && c.scope === 'parent')
  return max && max.value >= 0 ? max.value : undefined
}

/** A bare selection of `entry`, with no children taken. */
export function bareSelection(entry: ResolvedEntry, count = 1, groupId?: string): Selection {
  return {
    id: newSelectionId(),
    entryId: entry.id,
    ...(entry.linkId ? { linkId: entry.linkId } : {}),
    ...(groupId ? { groupId } : {}),
    name: entry.name,
    type: entry.type,
    count,
    selections: [],
  }
}

/**
 * Builds a selection for `entry`, recursively taking the choices its own data
 * says are mandatory. Depth is bounded for the same reason the resolver bounds
 * it: entry links can cycle.
 */
export function instantiate(entry: ResolvedEntry, count = 1, depth = 0): Selection {
  const selection = bareSelection(entry, count)
  if (depth > 6) return selection

  // Direct children that are required (min 1 on the entry itself) — default
  // wargear is modelled this way.
  for (const child of entry.entries) {
    if (child.hidden) continue
    const min = minimumFor(child)
    if (min > 0) selection.selections.push(instantiate(child, min, depth + 1))
  }

  for (const group of entry.groups) {
    if (group.hidden) continue
    selection.selections.push(...fillGroup(group, depth + 1))
  }

  return selection
}

/**
 * Satisfies a group's minimum by taking its default entry, or its first
 * selectable one. A group with no minimum is left empty for the user to choose.
 */
function fillGroup(group: ResolvedGroup, depth: number): Selection[] {
  const out: Selection[] = []
  const required = groupMinimum(group)
  const max = groupMaximum(group)
  // A group's own maximum caps everything below, so an entry that is
  // individually required can still be refused once the group is full.
  let budget = max ?? Number.POSITIVE_INFINITY
  const take = (child: Selection) => {
    if (child.count > budget) child.count = budget
    if (child.count <= 0) return
    budget -= child.count
    child.groupId = group.id
    out.push(child)
  }

  const candidates = group.entries.filter((e) => !e.hidden)
  if (required > 0 && candidates.length > 0) {
    const preferred = candidates.find((e) => e.id === group.defaultEntryId) ?? candidates[0]!
    take(instantiate(preferred, Math.max(1, required), depth))
  }

  // Entries that are individually required regardless of the group minimum.
  for (const candidate of candidates) {
    if (budget <= 0) break
    if (out.some((s) => s.entryId === candidate.id)) continue
    const min = minimumFor(candidate)
    if (min > 0) take(instantiate(candidate, min, depth))
  }

  for (const nested of group.groups) {
    if (nested.hidden) continue
    out.push(...fillGroup(nested, depth + 1))
  }

  return out
}

/**
 * Gives back every model in `unit` that has nothing chosen the loadout its own
 * data calls compulsory, and leaves everything else exactly as it is.
 *
 * A model that reached the roster without its wargear — an older build, an
 * import, an add that went wrong — is a model that rolls no dice, and finding
 * which of its options were the compulsory ones by hand is exactly the work
 * the app exists to avoid.
 */
export function fillCompulsoryLoadouts(
  unit: Selection,
  resolve: (entryId: string) => ResolvedEntry | undefined,
): Selection {
  let changed = false
  const visit = (node: Selection): Selection => {
    const selections = node.selections.map((child) => {
      if (child.type === 'model' && child.selections.length === 0) {
        const entry = resolve(child.entryId)
        if (entry && (entry.entries.length > 0 || entry.groups.length > 0)) {
          const filled = instantiate(entry, child.count)
          if (filled.selections.length > 0) {
            changed = true
            // The selection keeps its own id and count: it is the same models,
            // now holding what they were always meant to hold.
            return { ...child, selections: filled.selections }
          }
        }
      }
      return visit(child)
    })
    return changed ? { ...node, selections } : node
  }
  const next = visit(unit)
  return changed ? next : unit
}

/** Deep-copies a selection tree with fresh instance ids, for duplication. */
export function cloneSelection(selection: Selection): Selection {
  return {
    ...selection,
    id: newSelectionId(),
    selections: selection.selections.map(cloneSelection),
  }
}

/**
 * Whether an existing selection is the one an option row represents. Older
 * selections have no link id and match on entry (and group) alone.
 */
export function isSameOption(
  selection: Selection,
  entry: ResolvedEntry,
  groupId: string | undefined,
): boolean {
  if (selection.entryId !== entry.id) return false
  if (selection.linkId && entry.linkId) return selection.linkId === entry.linkId
  if (groupId && selection.groupId) return selection.groupId === groupId
  return true
}
