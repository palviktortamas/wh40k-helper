/**
 * Every rule text of every real catalogue the fixtures offer, rendered and
 * plain-texted: no source mark may survive into what the owner reads
 * (fixture-gated, see src/data/live.test.ts).
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from '@/data/bsdata/parse'
import { plainText } from '@/reminders/heuristics'
import { parseMarked, unmarked } from './marked'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
} from '../../test/fixtures'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []
const LEAK = /\^\^|<\/?ins>|\*/

describe.skipIf(!available)('rules-text markup on a real catalogue', () => {
  describe.each(factions)('$name', (faction) => {
    it('leaves no source mark in rendered or plain text', () => {
      const catalogue = parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const texts = [
        ...catalogue.datasheets.flatMap((d) => d.abilities.map((a) => a.text)),
        ...catalogue.detachments.flatMap((d) => (d.rules ?? []).map((r) => r.text)),
        ...(catalogue.enhancements ?? []).map((e) => e.text),
      ].filter(Boolean)
      expect(texts.length).toBeGreaterThan(100)
      const leaks: string[] = []
      for (const text of texts) {
        const rendered = parseMarked(text)
          .map((p) => p.text)
          .join('')
        for (const out of [rendered, plainText(text), unmarked(text)])
          if (LEAK.test(out)) leaks.push(out.slice(0, 120))
      }
      expect(leaks).toEqual([])
    })
  })
})
