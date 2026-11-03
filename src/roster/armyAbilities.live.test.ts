/**
 * Detachment-granted abilities on the real catalogues. No names here: the test
 * asks the data for every ability it hides without a detachment and requires
 * each to name a detachment the catalogue offers — and to be gone from an army
 * that took none.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from '@/data/bsdata/parse'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
} from '../../test/fixtures'
import { abilitiesInArmy } from './armyAbilities'

describe.skipIf(!fixturesAvailable())('detachment-granted abilities on the real data', () => {
  for (const faction of fixturesAvailable() ? configuredFactions() : []) {
    it(`${faction.name}: each names a detachment, and an army without it lacks the rule`, () => {
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const detachments = new Set(parsed.detachments.map((d) => d.name))
      const granted = parsed.datasheets.flatMap((sheet) =>
        sheet.abilities.filter((a) => a.onlyWith).map((a) => ({ sheet, ability: a })),
      )
      expect(granted.length).toBeGreaterThan(0)
      for (const { sheet, ability } of granted) {
        expect(ability.onlyWith!.every((name) => detachments.has(name)), `${sheet.name}: ${ability.name}`).toBe(true)
        expect(abilitiesInArmy(sheet.abilities, [])).not.toContain(ability)
        expect(abilitiesInArmy(sheet.abilities, ability.onlyWith!)).toContain(ability)
      }
    })
  }
})
