/**
 * Situations on the real catalogues: the toggles have to be the ones that
 * matter for the unit in front of you.
 *
 * Skipped unless WH40K_FIXTURES points at a directory holding `gs.json` and at
 * least one faction (see test/fixtures.ts).
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from '@/data/bsdata/parse'
import { discoverMarks } from './marks'
import { situationsForUnit } from './unitEffects'
import { SITUATIONS } from './situations'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
  type FixtureFaction,
} from '../../test/fixtures'
import type { GameUnit } from './types'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

describe.skipIf(!available)('situations offered on a real catalogue', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    it('offers a short, relevant row rather than all of them or none', () => {
      const gs = loadGameSystem()
      const parsed = parseCatalogue(gs, loadCatalogueOf(faction), loadLibrariesOf(faction))
      const marks = discoverMarks(parsed)
      // One detachment, as an army has: its rules speak for every unit it names.
      const detachmentNames = parsed.detachments.slice(0, 1).map((d) => d.name)

      const counts = parsed.datasheets.map((sheet) => {
        const unit = {
          id: 'u',
          name: sheet.name,
          entryId: sheet.id,
          marks: [],
          statuses: [],
          models: [],
          usedOnce: [],
        } as unknown as GameUnit
        return situationsForUnit({ unit, sheet, catalogue: parsed, detachmentNames, marks }).length
      })
      const withAny = counts.filter((n) => n > 0).length
      console.log(
        faction.name,
        'datasheets offering a situation:',
        withAny,
        'of',
        counts.length,
        '· most on one unit:',
        Math.max(...counts),
      )
      // The share of units offering *something* is a property of the codex,
      // not of this code: an army-wide rule about advancing puts that chip on
      // nearly every Ork datasheet, and rightly so. What must hold is that the
      // row discriminates — it is never the whole list, and a unit whose rules
      // mention none is offered none.
      expect(withAny).toBeGreaterThan(0)
      expect(counts.some((n) => n === 0)).toBe(true)
      expect(Math.max(...counts)).toBeLessThan(SITUATIONS.length)
    })
  })
})
