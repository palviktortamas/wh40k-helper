import { describe, expect, it } from 'vitest'
import { buildGraph, childOptions } from './resolve'
import { analyseRoster } from './evaluate'
import { parseCatalogue } from '@/data/bsdata/parse'
import type { Catalogue, GameSystem, SelectionEntry, SelectionEntryGroup } from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { Roster, Selection } from './types'

// Everything here is invented — the repo must contain no real game data.
// Phase 6: a faction whose units live in a linked library catalogue, and a
// shared option group hidden with `ancestor notInstanceOf <category>`.

const gameSystem: GameSystem = {
  id: 'gs',
  name: 'Test System',
  revision: 1,
  battleScribeVersion: '2.03',
  costTypes: [{ id: COST_TYPE.points, name: 'pts' }],
  categoryEntries: [
    { id: 'cat-troop', name: 'Troop' },
    { id: 'cat-hero', name: 'Hero' },
  ],
}

/** Perks may only be taken by a Hero — encoded on the group, against its owner. */
const perks: SelectionEntryGroup = {
  id: 'g-perks',
  name: 'Perks',
  modifiers: [
    {
      type: 'set',
      field: 'hidden',
      value: true,
      conditions: [
        { type: 'notInstanceOf', value: 1, field: 'selections', scope: 'ancestor', childId: 'cat-hero', shared: true },
      ],
    },
  ],
  selectionEntries: [
    { id: 'e-perk', name: 'Lucky charm', type: 'upgrade', costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 10 }] },
  ],
}

const hero: SelectionEntry = {
  id: 'e-hero',
  name: 'Hero',
  type: 'model',
  categoryLinks: [{ id: 'cl-h', targetId: 'cat-hero', primary: true }],
  costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 60 }],
  profiles: [{ id: 'p-h', name: 'Hero', typeId: 'pt-unit', typeName: 'Unit', characteristics: [{ name: 'W', typeId: 'ch-w', $text: '4' }] }],
  entryLinks: [{ id: 'l-perks-h', name: 'Perks', targetId: 'g-perks', type: 'selectionEntryGroup' }],
}

const squad: SelectionEntry = {
  id: 'e-squad',
  name: 'Squad',
  type: 'unit',
  categoryLinks: [{ id: 'cl-s', targetId: 'cat-troop', primary: true }],
  costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 80 }],
  profiles: [{ id: 'p-s', name: 'Squaddie', typeId: 'pt-unit', typeName: 'Unit', characteristics: [{ name: 'W', typeId: 'ch-w', $text: '1' }] }],
  entryLinks: [{ id: 'l-perks-s', name: 'Perks', targetId: 'g-perks', type: 'selectionEntryGroup' }],
}

/** The library holds everything; the faction catalogue is nothing but root links. */
const library: Catalogue = {
  id: 'lib',
  name: 'Test Library',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  library: true,
  sharedSelectionEntries: [hero, squad],
  sharedSelectionEntryGroups: [perks],
}

const faction: Catalogue = {
  id: 'cat',
  name: 'Test Faction',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  catalogueLinks: [{ id: 'cl', name: 'Test Library', targetId: 'lib', type: 'catalogue' }],
  entryLinks: [
    { id: 'rl-hero', name: 'Hero', targetId: 'e-hero', type: 'selectionEntry' },
    { id: 'rl-squad', name: 'Squad', targetId: 'e-squad', type: 'selectionEntry' },
  ],
}

let counter = 0
const sel = (entryId: string, name: string, type: Selection['type']): Selection => ({
  id: `s${counter++}`,
  entryId,
  name,
  type,
  count: 1,
  selections: [],
})

const roster = (selections: Selection[]): Roster => ({
  id: 'r',
  name: 'Test',
  catalogueId: 'cat',
  pointsLimit: 2000,
  configuration: [],
  selections,
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

describe('linked library catalogues', () => {
  it('finds the datasheets through the root entry links into the library', () => {
    const parsed = parseCatalogue(gameSystem, faction, [library])
    expect(parsed.datasheets.map((d) => d.name).sort()).toEqual(['Hero', 'Squad'])
    expect(parsed.datasheets.every((d) => d.library === 'Test Library')).toBe(true)
    expect(parsed.datasheets.find((d) => d.name === 'Hero')?.stats[0]?.w).toBe('4')
    // Without the library the catalogue is empty — which is what the app saw before Phase 6.
    expect(parseCatalogue(gameSystem, faction).datasheets).toEqual([])
  })

  it('builds the evaluator graph over the library and offers the roots', () => {
    const graph = buildGraph(gameSystem, faction, [library])
    expect(graph.rootEntryIds.sort()).toEqual(['e-hero', 'e-squad'])
    const heroEntry = graph.resolve('e-hero')!
    expect(childOptions(heroEntry).map((o) => o.entry.name)).toEqual(['Lucky charm'])
  })

  it('treats the owning selection as the first ancestor of its own option group', () => {
    const graph = buildGraph(gameSystem, faction, [library])
    const heroSel = sel('e-hero', 'Hero', 'model')
    const squadSel = sel('e-squad', 'Squad', 'unit')
    const analysis = analyseRoster(roster([heroSel, squadSel]), graph)
    const perkGroup = (id: string) => childOptions(graph.resolve(id)!)[0]!.group!
    // The Hero may take Perks; the Squad's copy of the group is hidden.
    expect(analysis.isGroupAvailable(heroSel.id, perkGroup('e-hero'))).toBe(true)
    expect(analysis.isGroupAvailable(squadSel.id, perkGroup('e-squad'))).toBe(false)
    const perk = childOptions(graph.resolve('e-hero')!)[0]!
    expect(analysis.isEntryAvailable(heroSel.id, perk.entry, perk.group)).toBe(true)
    expect(analysis.isEntryAvailable(squadSel.id, perk.entry, perkGroup('e-squad'))).toBe(false)
  })
})
