/**
 * The 2026-11-03 parser findings on the real catalogues. No names: the test asks
 * the data for what it must not contain.
 */

import { describe, expect, it } from 'vitest'
import { damagedThreshold } from '@/play/snapshot'
import { parseCatalogue } from './parse'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
} from '../../../test/fixtures'

describe.skipIf(!fixturesAvailable())('parser audit findings on the real data', () => {
  for (const faction of fixturesAvailable() ? configuredFactions() : []) {
    const parsed = () => parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))

    it(`${faction.name}: attached-character abilities name a datasheet, or any`, () => {
      const p = parsed()
      const plain = (n: string) => n.replace(/\s*\[[^\]]+\]\s*$/, '')
      const sheetNames = new Set(p.datasheets.map((d) => plain(d.name)))
      const gated = p.datasheets.flatMap((d) => d.abilities.filter((a) => a.onlyWithAttached))
      expect(gated.length).toBeGreaterThan(0)
      for (const a of gated) for (const name of a.onlyWithAttached!) expect(sheetNames.has(plain(name)), a.name).toBe(true)
    })

    it(`${faction.name}: no unit lists one weapon twice, and no enhancement has empty text`, () => {
      const p = parsed()
      for (const d of p.datasheets) {
        const keys = d.weapons.map((w) => [w.kind, w.name, w.range, w.a, w.skill, w.s, w.ap, w.d].join('|'))
        expect(new Set(keys).size, d.name).toBe(keys.length)
      }
      expect((p.enhancements ?? []).filter((e) => !e.text).map((e) => e.name)).toEqual([])
    })

    it(`${faction.name}: every "Damaged" ability yields a threshold`, () => {
      for (const d of parsed().datasheets) {
        const damaged = d.abilities.filter((a) => /^damaged(:|\s+\d)/i.test(a.name))
        if (damaged.length > 0) expect(damagedThreshold(d.abilities), d.name).toBeDefined()
      }
    })
  }
})
