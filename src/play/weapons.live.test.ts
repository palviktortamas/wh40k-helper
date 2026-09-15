/**
 * The weapons table, run against the real catalogues.
 *
 * Skipped unless WH40K_FIXTURES points at a directory holding `gs.json` and at
 * least one faction (see test/fixtures.ts). Those files are game data and live
 * outside the repo.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from '@/roster/resolve'
import { instantiate } from '@/roster/defaults'
import { modelGroups } from './snapshot'
import { weaponCounts } from './weapons'
import { parseCatalogue } from '@/data/bsdata/parse'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
  type FixtureFaction,
} from '../../test/fixtures'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

describe.skipIf(!available)('weapons on the real catalogues', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    it('never leaves a profile of a carried weapon among the options not taken', () => {
      // The bug this guards: one datasheet's rokkit launcha is written
      // "➤ Rokkit Launcha- Busta", without the space the other datasheets use.
      // That one profile fell out of its own weapon, so a Deffkopta's gun was
      // listed as an option it had not taken. The sources are hand-maintained;
      // the near-miss will happen again, in another faction, on another name.
      const gs = loadGameSystem()
      const cat = loadCatalogueOf(faction)
      const libraries = loadLibrariesOf(faction)
      const graph = buildGraph(gs, cat, libraries)
      const parsed = parseCatalogue(gs, cat, libraries)

      const orphans: string[] = []
      for (const id of new Set(graph.rootEntryIds)) {
        const entry = graph.resolve(id)
        const sheet = parsed.datasheets.find((d) => d.id === id)
        if (!entry || !sheet) continue
        const models = modelGroups(instantiate(entry), sheet)
        const carried = new Set(models.flatMap((g) => g.weapons.map((w) => fold(w.name))))
        if (carried.size === 0) continue
        const { rows } = weaponCounts({ models }, sheet)
        for (const row of rows) {
          if (row.count > 0) continue
          // A profile whose name opens with the name of a weapon a model is
          // holding is a profile of that weapon, whatever the source's spacing.
          const name = fold(row.profile.name.replace(/^[^\p{L}\p{N}]+\s/u, ''))
          if ([...carried].some((held) => name === held || name.startsWith(`${held} `)))
            orphans.push(`${sheet.name}: ${row.profile.name}`)
        }
      }
      expect(orphans).toEqual([])
    })
  })
})
