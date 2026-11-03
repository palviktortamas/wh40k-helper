/**
 * Points on the real catalogues: where the price list has bands, the roster's
 * unit points are the band's, whatever BSData says (spec §4.1). Skipped unless
 * WH40K_FIXTURES points at a directory holding `gs.json`, a faction and its
 * points mirror.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { instantiate } from './defaults'
import { evaluateRoster } from './evaluate'
import { validate } from './store'
import { mfmPriceOf } from './pricing'
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

const rosterOf = (selections: Selection[]): Roster => ({
  id: 'r',
  name: 'r',
  catalogueId: 'cat',
  pointsLimit: 3000,
  configuration: [],
  selections,
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

describe.skipIf(!available)('points from the price list on a real catalogue', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    it('prices every datasheet at every listed size as the manual does', () => {
      const gs = loadGameSystem()
      const cat = loadCatalogueOf(faction)
      const libraries = loadLibrariesOf(faction)
      const graph = buildGraph(gs, cat, libraries)
      const parsed = parseCatalogue(gs, cat, libraries)
      const mfm = loadMfmTextOf(faction)
      if (!mfm) return
      mergeMfm(parsed, parseMfm(mfm))

      const wrong: string[] = []
      let checked = 0
      let catalogueDisagrees = 0
      for (const sheet of parsed.datasheets) {
        const entry = graph.resolve(sheet.id)
        if (!entry || !sheet.pricing || sheet.pricing.length === 0) continue
        for (const cost of sheet.pricing[0]!.costs) {
          const unit = instantiate(entry)
          const models = unit.selections.filter((s) => s.type === 'model')
          if (models.length === 0) continue
          const others = models.slice(1).reduce((sum, m) => sum + m.count, 0)
          const first = cost.models - others
          if (first < 1) continue
          models[0]!.count = first
          const roster = rosterOf([unit])
          const bsdata = evaluateRoster(roster, graph).unitPoints[unit.id]
          const priced = validate(roster, graph, parsed.datasheets).unitPoints[unit.id]
          checked++
          if (bsdata !== cost.points) catalogueDisagrees++
          if (priced !== mfmPriceOf(sheet, cost.models, 1))
            wrong.push(`${sheet.name} x${cost.models}: ${priced} (manual ${cost.points})`)
        }
      }
      console.log(`${faction.name}: ${checked} priced sizes, catalogue disagrees at ${catalogueDisagrees}`)
      expect(checked).toBeGreaterThan(20)
      expect(wrong).toEqual([])
    })
  })
})
