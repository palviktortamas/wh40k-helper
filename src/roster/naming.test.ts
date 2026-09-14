/**
 * Display names for the units of a roster. Two copies of one datasheet are
 * impossible to tell apart when attaching a leader, so duplicates are numbered;
 * the owner can override any of them.
 *
 * Invented units — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { unitNames } from './naming'
import { exportRosterText } from './export'
import { buildGraph } from './resolve'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { Catalogue, GameSystem } from '@/data/bsdata/schema'
import type { Validation } from './store'
import type { Roster, Selection } from './types'

let counter = 0
const unit = (entryId: string, name: string, customName?: string): Selection => ({
  id: `s${counter++}`,
  entryId,
  name,
  type: 'unit',
  count: 1,
  selections: [],
  ...(customName === undefined ? {} : { customName }),
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

const named = (r: Roster): string[] => {
  const names = unitNames(r)
  return r.selections.map((s) => names.get(s.id)!)
}

describe('unitNames', () => {
  it('leaves a datasheet that appears once unnumbered', () => {
    expect(named(roster([unit('e-mob', 'Mob'), unit('e-boss', 'Boss')]))).toEqual(['Mob', 'Boss'])
  })

  it('numbers duplicates in list order', () => {
    expect(named(roster([unit('e-mob', 'Mob'), unit('e-boss', 'Boss'), unit('e-mob', 'Mob')]))).toEqual([
      'Mob #1',
      'Boss',
      'Mob #2',
    ])
  })

  it('renumbers after one is removed, so the first in the list is always #1', () => {
    const three = roster([unit('e-mob', 'Mob'), unit('e-mob', 'Mob'), unit('e-mob', 'Mob')])
    expect(named(three)).toEqual(['Mob #1', 'Mob #2', 'Mob #3'])

    const two = { ...three, selections: three.selections.slice(1) }
    expect(named(two)).toEqual(['Mob #1', 'Mob #2'])
  })

  it('drops the numbers again when only one copy is left', () => {
    const two = roster([unit('e-mob', 'Mob'), unit('e-mob', 'Mob')])
    const one = { ...two, selections: two.selections.slice(0, 1) }
    expect(named(one)).toEqual(['Mob'])
  })

  it('uses the owner’s own name when there is one, and does not number it', () => {
    const r = roster([unit('e-mob', 'Mob', 'Da Hard Boyz'), unit('e-mob', 'Mob')])
    expect(named(r)).toEqual(['Da Hard Boyz', 'Mob #2'])
  })

  it('counts a renamed unit as a copy, so the others keep their own numbers', () => {
    const r = roster([unit('e-mob', 'Mob'), unit('e-mob', 'Mob', 'Da Hard Boyz'), unit('e-mob', 'Mob')])
    expect(named(r)).toEqual(['Mob #1', 'Da Hard Boyz', 'Mob #3'])
  })

  it('ignores a custom name that is only whitespace', () => {
    expect(named(roster([unit('e-mob', 'Mob', '   ')]))).toEqual(['Mob'])
  })

  it('tells apart two datasheets that share a display name but not an entry', () => {
    // A library can hold two entries of the same name; they are different units.
    expect(named(roster([unit('e-a', 'Mob'), unit('e-b', 'Mob')]))).toEqual(['Mob', 'Mob'])
  })
})


// --- the names have to reach everything that shows a unit -------------------

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
  sharedSelectionEntries: [
    {
      id: 'e-mob',
      name: 'Mob',
      type: 'unit',
      categoryLinks: [{ id: 'cl', targetId: 'cat-troop', primary: true }],
      costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 100 }],
    },
  ],
}

const validation = (r: Roster): Validation =>
  ({
    issues: [],
    errors: [],
    warnings: [],
    legal: true,
    points: 200,
    unitPoints: Object.fromEntries(r.selections.map((s) => [s.id, 100])),
    detachments: [],
    detachmentPoints: 0,
    enhancements: 0,
    characterSelectionIds: [],
    headroom: {},
    groupHeadroom: {},
    unsupported: [],
    pointsLimitChecked: true,
    warlordChecked: true,
    isEntryAvailable: () => true,
    isGroupAvailable: () => true,
    leaderTargets: () => [],
  }) as unknown as Validation

describe('the text export', () => {
  it('prints the numbered names, so a printed list can be told apart too', () => {
    const r = roster([unit('e-mob', 'Mob'), unit('e-mob', 'Mob', 'Da Hard Boyz')])
    const text = exportRosterText(r, buildGraph(gameSystem, catalogue), validation(r), 'Test Catalogue')

    expect(text).toContain('Mob #1')
    expect(text).toContain('Da Hard Boyz')
  })
})
