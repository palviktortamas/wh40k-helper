/**
 * The unit-size warning on the real catalogues: a unit at a size its datasheet
 * is not priced at is a unit one model short, costing the full price.
 *
 * Skipped unless WH40K_FIXTURES points at a directory holding `gs.json`, a
 * faction and its points mirror.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { instantiate } from './defaults'
import { evaluateRoster } from './evaluate'
import { coreChecks } from './coreChecks'
import { parseCatalogue } from '@/data/bsdata/parse'
import { parseMfm } from '@/data/mfm/parse'
import { mergeMfm } from '@/data/link/merge'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
  loadMfmTextOf,
  type FixtureFaction,
} from '../../test/fixtures'
import type { Roster, Selection } from './types'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

const rosterOf = (unit: Selection): Roster => ({
  id: 'r',
  name: 'r',
  catalogueId: 'cat',
  pointsLimit: 2000,
  configuration: [],
  selections: [unit],
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

describe.skipIf(!available)('unit sizes on a real catalogue', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    it('warns at a size the datasheet is not priced at, and not at one it is', () => {
      const gs = loadGameSystem()
      const cat = loadCatalogueOf(faction)
      const libraries = loadLibrariesOf(faction)
      const graph = buildGraph(gs, cat, libraries)
      const parsed = parseCatalogue(gs, cat, libraries)
      const mfm = loadMfmTextOf(faction)
      if (!mfm) return
      mergeMfm(parsed, parseMfm(mfm))

      // A datasheet with more than one size, taken at a size between two of them.
      const stepped = parsed.datasheets.find((sheet) => {
        const sizes = (sheet.pricing?.[0]?.costs ?? []).map((c) => c.models)
        return sizes.length > 1 && sizes[1]! - sizes[0]! > 1
      })
      expect(stepped).toBeDefined()
      const sizes = stepped!.pricing![0]!.costs.map((c) => c.models)

      const sizedTo = (n: number): Selection => {
        const unit = instantiate(graph.resolve(stepped!.id)!)
        const models = unit.selections.filter((s) => s.type === 'model')
        const others = models.slice(1).reduce((sum, m) => sum + m.count, 0)
        models[0]!.count = n - others
        return unit
      }
      const sizeIssues = (n: number) => {
        const unit = sizedTo(n)
        const roster = rosterOf(unit)
        return coreChecks(roster, evaluateRoster(roster, graph), graph, parsed.datasheets)
          .filter((i) => /the datasheet comes in/.test(i.message))
          .map((i) => i.message)
      }

      expect(sizeIssues(sizes[1]! - 1)).toHaveLength(1)
      expect(sizeIssues(sizes[0]!)).toEqual([])
      expect(sizeIssues(sizes[1]!)).toEqual([])
    })
  })
})
