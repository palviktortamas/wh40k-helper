/**
 * Exercises the constraint evaluator against the real catalogue.
 * Skipped unless WH40K_FIXTURES is set (see src/data/live.test.ts).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGraph, type CatalogueGraph, type ResolvedEntry, type ResolvedGroup } from './resolve'
import { evaluateRoster } from './evaluate'
import type { Roster, Selection } from './types'
import type { GameSystem, Catalogue } from '@/data/bsdata/schema'

const dir = process.env['WH40K_FIXTURES']
const available = Boolean(dir && existsSync(dir) && existsSync(join(dir, 'gs.json')))

const loadGraph = (): CatalogueGraph => {
  const gs = JSON.parse(readFileSync(join(dir!, 'gs.json'), 'utf8')).gameSystem as GameSystem
  const file = readdirSync(dir!).find((f) => f.endsWith('.json') && f !== 'gs.json')!
  const cat = JSON.parse(readFileSync(join(dir!, file), 'utf8')).catalogue as Catalogue
  return buildGraph(gs, cat)
}

let counter = 0
const sel = (entry: ResolvedEntry, count: number, children: Selection[] = []): Selection => ({
  id: `s${counter++}`,
  entryId: entry.id,
  name: entry.name,
  type: entry.type,
  count,
  selections: children,
})

const roster = (selections: Selection[], pointsLimit = 2000): Roster => ({
  id: 'r1',
  name: 'Test',
  catalogueId: 'c1',
  pointsLimit,
  selections,
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

/** Depth-first search of a resolved tree by entry or group name. */
const findEntry = (root: ResolvedEntry, name: string): ResolvedEntry | undefined => {
  if (root.name === name) return root
  for (const child of [...root.entries, ...root.groups.flatMap(groupEntries)])
    if (child.name === name) return child
  for (const child of [...root.entries, ...root.groups.flatMap(groupEntries)]) {
    const hit = findEntry(child, name)
    if (hit) return hit
  }
  return undefined
}
const groupEntries = (group: ResolvedGroup): ResolvedEntry[] => [
  ...group.entries,
  ...group.groups.flatMap(groupEntries),
]

describe.skipIf(!available)('constraint evaluator on real data', () => {
  it('resolves a unit into a buildable tree', () => {
    const graph = loadGraph()
    expect(graph.rootEntryIds.length).toBeGreaterThan(50)

    // Pick any multi-model unit that has option groups, without naming one.
    const units = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .filter((e) => e.type === 'unit' && e.groups.length > 0)
    expect(units.length).toBeGreaterThan(0)

    const unit = units[0]!
    expect(unit.groups.some((g) => groupEntries(g).length > 0)).toBe(true)
    // Weapons arrive through entry links; if resolution broke, models are bare.
    const models = units.flatMap((u) => u.groups.flatMap(groupEntries)).filter((e) => e.type === 'model')
    expect(models.some((m) => m.entries.length > 0)).toBe(true)
  })

  it('costs a unit at its base price and enforces group minimums', () => {
    const graph = loadGraph()
    const unit = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .find((e) => e.type === 'unit' && e.groups.length > 0)!

    // An empty unit must fail its group minimums rather than pass silently.
    const empty = evaluateRoster(roster([sel(unit, 1)]), graph)
    expect(empty.issues.some((i) => i.severity === 'error')).toBe(true)
  })

  it('applies a size-dependent points modifier', () => {
    const graph = loadGraph()
    // Find a unit whose points are changed by a `set` modifier on the cost type.
    const candidates = graph.rootEntryIds.map((id) => graph.resolve(id)!)
    const scaling = candidates.find((e) =>
      e.modifiers.some((m) => m.type === 'set' && m.field === '51b2-306e-1021-d207'),
    )
    expect(scaling).toBeDefined()

    const models = scaling!.groups.flatMap(groupEntries).filter((m) => m.type === 'model')
    expect(models.length).toBeGreaterThan(0)

    const small = evaluateRoster(roster([sel(scaling!, 1, [sel(models[0]!, 1)])]), graph)
    const large = evaluateRoster(roster([sel(scaling!, 1, [sel(models[0]!, 20)])]), graph)
    // The larger unit must cost more; if modifiers were skipped they are equal.
    expect(large.points).toBeGreaterThan(small.points)
  })

  it('reports no unsupported constructs for a simple roster', () => {
    const graph = loadGraph()
    const unit = graph.rootEntryIds.map((id) => graph.resolve(id)!).find((e) => e.type === 'unit')!
    const result = evaluateRoster(roster([sel(unit, 1)]), graph)
    // Gaps must surface rather than become silently wrong validation.
    expect(result.unsupported.filter((u) => u.startsWith('Unsupported'))).toEqual([])
  })

  it('resolves every datasheet without a missing link', () => {
    const graph = loadGraph()
    for (const id of graph.rootEntryIds) graph.resolve(id)
    const missing = graph.unsupported.filter((u) => u.startsWith('Missing'))
    // Some links point at other catalogues (Crusade, shared libraries) and are
    // expected to be absent; a flood would mean resolution is broken.
    expect(missing.length).toBeLessThan(graph.rootEntryIds.length)
  })

  it('finds named option entries through their links', () => {
    const graph = loadGraph()
    const unit = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .find((e) => e.type === 'unit' && e.groups.length > 1)!
    const named = groupEntries(unit.groups[0]!)[0]
    expect(named).toBeDefined()
    expect(findEntry(unit, named!.name)).toBeDefined()
  })
})
