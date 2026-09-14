/**
 * Runs the reminder heuristics over every real catalogue the fixtures offer
 * (fixture-gated, see src/data/live.test.ts). Guards the defaults against
 * silently degrading: most abilities must land on a real trigger, and
 * once-per-battle must be caught. Running per faction is the point — heuristics
 * tuned on one codex's phrasing tend to miss another's.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from '@/data/bsdata/parse'
import { remindersForCatalogue } from './derive'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
} from '../../test/fixtures'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

describe.skipIf(!available)('reminder heuristics on a real catalogue', () => {
  describe.each(factions)('$name', (faction) => {
    it('gives most rules a trigger and catches once-per-battle', () => {
      const catalogue = parseCatalogue(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const all = remindersForCatalogue(catalogue, new Map()).flatMap((g) => g.reminders)
      expect(all.length).toBeGreaterThan(100)
      const byTrigger: Record<string, number> = {}
      for (const r of all) byTrigger[r.trigger] = (byTrigger[r.trigger] ?? 0) + 1
      // Printed for the journal, never asserted on exact numbers — the data moves.
      console.log(faction.name, 'trigger histogram', byTrigger, 'once', all.filter((r) => r.once).length, 'enabled', all.filter((r) => r.enabled).length)
      expect(all.filter((r) => r.trigger !== 'custom').length / all.length).toBeGreaterThan(0.5)
      expect(all.some((r) => r.once === 'battle')).toBe(true)
      expect(all.every((r) => r.text.length > 0 && r.text.length <= 140)).toBe(true)
    })
  })
})
