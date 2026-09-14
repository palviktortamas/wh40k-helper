/**
 * Unit size — taking a unit to its largest legal size in one move, and back.
 *
 * Growing a mob by hand means finding every model group it has. Boyz are
 * "9-18 Boyz" *and* "1-2 Nobz": pressing + on the troopers alone stops at 19
 * models, which already costs the 20-model price and still misses the bigger
 * special-weapon allowance the data grants at 20. So this fills them all.
 *
 * Size is the models **directly under the unit**. Weapon options hang off those
 * models, so a bigger mob is never a better-armed one: the loadout the owner
 * chose is left exactly as it was.
 *
 * Nothing here knows a unit's sizes. Growing asks the evaluator how much room
 * each model has and takes it, so whatever the data says — and whatever a
 * modifier has done to it — is what happens.
 */

import { analyseRoster } from './evaluate'
import { instantiate } from './defaults'
import type { CatalogueGraph } from './resolve'
import type { Roster, Selection } from './types'

/** Guards against a constraint graph that never settles. */
const MAX_PASSES = 24

/** The models directly under a unit — what "how big is it" means. */
export const modelCount = (unit: Selection): number =>
  unit.selections.filter((s) => s.type === 'model').reduce((sum, s) => sum + s.count, 0)

/** A one-unit roster, so the evaluator can be asked about a unit on its own. */
const probeRoster = (unit: Selection): Roster => ({
  id: 'probe',
  name: 'probe',
  catalogueId: 'probe',
  pointsLimit: 1_000_000,
  configuration: [],
  selections: [unit],
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 0 },
})

/** How many more copies of each direct model the data still allows. */
function roomPerModel(unit: Selection, graph: CatalogueGraph): Map<string, number> {
  const analysis = analyseRoster(probeRoster(unit), graph)
  const room = new Map<string, number>()
  for (const child of unit.selections) {
    if (child.type !== 'model') continue
    const own = analysis.headroom[child.id]
    const group =
      child.groupId === undefined ? undefined : analysis.groupHeadroom[`${unit.id}:${child.groupId}`]
    const limits = [own, group].filter((n): n is number => typeof n === 'number')
    room.set(child.id, limits.length > 0 ? Math.min(...limits) : 0)
  }
  return room
}

/** The smallest legal size, read off a freshly instantiated copy of the unit. */
function minimumCounts(unit: Selection, graph: CatalogueGraph): Map<string, number> {
  const entry = graph.resolve(unit.entryId)
  const counts = new Map<string, number>()
  if (!entry) return counts
  for (const child of instantiate(entry).selections) {
    if (child.type !== 'model') continue
    const key = `${child.entryId}:${child.groupId ?? ''}`
    counts.set(key, (counts.get(key) ?? 0) + child.count)
  }
  return counts
}

const withCounts = (unit: Selection, next: Map<string, number>): Selection => ({
  ...unit,
  selections: unit.selections.map((child) =>
    next.has(child.id) ? { ...child, count: next.get(child.id)! } : child,
  ),
})

/**
 * Resizes a unit to the largest or smallest size its data allows, leaving every
 * loadout choice untouched.
 */
export function withUnitSize(unit: Selection, graph: CatalogueGraph, size: 'min' | 'max'): Selection {
  if (size === 'min') {
    const minimums = minimumCounts(unit, graph)
    const next = new Map<string, number>()
    // Several selections can share one entry; the first carries the minimum and
    // the rest go to zero-but-kept-at-one, which the group minimum then governs.
    const used = new Set<string>()
    for (const child of unit.selections) {
      if (child.type !== 'model') continue
      const key = `${child.entryId}:${child.groupId ?? ''}`
      const floor = used.has(key) ? 1 : (minimums.get(key) ?? child.count)
      used.add(key)
      if (child.count !== floor) next.set(child.id, floor)
    }
    return next.size > 0 ? withCounts(unit, next) : unit
  }

  let current = unit
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const room = roomPerModel(current, graph)
    // One model at a time: room is shared, so taking all of it everywhere at
    // once would overshoot a group cap that two models draw on.
    const next = [...room.entries()].find(([, left]) => left > 0)
    if (!next) break
    const [id, left] = next
    current = {
      ...current,
      selections: current.selections.map((child) =>
        child.id === id ? { ...child, count: child.count + left } : child,
      ),
    }
  }
  return current
}

/** Whether this unit's size can change at all — a fixed unit shows no toggle. */
export function canResize(unit: Selection, graph: CatalogueGraph): boolean {
  if ([...roomPerModel(unit, graph).values()].some((room) => room > 0)) return true
  return modelCount(withUnitSize(unit, graph, 'min')) !== modelCount(unit)
}

/** Whether the unit is already as big as its data allows. */
export const isAtMaxSize = (unit: Selection, graph: CatalogueGraph): boolean =>
  [...roomPerModel(unit, graph).values()].every((room) => room <= 0)
