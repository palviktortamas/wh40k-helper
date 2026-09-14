import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { fillCompulsoryLoadouts, instantiate } from './defaults'
import type { Catalogue, GameSystem } from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'

// Invented data — the repo must contain no real game data.

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
      selectionEntries: [
        {
          id: 'e-trooper',
          name: 'Trooper',
          type: 'model',
          constraints: [{ id: 'c-min', type: 'min', value: 2, field: 'selections', scope: 'parent' }],
          selectionEntries: [
            {
              id: 'e-rifle',
              name: 'Rifle',
              type: 'upgrade',
              constraints: [{ id: 'c-rifle', type: 'min', value: 1, field: 'selections', scope: 'parent' }],
            },
            { id: 'e-scope', name: 'Scope', type: 'upgrade' },
          ],
        },
      ],
    },
  ],
  entryLinks: [{ id: 'l-squad', name: 'Squad', type: 'selectionEntry', targetId: 'e-squad' }],
}

const graph = buildGraph(gameSystem, catalogue)

describe('filling a loadout that went missing', () => {
  it('gives an empty model what its data calls compulsory, and nothing else', () => {
    const unit = instantiate(graph.resolve('e-squad')!)
    const trooper = unit.selections[0]!
    const stripped = { ...unit, selections: [{ ...trooper, selections: [], count: 4 }] }
    const filled = fillCompulsoryLoadouts(stripped, (id) => graph.resolve(id))
    expect(filled.selections[0]!.selections.map((s) => s.name)).toEqual(['Rifle'])
    // Same models, same id: the loadout is repaired, the unit is not rebuilt.
    expect(filled.selections[0]!.count).toBe(4)
    expect(filled.selections[0]!.id).toBe(trooper.id)
  })

  it('leaves a unit that is already equipped exactly as it is', () => {
    const unit = instantiate(graph.resolve('e-squad')!)
    expect(fillCompulsoryLoadouts(unit, (id) => graph.resolve(id))).toBe(unit)
  })
})
