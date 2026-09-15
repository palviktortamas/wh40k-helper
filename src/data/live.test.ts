/**
 * Runs the parsers against real downloaded source files, once per faction the
 * fixtures directory offers. Skipped unless WH40K_FIXTURES points at a
 * directory holding `gs.json` and at least one faction (see test/fixtures.ts
 * for the two layouts).
 *
 * Those files are game data, so they live outside the repo — use the scratchpad
 * directory, never the working tree (see CLAUDE.md). CI has no fixtures, so
 * everything here must stay lazy: reading at collection time would throw before
 * the skip takes effect.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue as parseCatalogueRaw } from './bsdata/parse'
import { parseMfm } from './mfm/parse'
import { mergeMfm } from './link/merge'
import type { GameSystem, Catalogue } from './bsdata/schema'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
  loadMfmTextOf,
  type FixtureFaction,
} from '../../test/fixtures'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

describe.skipIf(!available)('live source files', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    const parseCatalogue = (gs: GameSystem, cat: Catalogue) =>
      parseCatalogueRaw(gs, cat, loadLibrariesOf(faction))
    const loadCatalogue = () => loadCatalogueOf(faction)
    const loadMfmText = () => loadMfmTextOf(faction)
    it('parses a catalogue into datasheets with stats and weapons', () => {
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogue())
      expect(parsed.datasheets.length).toBeGreaterThan(40)
      expect(parsed.detachments.length).toBeGreaterThan(5)
      expect(parsed.unsupported).toEqual([])

      // Nearly every datasheet should carry a stat line and at least one weapon;
      // a regression in profile collection shows up here first.
      const withStats = parsed.datasheets.filter((d) => d.stats.length > 0)
      const withWeapons = parsed.datasheets.filter((d) => d.weapons.length > 0)
      expect(withStats.length / parsed.datasheets.length).toBeGreaterThan(0.9)
      expect(withWeapons.length / parsed.datasheets.length).toBeGreaterThan(0.9)
    })

    it('finds detachment rules and enhancement text for the reminders (Phase 5)', () => {
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogue())
      const withRules = parsed.detachments.filter((d) => (d.rules ?? []).some((r) => r.text.length > 20))
      expect(withRules.length).toBe(parsed.detachments.length)
      expect((parsed.enhancements ?? []).length).toBeGreaterThan(10)
      const withText = (parsed.enhancements ?? []).filter((e) => e.text.length > 20)
      expect(withText.length / parsed.enhancements!.length).toBeGreaterThan(0.9)
    })

    it('does not mistake the roster configuration entry for a unit', () => {
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogue())
      expect(parsed.datasheets.every((d) => d.role !== 'Configuration')).toBe(true)
    })

    it('keeps the raw constraint graph for the constraint evaluator', () => {
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogue())
      expect(parsed.datasheets.some((d) => d.constraints.length > 0)).toBe(true)
      expect(parsed.datasheets.some((d) => d.associations.length > 0)).toBe(true)
    })

    it('merges the mirror and reports disagreements', () => {
      const text = loadMfmText()
      if (!text) return
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogue())
      const report = mergeMfm(parsed, parseMfm(text))

      // Every detachment of the faction's own file must join across sources, and
      // the great majority of its own datasheets; if either drops, name
      // normalisation has regressed. Imported library content (Legends
      // fortifications, a shared library's other factions) is not in the mirror.
      const own = parsed.datasheets.filter((d) => !d.library)
      const ownDetachments = parsed.detachments.filter((d) => !d.library)
      expect(report.matchedDetachments).toBeGreaterThanOrEqual(ownDetachments.length)
      expect(report.matchedDatasheets / own.length).toBeGreaterThan(0.85)
    })

    it('keeps every profile that carries rules text, whatever its type is called', () => {
      // A unit missing an ability is the one failure the owner cannot work
      // around at the table: the rule is simply not there to look up. So every
      // profile printed on a datasheet that holds rules text must come out as
      // an ability — including the types a codex invents for its psychic
      // powers, its aura tables and its D6 results. (Profiles reached only
      // through the shared option trees every datasheet links are another
      // matter: those are Crusade upgrades, not this unit's abilities.)
      const parsed = parseCatalogue(loadGameSystem(), loadCatalogue())
      type Node = {
        id?: string
        name?: string
        typeName?: string
        characteristics?: { name: string; $text?: string }[]
        profiles?: Node[]
        selectionEntries?: Node[]
        selectionEntryGroups?: Node[]
      }
      const printed = (entry: Node): string[] => [
        ...(entry.profiles ?? [])
          .filter((profile) => {
            const names = (profile.characteristics ?? []).map((c) => c.name.toLowerCase())
            if (names.includes('w') && names.includes('t')) return false
            if (names.includes('range') && names.includes('a')) return false
            if (names.includes('capacity')) return false
            return (profile.characteristics ?? []).some((c) => (c.$text ?? '').trim().length > 20)
          })
          .map((profile) => profile.name ?? ''),
        ...(entry.selectionEntries ?? []).flatMap(printed),
        ...(entry.selectionEntryGroups ?? []).flatMap(printed),
      ]
      const byId = new Map<string, Node>()
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return void node.forEach(walk)
        if (!node || typeof node !== 'object') return
        const entry = node as Node
        if (entry.id && (entry.profiles || entry.selectionEntries)) byId.set(entry.id, entry)
        for (const value of Object.values(node as Record<string, unknown>))
          if (value && typeof value === 'object') walk(value)
      }
      walk(loadCatalogue())

      const missing = parsed.datasheets.flatMap((sheet) => {
        const source = byId.get(sheet.id)
        if (!source) return []
        const have = new Set(sheet.abilities.map((a) => a.name))
        return printed(source)
          .filter((name) => name && !have.has(name))
          .map((name) => `${sheet.name}: ${name}`)
      })
      expect(missing).toEqual([])
    })

    it('parses fast enough to stay inside a single worker message', () => {
      const gs = loadGameSystem()
      const cat = loadCatalogue()
      const start = performance.now()
      parseCatalogue(gs, cat)
      expect(performance.now() - start).toBeLessThan(3000)
    })
  })
})
