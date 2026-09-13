/**
 * Roster persistence and the one place validation is run, so every screen sees
 * the same numbers.
 */

import { db } from '@/data/db'
import type { CatalogueRecord } from '@/data/db'
import { buildGraph, childOptions, type CatalogueGraph, type ResolvedEntry } from './resolve'
import { analyseRoster, type Analysis } from './evaluate'
import { coreChecks } from './coreChecks'
import { bareSelection, cloneSelection, newSelectionId } from './defaults'
import type { Roster, Selection, ValidationIssue } from './types'
import { walkSelections } from './types'
import type { Catalogue, GameSystem } from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'
import { WARLORD_CATEGORY } from './vocabulary'
import { recordDeletion } from '@/sync/client'

export type RosterSummary = Pick<Roster, 'id' | 'name' | 'catalogueId' | 'pointsLimit' | 'updatedAt'>

const newRosterId = () => `roster-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export function newRoster(catalogue: CatalogueRecord, name: string, pointsLimit: number): Roster {
  const now = Date.now()
  return {
    id: newRosterId(),
    name,
    catalogueId: catalogue.id,
    pointsLimit,
    configuration: [],
    selections: [],
    createdAt: now,
    updatedAt: now,
    builtWith: {
      bsdataRevision: catalogue.versions.bsdataRevision,
      ...(catalogue.versions.mfmVersion ? { mfmVersion: catalogue.versions.mfmVersion } : {}),
    },
  }
}

export const listRosters = (): Promise<Roster[]> =>
  db.rosters.orderBy('updatedAt').reverse().toArray()

export const getRoster = (id: string): Promise<Roster | undefined> => db.rosters.get(id)

export async function saveRoster(roster: Roster): Promise<void> {
  await db.rosters.put({ ...roster, updatedAt: Date.now() })
}

export async function deleteRoster(id: string): Promise<void> {
  await db.rosters.delete(id)
  // So a synced device deletes it too (spec §4.4).
  await recordDeletion('rosters', id)
}

export async function duplicateRoster(roster: Roster): Promise<Roster> {
  // Instance ids change, so leader attachments have to be re-pointed.
  const idMap = new Map<string, string>()
  const clone = (selection: Selection): Selection => {
    const copy = cloneSelection(selection)
    idMap.set(selection.id, copy.id)
    return copy
  }
  const selections = roster.selections.map(clone)
  for (const selection of selections) {
    if (selection.attachedTo) {
      const target = idMap.get(selection.attachedTo)
      if (target) selection.attachedTo = target
      else delete selection.attachedTo
    }
  }
  const copy: Roster = {
    ...roster,
    id: newRosterId(),
    name: `${roster.name} (copy)`,
    configuration: roster.configuration.map(cloneSelection),
    selections,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await db.rosters.put(copy)
  return copy
}

// --- catalogue graphs -------------------------------------------------------

const graphs = new Map<string, CatalogueGraph>()

/**
 * Builds (and caches) the resolved catalogue graph. Re-resolving a ~2 MB
 * catalogue on every keystroke would blow the <100 ms validation budget. The
 * key includes the revision, so a data update in the same session is not
 * validated against the old graph.
 */
export function graphFor(record: CatalogueRecord): CatalogueGraph {
  const key = `${record.id}@${record.revision}:${record.installedAt}`
  const cached = graphs.get(key)
  if (cached) return cached
  const gameSystem = (JSON.parse(record.raw.gameSystem) as { gameSystem: GameSystem }).gameSystem
  const catalogue = (JSON.parse(record.raw.catalogue) as { catalogue: Catalogue }).catalogue
  const graph = buildGraph(gameSystem, catalogue)
  graphs.clear()
  graphs.set(key, graph)
  return graph
}

export type Validation = Analysis & {
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  legal: boolean
}

export function validate(roster: Roster, graph: CatalogueGraph): Validation {
  const analysis = analyseRoster(roster, graph)
  const issues = [...analysis.issues, ...coreChecks(roster, analysis, graph)]
  const errors = issues.filter((i) => i.severity === 'error')
  return {
    ...analysis,
    issues,
    errors,
    warnings: issues.filter((i) => i.severity === 'warning'),
    legal: errors.length === 0,
  }
}

// --- configuration -----------------------------------------------------------

/**
 * Brings a roster up to the current shape: every configuration entry the data
 * offers is present as a selection, the battle size mirrors the points limit,
 * and anything the storage migration parked is converted. Idempotent; returns
 * the same object when nothing changed.
 */
export function normaliseRoster(roster: Roster, graph: CatalogueGraph): Roster {
  let next = roster
  const change = (patch: Partial<Roster>) => {
    next = { ...next, ...patch }
  }

  const configuration = [...next.configuration]
  let configChanged = false
  for (const id of graph.configurationEntryIds) {
    if (configuration.some((s) => s.entryId === id)) continue
    const entry = graph.resolve(id)
    // A leaf toggle ("Show Legends") is *on* by being present, so it is only
    // added when the user switches it on.
    if (!entry || isToggle(entry)) continue
    configuration.push(bareSelection(entry))
    configChanged = true
  }
  if (configChanged) change({ configuration })

  if (next.pendingDetachmentId) {
    const { pendingDetachmentId, ...rest } = next
    next = rest as Roster
    const updated = withDetachment(next, graph, pendingDetachmentId)
    if (updated !== next) next = updated
  }

  if (next.pendingWarlordSelectionId) {
    const { pendingWarlordSelectionId, ...rest } = next
    next = rest as Roster
    const updated = withWarlord(next, graph, pendingWarlordSelectionId)
    if (updated !== next) next = updated
  }

  const synced = withBattleSize(next, graph)
  if (synced !== next) next = synced

  return next
}

/** A configuration entry with nothing to choose inside it: present means switched on. */
export const isToggle = (entry: ResolvedEntry): boolean => childOptions(entry).length === 0

/** Switches a leaf configuration toggle on or off. */
export function withToggle(roster: Roster, graph: CatalogueGraph, entryId: string, on: boolean): Roster {
  const present = roster.configuration.find((s) => s.entryId === entryId)
  if (on === Boolean(present)) return roster
  if (!on) return { ...roster, configuration: roster.configuration.filter((s) => s !== present) }
  const entry = graph.resolve(entryId)
  if (!entry) return roster
  return { ...roster, configuration: [...roster.configuration, bareSelection(entry)] }
}

/** Detachment options: every entry in the configuration tree that costs Detachment Points. */
export function detachmentOptions(
  graph: CatalogueGraph,
): { entry: ResolvedEntry; groupId?: string; configEntryId: string }[] {
  const out: { entry: ResolvedEntry; groupId?: string; configEntryId: string }[] = []
  for (const id of graph.configurationEntryIds) {
    const entry = graph.resolve(id)
    if (!entry) continue
    for (const option of childOptions(entry)) {
      if ((option.entry.costs[COST_TYPE.detachmentPoints] ?? 0) > 0)
        out.push({
          entry: option.entry,
          ...(option.group ? { groupId: option.group.id } : {}),
          configEntryId: id,
        })
    }
  }
  return out.sort((a, b) => a.entry.name.localeCompare(b.entry.name))
}

/** Replaces the chosen detachment (or clears it when `entryId` is undefined). */
export function withDetachment(roster: Roster, graph: CatalogueGraph, entryId: string | undefined): Roster {
  const options = detachmentOptions(graph)
  const optionIds = new Set(options.map((o) => o.entry.id))
  const picked = entryId ? options.find((o) => o.entry.id === entryId) : undefined
  let changed = false
  const configuration = roster.configuration.map((config) => {
    const kept = config.selections.filter((s) => !optionIds.has(s.entryId))
    const add = picked && picked.configEntryId === config.entryId
    if (kept.length === config.selections.length && !add) return config
    changed = true
    return {
      ...config,
      selections: add ? [...kept, bareSelection(picked.entry, 1, picked.groupId)] : kept,
    }
  })
  return changed ? { ...roster, configuration } : roster
}

/** Nominates the unit with instance id `rootId` as Warlord, using the data's own upgrade. */
export function withWarlord(roster: Roster, graph: CatalogueGraph, rootId: string | undefined): Roster {
  const warlordCategory = [...graph.categories.values()].find((c) => c.name === WARLORD_CATEGORY)?.id
  if (!warlordCategory) return roster
  let changed = false
  const selections = roster.selections.map((unit) => {
    const entry = graph.resolve(unit.entryId)
    const option = entry
      ? childOptions(entry).find((o) => o.entry.categoryIds.includes(warlordCategory))
      : undefined
    const existing = unit.selections.filter((s) => option && s.entryId === option.entry.id)
    const wants = unit.id === rootId
    if (wants && existing.length > 0) return unit
    if (!wants && existing.length === 0) return unit
    if (wants && !option) return unit
    changed = true
    const rest = unit.selections.filter((s) => !existing.includes(s))
    return {
      ...unit,
      selections: wants && option ? [...rest, bareSelection(option.entry, 1, option.group?.id)] : rest,
    }
  })
  return changed ? { ...roster, selections } : roster
}

const NUMBER = /\d{3,5}/g

/**
 * Mirrors the points limit into the data's battle-size selection: the option
 * whose name carries the limit is picked, and any other limit goes through the
 * data's own "override" entry, whose count *is* the limit. That keeps the
 * catalogue's own points check and its size-dependent rules in step with the
 * number the user chose.
 */
export function withBattleSize(roster: Roster, graph: CatalogueGraph): Roster {
  const limit = roster.pointsLimit
  let changed = false
  const configuration = roster.configuration.map((config) => {
    const entry = graph.resolve(config.entryId)
    if (!entry) return config
    // The battle-size group is the one whose options name point limits.
    const group = entry.groups.find((g) =>
      g.entries.some((e) => (e.name.match(NUMBER) ?? []).length > 0),
    )
    if (!group) return config
    const sizes = group.entries
      .map((e) => ({ entry: e, value: Number((e.name.match(NUMBER) ?? [])[0] ?? NaN) }))
      .filter((s) => !Number.isNaN(s.value))
      .sort((a, b) => a.value - b.value)
    if (sizes.length === 0) return config
    const exact = sizes.find((s) => s.value === limit)
    const chosen = exact ?? [...sizes].reverse().find((s) => s.value <= limit) ?? sizes[0]!
    // The data's override switch: a child whose own child is a numeric entry
    // (a points value as a count, so its minimum is in the hundreds).
    const numericOf = (e: ResolvedEntry) =>
      e.entries.find((n) =>
        n.constraints.some((c) => c.type === 'min' && c.scope === 'parent' && c.value >= 100),
      )
    const override = entry.entries.find((e) => numericOf(e) !== undefined)

    const sizeIds = new Set(sizes.map((s) => s.entry.id))
    const current = config.selections.find((s) => sizeIds.has(s.entryId))
    const currentOverride = override ? config.selections.find((s) => s.entryId === override.id) : undefined
    const wantOverride = !exact && override !== undefined
    const overrideValue = currentOverride?.selections[0]?.count

    if (
      current?.entryId === chosen.entry.id &&
      Boolean(currentOverride) === wantOverride &&
      (!wantOverride || overrideValue === limit)
    )
      return config

    changed = true
    const rest = config.selections.filter(
      (s) => !sizeIds.has(s.entryId) && (!override || s.entryId !== override.id),
    )
    const next: Selection[] = [...rest, bareSelection(chosen.entry, 1, group.id)]
    if (wantOverride && override) {
      const numeric = numericOf(override)
      const flag = bareSelection(override, 1)
      if (numeric) flag.selections.push(bareSelection(numeric, limit))
      next.push(flag)
    }
    return { ...config, selections: next }
  })
  return changed ? { ...roster, configuration } : roster
}

// --- selection tree edits ---------------------------------------------------

/** Returns a new tree with `id` replaced by `next`, or removed when undefined. */
export function replaceSelection(
  selections: Selection[],
  id: string,
  next: Selection | undefined,
): Selection[] {
  const out: Selection[] = []
  for (const selection of selections) {
    if (selection.id === id) {
      if (next) out.push(next)
      continue
    }
    const children = replaceSelection(selection.selections, id, next)
    out.push(children === selection.selections ? selection : { ...selection, selections: children })
  }
  return out
}

/** Adds `child` under the selection with id `parentId`. */
export function addChild(
  selections: Selection[],
  parentId: string,
  child: Selection,
): Selection[] {
  return selections.map((selection) => {
    if (selection.id === parentId) {
      return { ...selection, selections: [...selection.selections, child] }
    }
    return { ...selection, selections: addChild(selection.selections, parentId, child) }
  })
}

export function moveSelection(selections: Selection[], id: string, delta: number): Selection[] {
  const index = selections.findIndex((s) => s.id === id)
  if (index === -1) return selections
  const target = index + delta
  if (target < 0 || target >= selections.length) return selections
  const next = [...selections]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved!)
  return next
}

/** Removes a root unit, detaching any leader that was joined to it. */
export function removeUnit(roster: Roster, id: string): Roster {
  const selections = replaceSelection(roster.selections, id, undefined).map((unit) => {
    if (unit.attachedTo !== id) return unit
    const { attachedTo, associationId, ...rest } = unit
    void attachedTo
    void associationId
    return rest
  })
  return { ...roster, selections }
}

export { cloneSelection, newSelectionId, walkSelections }
