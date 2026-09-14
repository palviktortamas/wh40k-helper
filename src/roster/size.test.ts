/**
 * Unit size: taking a unit to its largest legal size in one move, and back.
 *
 * A "reinforced" mob is not one group grown — Boyz are 18 Boyz **and** 2 Nobz,
 * and stopping at 19 models silently costs the full price while losing the
 * bigger weapon allowance the data grants at 20. So this fills every model
 * group the unit has.
 *
 * Invented units — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { analyseRoster } from './evaluate'
import { instantiate } from './defaults'
import { canResize, isAtMaxSize, modelCount, withUnitSize } from './size'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { Catalogue, GameSystem, SelectionEntry } from '@/data/bsdata/schema'
import type { Roster, Selection } from './types'

/** A mob of 9-18 troopers plus 1-2 bosses: ten models, or twenty. */
const mob: SelectionEntry = {
  id: 'e-mob',
  name: 'Mob',
  type: 'unit',
  categoryLinks: [{ id: 'cl-mob', targetId: 'cat-troop', primary: true }],
  costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 90 }],
  selectionEntryGroups: [
    {
      id: 'g-troopers',
      name: '9-18 Troopers',
      constraints: [
        { id: 'c-tr-min', type: 'min', value: 9, field: 'selections', scope: 'parent' },
        { id: 'c-tr-max', type: 'max', value: 18, field: 'selections', scope: 'parent' },
      ],
      selectionEntries: [
        {
          id: 'e-trooper',
          name: 'Trooper',
          type: 'model',
          constraints: [
            { id: 'c-t-min', type: 'min', value: 6, field: 'selections', scope: 'parent' },
            { id: 'c-t-max', type: 'max', value: 18, field: 'selections', scope: 'parent' },
          ],
          // Special weapons hang off the trooper. Growing the mob must not
          // help itself to these: size is not loadout.
          selectionEntryGroups: [
            {
              id: 'g-special',
              name: 'Special Weapons',
              constraints: [{ id: 'c-sp-max', type: 'max', value: 3, field: 'selections', scope: 'parent' }],
              selectionEntries: [
                { id: 'e-gunner', name: 'Trooper w/ Big gun', type: 'model' },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'g-bosses',
      name: '1-2 Bosses',
      constraints: [
        { id: 'c-b-min', type: 'min', value: 1, field: 'selections', scope: 'parent' },
        { id: 'c-b-max', type: 'max', value: 2, field: 'selections', scope: 'parent' },
      ],
      selectionEntries: [{ id: 'e-boss', name: 'Boss', type: 'model' }],
    },
  ],
}

/** A unit with no room to grow at all. */
const lone: SelectionEntry = {
  id: 'e-lone',
  name: 'Lone Hero',
  type: 'unit',
  categoryLinks: [{ id: 'cl-lone', targetId: 'cat-troop', primary: true }],
  costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 70 }],
  selectionEntryGroups: [
    {
      id: 'g-hero',
      name: 'Hero',
      constraints: [
        { id: 'c-h-min', type: 'min', value: 1, field: 'selections', scope: 'parent' },
        { id: 'c-h-max', type: 'max', value: 1, field: 'selections', scope: 'parent' },
      ],
      selectionEntries: [{ id: 'e-hero', name: 'Hero', type: 'model' }],
    },
  ],
}

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
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  sharedSelectionEntries: [mob, lone],
}

const graph = () => buildGraph(gameSystem, catalogue)

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

const aMob = () => instantiate(graph().resolve('e-mob')!)
const errorsIn = (unit: Selection): string[] =>
  analyseRoster(roster([unit]), graph())
    .issues.filter((i) => i.severity === 'error')
    .map((i) => i.message)

describe('modelCount', () => {
  it('counts the models directly under the unit', () => {
    expect(modelCount(aMob())).toBe(10)
  })
})

describe('withUnitSize', () => {
  it('fills every model group, not only the biggest one', () => {
    const grown = withUnitSize(aMob(), graph(), 'max')
    // 18 troopers *and* 2 bosses. Stopping at 19 is the trap this exists for.
    expect(modelCount(grown)).toBe(20)
    expect(errorsIn(grown)).toEqual([])
  })

  it('leaves the loadout alone — a bigger mob is not a better-armed one', () => {
    const grown = withUnitSize(aMob(), graph(), 'max')
    const gunners = grown.selections
      .flatMap((s) => s.selections)
      .filter((s) => s.entryId === 'e-gunner')
    expect(gunners).toEqual([])
  })

  it('goes back to the smallest legal size', () => {
    const grown = withUnitSize(aMob(), graph(), 'max')
    const shrunk = withUnitSize(grown, graph(), 'min')

    expect(modelCount(shrunk)).toBe(10)
    expect(errorsIn(shrunk)).toEqual([])
  })

  it('keeps the loadout the owner chose when resizing', () => {
    const withGun: Selection = {
      ...aMob(),
      selections: aMob().selections.map((child) =>
        child.entryId === 'e-trooper'
          ? {
              ...child,
              selections: [
                { id: 'g1', entryId: 'e-gunner', groupId: 'g-special', name: 'Trooper w/ Big gun', type: 'model' as const, count: 1, selections: [] },
              ],
            }
          : child,
      ),
    }
    const grown = withUnitSize(withGun, graph(), 'max')
    const kept = grown.selections.flatMap((s) => s.selections).filter((s) => s.entryId === 'e-gunner')
    expect(kept).toHaveLength(1)
  })

  it('does nothing to a unit that has only one legal size', () => {
    const hero = instantiate(graph().resolve('e-lone')!)
    expect(withUnitSize(hero, graph(), 'max')).toEqual(hero)
  })
})

describe('canResize and isAtMaxSize', () => {
  it('offers the toggle on a unit whose size can change', () => {
    expect(canResize(aMob(), graph())).toBe(true)
  })

  it('hides it on a unit of fixed size', () => {
    expect(canResize(instantiate(graph().resolve('e-lone')!), graph())).toBe(false)
  })

  it('knows an as-added mob is not at its maximum, and a grown one is', () => {
    expect(isAtMaxSize(aMob(), graph())).toBe(false)
    expect(isAtMaxSize(withUnitSize(aMob(), graph(), 'max'), graph())).toBe(true)
  })
})
