/**
 * Mark discovery against the real catalogues (fixture-gated, see
 * src/data/live.test.ts). A synthetic fixture cannot tell us whether the
 * bold-capitals-versus-prose convention actually holds across a codex, which is
 * the whole basis of the discovery.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from '@/data/bsdata/parse'
import { discoverMarks, grantedMarks, invulnerableFrom, rulesAboutMark } from './marks'
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

describe.skipIf(!available)('marks on real data', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    it('finds the states the codex invents, and nothing absurd', () => {
      const catalogue = parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const marks = discoverMarks(catalogue)
      console.log(`${faction.name}: ${marks.length} marks — ${marks.map((m) => m.label).join(', ') || 'none'}`)

      // Whatever is found must read as a state: short, lower case, no keywords.
      for (const mark of marks) {
        expect(mark.label).toBe(mark.label.toLowerCase())
        expect(mark.label.split(' ').length).toBeLessThanOrEqual(3)
      }
      // A codex that invents none is legitimate; a codex that "invents" dozens
      // means the discrimination has broken. The exact number is data, not a
      // contract, so the bound is generous on purpose.
      expect(marks.length).toBeLessThan(12)
    })

    it('finds who grants each mark, and what it does', () => {
      const catalogue = parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const marks = discoverMarks(catalogue)
      if (marks.length === 0) return

      const abilities = [
        ...catalogue.datasheets.flatMap((d) => d.abilities),
        ...catalogue.detachments.flatMap((d) => d.rules ?? []),
        ...(catalogue.rules ?? []),
        ...(catalogue.enhancements ?? []),
      ]
      const grants = abilities.flatMap((a) => grantedMarks(a.text, marks).map((g) => ({ a, g })))
      const byScope = grants.reduce<Record<string, number>>((acc, { g }) => {
        acc[g.scope] = (acc[g.scope] ?? 0) + 1
        return acc
      }, {})
      console.log(`${faction.name}: ${grants.length} abilities grant a mark — ${JSON.stringify(byScope)}`)
      const withUntil = grants.filter(({ g }) => g.until)
      console.log(`   e.g. "${withUntil[0]?.g.until ?? '(no duration given)'}"`)

      // Something must grant each mark, or the app would show a state nobody
      // can enter.
      for (const mark of marks) {
        expect(grants.some(({ g }) => g.mark.key === mark.key)).toBe(true)
      }

      // And a unit that has the mark must be able to see what it does.
      const sheet = catalogue.datasheets.find((d) =>
        rulesAboutMark(catalogue, marks[0]!, [...d.keywords, ...d.factionKeywords], d.id).length > 0,
      )
      const effects = sheet
        ? rulesAboutMark(catalogue, marks[0]!, [...sheet.keywords, ...sheet.factionKeywords], sheet.id)
        : []
      console.log(`   a unit with "${marks[0]!.label}" reads ${effects.length} rule(s)`)
      expect(effects.length).toBeGreaterThan(0)
      const saves = effects.map((e) => invulnerableFrom(e.text)).filter((s) => s !== undefined)
      if (saves.length > 0) console.log(`   including an invulnerable save of ${saves[0]}+`)
    })
  })
})
