/**
 * Runs the parsers against real downloaded source files. Skipped unless
 * WH40K_FIXTURES points at a directory holding `gs.json`, a catalogue `.json`
 * and its `.yaml` MFM counterpart.
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
import { fixturesAvailable, loadCatalogue, loadGameSystem, loadLibraries, loadMfmText } from '../../test/fixtures'

const available = fixturesAvailable()
const parseCatalogue = (gs: GameSystem, cat: Catalogue) => parseCatalogueRaw(gs, cat, loadLibraries())

describe.skipIf(!available)('live source files', () => {
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

  it('parses fast enough to stay inside a single worker message', () => {
    const gs = loadGameSystem()
    const cat = loadCatalogue()
    const start = performance.now()
    parseCatalogue(gs, cat)
    expect(performance.now() - start).toBeLessThan(3000)
  })
})
