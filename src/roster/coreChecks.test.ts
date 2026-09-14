import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { evaluateRoster } from './evaluate'
import { coreChecks } from './coreChecks'
import { instantiate } from './defaults'
import type { Catalogue, GameSystem } from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { Roster, Selection } from './types'

// Everything here is invented — the repo must contain no real game data.

const gameSystem: GameSystem = {
  id: 'gs',
  name: 'Test System',
  revision: 1,
  battleScribeVersion: '2.03',
  costTypes: [{ id: COST_TYPE.points, name: 'pts' }],
  categoryEntries: [{ id: 'cat-troop', name: 'Troop' }],
}

const catalogue: Catalogue = {
  id: 'cat',
  name: 'Test',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  sharedSelectionEntries: [
    {
      id: 'e-squad',
      name: 'Squad',
      type: 'unit',
      categoryLinks: [{ id: 'cl', targetId: 'cat-troop', primary: true }],
      costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 100 }],
      selectionEntries: [
        {
          id: 'e-trooper',
          name: 'Trooper',
          type: 'model',
          constraints: [{ id: 'c-min', type: 'min', value: 2, field: 'selections', scope: 'parent' }],
          // Its weapon is a choice, so a Trooper without one has chosen nothing.
          selectionEntries: [
            {
              id: 'e-rifle',
              name: 'Rifle',
              type: 'upgrade',
              constraints: [{ id: 'c-rifle', type: 'min', value: 1, field: 'selections', scope: 'parent' }],
            },
          ],
        },
        {
          // Its weapons are printed on the datasheet — nothing to choose, so
          // never a model to warn about.
          id: 'e-drone',
          name: 'Drone',
          type: 'model',
        },
      ],
    },
  ],
  entryLinks: [{ id: 'l-squad', name: 'Squad', type: 'selectionEntry', targetId: 'e-squad' }],
}

const graph = buildGraph(gameSystem, catalogue)

const rosterOf = (unit: Selection): Roster => ({
  id: 'r',
  name: 'Test',
  catalogueId: 'cat',
  pointsLimit: 100,
  configuration: [],
  selections: [unit],
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

const warnings = (unit: Selection): string[] => {
  const roster = rosterOf(unit)
  const evaluation = evaluateRoster(roster, graph)
  return coreChecks(roster, evaluation, graph)
    .filter((i) => i.severity === 'warning')
    .map((i) => i.message)
}

const unarmed = (messages: string[]) => messages.filter((m) => /no weapons or wargear/.test(m))

describe('models with nothing to fight with', () => {
  it('says so, by model type and count', () => {
    const unit = instantiate(graph.resolve('e-squad')!)
    const trooper = unit.selections.find((s) => s.name === 'Trooper')!
    // The weapons are gone — the shape a roster ends up in when a model is
    // added without its compulsory loadout.
    trooper.selections = []
    trooper.count = 3
    expect(unarmed(warnings(unit))).toEqual(['Squad: 3× Trooper have no weapons or wargear chosen.'])
  })

  it('says nothing when every model has something', () => {
    expect(unarmed(warnings(instantiate(graph.resolve('e-squad')!)))).toEqual([])
  })

  it('never warns about a model whose datasheet gives it no choice', () => {
    const unit = instantiate(graph.resolve('e-squad')!)
    unit.selections.push({
      id: 'drone',
      entryId: 'e-drone',
      name: 'Drone',
      type: 'model',
      count: 2,
      selections: [],
    })
    expect(unarmed(warnings(unit))).toEqual([])
  })
})
