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
import { infer, plainText } from './heuristics'
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
      // A trigger means "there is a moment to act on". Most of a codex is
      // passive profile changes, so most rules *should* have none — but if
      // almost nothing did, the phase panel would be empty and useless.
      const withTrigger = all.filter((r) => r.trigger !== 'custom').length / all.length
      expect(withTrigger).toBeGreaterThan(0.2)
      expect(withTrigger).toBeLessThan(0.7)
      expect(all.some((r) => r.once === 'battle')).toBe(true)
      expect(all.every((r) => r.text.length > 0 && r.text.length <= 140)).toBe(true)

      // An ability that fires when a model dies is not a reminder: it happens
      // on its own, and it used to surface in whatever phase its text named.
      // Asked of the ability's whole text, not the one-line reminder, because
      // the trigger is often past the first sentence.
      const abilities = catalogue.datasheets
        .flatMap((d) => d.abilities)
        .concat(catalogue.detachments.flatMap((d) => d.rules ?? []))
      const onDeath = abilities.filter((a) =>
        /each time (a|this) (model|unit)\b[^.]{0,80}is destroyed/i.test(plainText(`${a.name}. ${a.text}`)),
      )
      // A rule that opens by naming its phase must land in that phase. This
      // caught rules whose *duration* ("until the end of the turn") was being
      // read as their trigger, which put them in the wrong panel entirely.
      const STATED: [RegExp, string][] = [
        [/^[^.]{0,60}\bin (?:your|the) command phase\b/i, 'command_phase'],
        [/^[^.]{0,60}\bin (?:your|the) movement phase\b/i, 'movement_phase'],
        [/^[^.]{0,60}\bin (?:your|the) shooting phase\b/i, 'shooting_phase'],
        [/^[^.]{0,60}\bin (?:your|the) charge phase\b/i, 'charge_phase'],
        [/^[^.]{0,60}\bin (?:your|the) fight phase\b/i, 'fight_phase'],
      ]
      const misfiled = abilities.flatMap((a) => {
        const says = STATED.find(([re]) => re.test(plainText(a.text)))?.[1]
        if (!says) return []
        const got = infer(a.name, a.text).trigger
        return got === says ? [] : [`${a.name}: says ${says}, got ${got}`]
      })
      console.log(faction.name, 'rules stating a phase, misfiled:', misfiled.length)
      expect(misfiled).toEqual([])

      // A passive rule is not useless — "attacks targeting this unit have -1 to
      // wound" is exactly what you need at the moment you are shot at — so
      // plenty stays on. What must not stay on is the half of a codex that is
      // settled before the first turn.
      const enabled = abilities.filter((a) => infer(a.name, a.text).enabled)
      console.log(faction.name, `enabled by default: ${enabled.length} of ${abilities.length}`)
      expect(enabled.length / abilities.length).toBeLessThan(0.6)

      // Rules about building the list can never be acted on at the table.
      const listBuilding = abilities.filter((a) =>
        /\b(muster armies|can be attached to the following)\b/i.test(plainText(a.text)),
      )
      console.log(faction.name, 'list-building rules:', listBuilding.length)
      expect(listBuilding.length).toBeGreaterThan(0)
      expect(listBuilding.filter((a) => infer(a.name, a.text).enabled)).toEqual([])

      const stillOn = onDeath.filter((a) => infer(a.name, a.text).enabled)
      console.log(faction.name, 'on-destruction abilities:', onDeath.length, '· still enabled:', stillOn.length)
      expect(onDeath.length).toBeGreaterThan(0)
      expect(stillOn.map((a) => a.name)).toEqual([])
    })
  })
})
