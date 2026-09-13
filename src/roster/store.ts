/**
 * Roster persistence and the one place validation is run, so every screen sees
 * the same numbers.
 */

import { db } from '@/data/db'
import type { CatalogueRecord } from '@/data/db'
import { buildGraph, type CatalogueGraph } from './resolve'
import { evaluateRoster, type EvaluationResult } from './evaluate'
import { coreChecks } from './coreChecks'
import { cloneSelection, newSelectionId } from './defaults'
import type { Roster, Selection, ValidationIssue } from './types'
import type { Catalogue, GameSystem } from '@/data/bsdata/schema'

export type RosterSummary = Pick<
  Roster,
  'id' | 'name' | 'catalogueId' | 'pointsLimit' | 'updatedAt' | 'detachmentId'
>

export function newRoster(catalogue: CatalogueRecord, name: string, pointsLimit: number): Roster {
  const now = Date.now()
  return {
    id: `roster-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    catalogueId: catalogue.id,
    pointsLimit,
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
}

export async function duplicateRoster(roster: Roster): Promise<Roster> {
  const copy: Roster = {
    ...roster,
    id: `roster-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${roster.name} (copy)`,
    selections: roster.selections.map(cloneSelection),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  // Instance ids changed, so a warlord reference by id would dangle.
  delete copy.warlordSelectionId
  await db.rosters.put(copy)
  return copy
}

// --- catalogue graphs -------------------------------------------------------

const graphs = new Map<string, CatalogueGraph>()

/**
 * Builds (and caches) the resolved catalogue graph. Re-resolving a ~2 MB
 * catalogue on every keystroke would blow the <100 ms validation budget.
 */
export function graphFor(record: CatalogueRecord): CatalogueGraph {
  const cached = graphs.get(record.id)
  if (cached) return cached
  const gameSystem = (JSON.parse(record.raw.gameSystem) as { gameSystem: GameSystem }).gameSystem
  const catalogue = (JSON.parse(record.raw.catalogue) as { catalogue: Catalogue }).catalogue
  const graph = buildGraph(gameSystem, catalogue)
  graphs.set(record.id, graph)
  return graph
}

export type Validation = EvaluationResult & {
  issues: ValidationIssue[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  legal: boolean
}

export function validate(roster: Roster, graph: CatalogueGraph): Validation {
  const evaluation = evaluateRoster(roster, graph)
  const issues = [...evaluation.issues, ...coreChecks(roster, evaluation)]
  const errors = issues.filter((i) => i.severity === 'error')
  return {
    ...evaluation,
    issues,
    errors,
    warnings: issues.filter((i) => i.severity === 'warning'),
    legal: errors.length === 0,
  }
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

export { cloneSelection, newSelectionId }
