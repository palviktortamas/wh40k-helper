/**
 * The model-level and attachment rules on every real catalogue (fixture-gated,
 * see src/data/live.test.ts): a 3000-point army is not flagged for the battle
 * size the app chose, a Character keyword carried by a model counts for the
 * unit, a fresh add never opens on a required choice nobody could have made,
 * and every attachment the data defines can actually be made.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph, type ResolvedEntry } from './resolve'
import { analyseRoster } from './evaluate'
import { instantiate } from './defaults'
import { isToggle, normaliseRoster, validate, withToggle } from './store'
import { CHARACTER_CATEGORY } from './vocabulary'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
  type FixtureFaction,
} from '../../test/fixtures'
import type { Roster, Selection } from './types'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

const base = (pointsLimit: number): Roster => ({
  id: 'r',
  name: 'r',
  catalogueId: 'cat',
  pointsLimit,
  configuration: [],
  selections: [],
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

describe.skipIf(!available)('model-level rules on real data', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    const graph = () => buildGraph(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
    const units = (g: ReturnType<typeof graph>): ResolvedEntry[] => g.rootEntryIds.map((id) => g.resolve(id)!)

    it('does not call the battle size chosen for the points limit unavailable', () => {
      const g = graph()
      for (const limit of [1000, 2000, 3000]) {
        const roster = normaliseRoster(base(limit), g)
        const issues = analyseRoster(roster, g).issues.filter((i) => /not available/.test(i.message))
        expect(issues, `${limit} pts`).toEqual([])
      }
    })

    it('counts a unit as a Character when one of its models is', () => {
      const g = graph()
      const characterCategory = [...g.categories.values()].find((c) => c.name === CHARACTER_CATEGORY)!.id
      const hasCharacterModel = (e: ResolvedEntry): boolean =>
        [...e.entries, ...e.groups.flatMap(function all(gr): ResolvedEntry[] {
          return [...gr.entries, ...gr.groups.flatMap(all)]
        })].some((c) => (c.type === 'model' && c.categoryIds.includes(characterCategory)) || hasCharacterModel(c))
      const sneaky = units(g).filter((e) => !e.categoryIds.includes(characterCategory) && hasCharacterModel(e))
      for (const entry of sneaky) {
        const unit = instantiate(entry)
        // Model groups beyond the first are not always taken by default.
        const roster = { ...normaliseRoster(base(2000), g), selections: [unit] }
        const characters = analyseRoster(roster, g).characterSelectionIds
        const models = JSON.stringify(unit).includes('"type":"model"')
        if (models) expect(characters, entry.name).toContain(unit.id)
      }
    })

    it('opens no fresh unit on an unmade required choice', () => {
      const g = graph()
      let roster = normaliseRoster(base(3000), g)
      // Every datasheet the "show" toggles unlock is offered too.
      for (const id of g.configurationEntryIds) {
        const entry = g.resolve(id)!
        if (isToggle(entry)) roster = withToggle(roster, g, id, true)
      }
      const bad: string[] = []
      for (const entry of units(g)) {
        const unit: Selection = instantiate(entry)
        const v = validate({ ...roster, selections: [unit] }, g)
        // The army's own choices (detachment, disposition) are the user's to make.
        const ids = new Set<string>()
        const walk = (s: Selection) => {
          ids.add(s.id)
          s.selections.forEach(walk)
        }
        walk(unit)
        for (const issue of v.issues)
          if (
            issue.severity === 'error' &&
            issue.selectionId &&
            ids.has(issue.selectionId) &&
            /at least \d+ selections/.test(issue.message)
          )
            bad.push(`${entry.name}: ${issue.message}`)
      }
      expect(bad).toEqual([])
    })

    it('lets every association the data defines be made', () => {
      const g = graph()
      let roster = normaliseRoster(base(3000), g)
      for (const id of g.configurationEntryIds) {
        const entry = g.resolve(id)!
        if (isToggle(entry)) roster = withToggle(roster, g, id, true)
      }
      const selections = units(g).map((e) => instantiate(e))
      const analysis = analyseRoster({ ...roster, selections }, g)
      const stuck: string[] = []
      for (const unit of selections) {
        for (const target of analysis.leaderTargets(unit.id))
          if (target.targetIds.length === 0)
            stuck.push(`${unit.name} (${target.association.label ?? target.association.name})`)
      }
      expect(stuck).toEqual([])
    })
  })
})
