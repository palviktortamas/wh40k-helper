/**
 * The bulleted grant ("ranged attacks have: - [X]. - If …, [Y].") on the real
 * catalogues. No names here: the test asks the data for every ability written
 * that way and requires each to yield a grant per bullet.
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
import { weaponGrants } from './grants'

const HEADING = /attacks have:\s*(?:\n|\s-\s)/i

describe.skipIf(!fixturesAvailable())('bulleted weapon grants on the real data', () => {
  for (const faction of fixturesAvailable() ? configuredFactions() : []) {
    it(`${faction.name}: every "attacks have:" list grants what its bullets name`, () => {
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const rules = parsed.datasheets.flatMap((sheet) =>
        sheet.abilities.filter((a) => HEADING.test(a.text)).map((a) => ({ name: a.name, text: a.text, source: sheet.name })),
      )
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) {
        const bracketed = rule.text.slice(rule.text.search(HEADING)).match(/\[[^\]]+\]/g) ?? []
        const grants = weaponGrants([rule])
        expect(grants.map((g) => `[${g.keyword}]`).sort(), `${rule.source}: ${rule.name}`).toEqual([...new Set(bracketed)].sort())
      }
    })
  }
})
