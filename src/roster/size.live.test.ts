/**
 * Resizing against the real catalogues (fixture-gated, see src/data/live.test.ts).
 *
 * This is the pair the owner actually hit: a mob grown only by its trooper
 * stepper stops one model short of full size, which already costs the full
 * price and still misses the larger special-weapon allowance the data grants at
 * full size. Reinforcing must reach it, and the allowance must follow.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph, type CatalogueGraph, type ResolvedEntry } from './resolve'
import { analyseRoster } from './evaluate'
import { instantiate } from './defaults'
import { modelCount, withUnitSize } from './size'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
  type FixtureFaction,
} from '../../test/fixtures'
import type { Roster, Selection } from './types'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

const roster = (unit: Selection): Roster => ({
  id: 'r',
  name: 'Test',
  catalogueId: 'c',
  pointsLimit: 2000,
  configuration: [],
  selections: [unit],
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

/** Room in each option group of a unit, by group name. */
const groupRoom = (unit: Selection, graph: CatalogueGraph): Map<string, number> => {
  const analysis = analyseRoster(roster(unit), graph)
  const out = new Map<string, number>()
  for (const [key, room] of Object.entries(analysis.groupHeadroom)) {
    const group = graph.groups.get(key.split(':')[1]!)
    if (group) out.set(group.name, Math.max(out.get(group.name) ?? 0, room))
  }
  return out
}

describe.skipIf(!available)('resizing on real data', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    const load = () => buildGraph(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))

    /** Units the data lets you grow — the ones the toggle is for. */
    const growable = (graph: CatalogueGraph): { entry: ResolvedEntry; unit: Selection }[] =>
      graph.rootEntryIds
        .map((id) => graph.resolve(id)!)
        .filter((e) => e.type === 'unit' && e.groups.length > 0)
        .map((entry) => ({ entry, unit: instantiate(entry) }))
        .filter(({ unit }) => modelCount(withUnitSize(unit, graph, 'max')) > modelCount(unit))

    /** Only what the unit itself is guilty of — the army around it is empty. */
    const unitErrors = (unit: Selection, graph: CatalogueGraph): string[] => {
      const ids = new Set<string>()
      const walk = (s: Selection) => {
        ids.add(s.id)
        s.selections.forEach(walk)
      }
      walk(unit)
      return analyseRoster(roster(unit), graph)
        .issues.filter((i) => i.severity === 'error' && i.selectionId && ids.has(i.selectionId))
        .map((i) => i.message)
    }

    it('grows every resizable unit without breaking a rule, and can go back', () => {
      const graph = load()
      const units = growable(graph)
      expect(units.length).toBeGreaterThan(0)

      let checked = 0
      for (const { unit } of units.slice(0, 25)) {
        // Some units are already complaining before anything is resized (a
        // Legends datasheet is hidden until its toggle is on). What matters is
        // that growing adds nothing new.
        const before = unitErrors(unit, graph)
        const big = withUnitSize(unit, graph, 'max')
        expect(modelCount(big)).toBeGreaterThan(modelCount(unit))
        expect(unitErrors(big, graph).filter((m) => !before.includes(m))).toEqual([])

        const small = withUnitSize(big, graph, 'min')
        expect(modelCount(small)).toBe(modelCount(unit))
        expect(unitErrors(small, graph).filter((m) => !before.includes(m))).toEqual([])
        checked++
      }
      console.log(`${faction.name}: grew and shrank ${checked} units cleanly`)
    })
  })

  // Whether an option allowance grows with unit size is a property of a
  // codex, not of every codex — Orks grant more special weapons to a full-size
  // mob, Necrons grant none. So this is asked of the fixtures as a whole: the
  // mechanism the toggle exists to reach has to be real somewhere.
  it('reaches a size that unlocks a bigger option allowance', () => {
    const gains: string[] = []
    for (const faction of factions) {
      const graph = buildGraph(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const units = graph.rootEntryIds
        .map((id) => graph.resolve(id)!)
        .filter((e) => e.type === 'unit' && e.groups.length > 0)
        .map((entry) => instantiate(entry))
        .filter((unit) => modelCount(withUnitSize(unit, graph, 'max')) > modelCount(unit))

      for (const unit of units.slice(0, 40)) {
        const before = groupRoom(unit, graph)
        const after = groupRoom(withUnitSize(unit, graph, 'max'), graph)
        for (const [name, room] of after) {
          if (room > (before.get(name) ?? 0)) {
            gains.push(`${faction.name}: ${name} ${before.get(name) ?? 0}→${room}`)
          }
        }
      }
    }
    console.log(`allowances that grow with size: ${gains.slice(0, 4).join(', ')}`)
    expect(gains.length).toBeGreaterThan(0)
  })
})
