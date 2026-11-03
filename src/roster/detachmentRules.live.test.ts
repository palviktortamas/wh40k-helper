/**
 * Detachment-rule scoping against the real catalogues (fixture-gated, see
 * src/data/live.test.ts). The codices spell the units a rule names three ways —
 * bold, plain capitals, `^^**X^^**` — and only the real text shows whether the
 * reader keeps up with a codex it was not written against.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from '@/data/bsdata/parse'
import { ruleAppliesTo, ruleScope, ruleTextFor } from './detachmentRules'
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

/** Words that are capitals in a rule's text without naming a unit: abilities, stats, the tag sentence. */
const MECHANICS = /^(?:AP|OC|CP|VP|BS|WS|D\d|\d*D\d|ASSAULT|HEAVY|PISTOL|BLAST|TORRENT|LANCE|PSYCHIC|BATTLELINE|IGNORES|COVER|ANTI.*|SUSTAINED|LETHAL|HITS|DEVASTATING|WOUNDS|RAPID|FIRE|MELTA|HAZARDOUS|PRECISION|TWIN.LINKED|LINKED)$/

/** Whether the text names a unit by keyword, judged without the reader under test. */
const namesUnits = (text: string): boolean => {
  const plain = text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\n.]*\b(?:has|have) the [A-Z]+ tag[^\n.]*\./g, ' ')
    .replace(/[^,.\n]*\bleading this unit/g, ' ')
  const phrase = /\b(?:friendly|your|an?|each|the)\s+(?:\^\^\*\*|\*\*)?([A-Za-z' ,/‑-]+?)(?:\^\^\*\*|\*\*)?\^?\^?\s+(?:units?|models?)\b/g
  for (const m of plain.matchAll(phrase)) {
    const words = (m[1] ?? '').split(/[\s/,]+/).filter(Boolean)
    if (words.length > 0 && words.every((w) => w === w.toUpperCase() && !MECHANICS.test(w) && w.length > 1)) return true
  }
  return /\^\^\*\*/.test(plain) || /\*\*[A-Z' /‑-]{3,}\*\*\s+(?:units?|models?)/.test(plain)
}

describe.skipIf(!available)('detachment rule scope on real data', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    const catalogue = () => parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))

    it('scopes every rule that names units, and leaves no silent army-wide fallback', () => {
      const unscoped: string[] = []
      for (const detachment of catalogue().detachments) {
        for (const rule of detachment.rules ?? []) {
          if (ruleScope(rule.text).include.length === 0 && namesUnits(rule.text)) {
            unscoped.push(`${detachment.name} / ${rule.name}`)
          }
        }
      }
      expect(unscoped).toEqual([])
    })

    it('gives each unit only the clauses that name it', () => {
      const c = catalogue()
      let scopedRules = 0
      for (const detachment of c.detachments) {
        for (const rule of detachment.rules ?? []) {
          const reached = c.datasheets.filter((sheet) => {
            const keywords = [...sheet.keywords, ...sheet.factionKeywords]
            const applies = ruleAppliesTo(rule.text, keywords)
            const text = ruleTextFor(rule.text, keywords)
            // The two readers agree about who the rule reaches, and a unit never gets text from a clause that names others.
            expect(text === undefined).toBe(applies === false)
            if (text !== undefined) expect(text.length).toBeLessThanOrEqual(rule.text.length)
            return applies === true
          })
          if (ruleScope(rule.text).include.length > 0) {
            scopedRules += 1
            // A scoped rule must not be silently army-wide: it reaches fewer units than the codex has.
            expect(reached.length, `${detachment.name} / ${rule.name}`).toBeLessThan(c.datasheets.length)
          }
        }
      }
      expect(scopedRules).toBeGreaterThan(0)
    })
  })
})
