import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { evaluateRoster } from './evaluate'
import { instantiate } from './defaults'
import type { Catalogue, GameSystem, SelectionEntry } from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { Roster, Selection } from './types'

// Everything here is invented — the repo must contain no real game data.

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

const troopers: SelectionEntry = {
  id: 'e-squad',
  name: 'Squad',
  type: 'unit',
  categoryLinks: [{ id: 'cl1', targetId: 'cat-troop', primary: true }],
  costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 100 }],
  constraints: [
    // No more than three squads in the army.
    { id: 'c-army-max', type: 'max', value: 3, field: 'selections', scope: 'roster', shared: true },
  ],
  modifiers: [
    // Doubles in price past ten models.
    {
      type: 'set',
      field: COST_TYPE.points,
      value: 200,
      conditions: [
        { type: 'greaterThan', value: 10, field: 'selections', scope: 'e-squad', childId: 'model' },
      ],
    },
    // Requisition Threshold: the third copy onwards costs 20 more.
    {
      type: 'increment',
      field: COST_TYPE.points,
      value: 20,
      conditionGroups: [
        {
          type: 'and',
          localConditionGroups: [
            {
              type: 'atLeast',
              value: 2,
              field: 'selections',
              scope: 'parent',
              includeChildSelections: true,
              conditions: [
                { type: 'before', value: 1, field: 'selections', scope: 'self', childId: 'any' },
              ],
            },
          ],
        },
      ],
    },
  ],
  selectionEntryGroups: [
    {
      id: 'g-bodies',
      name: 'Bodies',
      constraints: [
        { id: 'c-body-min', type: 'min', value: 5, field: 'selections', scope: 'parent' },
        { id: 'c-body-max', type: 'max', value: 20, field: 'selections', scope: 'parent' },
      ],
      selectionEntries: [
        {
          id: 'e-trooper',
          name: 'Trooper',
          type: 'model',
          constraints: [
            { id: 'c-trooper-min', type: 'min', value: 5, field: 'selections', scope: 'parent' },
          ],
        },
      ],
      selectionEntryGroups: [
        {
          id: 'g-special',
          name: 'Special weapons',
          constraints: [
            { id: 'c-special-max', type: 'max', value: 1, field: 'selections', scope: 'parent' },
          ],
          modifiers: [
            // One more special weapon once the squad passes ten models.
            {
              type: 'increment',
              field: 'c-special-max',
              value: 1,
              conditions: [
                {
                  type: 'greaterThan',
                  value: 10,
                  field: 'selections',
                  scope: 'e-squad',
                  childId: 'model',
                },
              ],
            },
          ],
          selectionEntries: [
            {
              id: 'e-heavy',
              name: 'Heavy gunner',
              type: 'model',
              selectionEntries: [
                {
                  id: 'e-biggun',
                  name: 'Big gun',
                  type: 'upgrade',
                  constraints: [
                    // Only one big gun in the whole unit, however many gunners carry one.
                    // Sits two levels below the unit: unit > model > weapon.
                    { id: 'c-biggun-unit', type: 'max', value: 1, field: 'selections', scope: 'unit' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  entryLinks: [
    {
      id: 'l-banner',
      name: 'Banner',
      targetId: 'e-banner',
      type: 'selectionEntry',
      // The limit lives on the *link*, not on the shared entry it points at.
      constraints: [
        { id: 'c-banner-max', type: 'max', value: 1, field: 'selections', scope: 'parent' },
      ],
    },
  ],
}

/** A shared upgrade with no constraints of its own; every limit arrives via a link. */
const banner: SelectionEntry = { id: 'e-banner', name: 'Banner', type: 'upgrade' }

const catalogue: Catalogue = {
  id: 'cat',
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  sharedSelectionEntries: [troopers, banner],
}

const graph = () => buildGraph(gameSystem, catalogue)

let counter = 0
const sel = (entryId: string, name: string, type: Selection['type'], count: number, kids: Selection[] = []): Selection => ({
  id: `s${counter++}`,
  entryId,
  name,
  type,
  count,
  selections: kids,
})

const squad = (troopers: number, heavies = 0): Selection =>
  sel('e-squad', 'Squad', 'unit', 1, [
    sel('e-trooper', 'Trooper', 'model', troopers),
    ...(heavies > 0 ? [sel('e-heavy', 'Heavy gunner', 'model', heavies)] : []),
  ])

const roster = (selections: Selection[], pointsLimit = 2000): Roster => ({
  id: 'r',
  name: 'Test',
  catalogueId: 'cat',
  pointsLimit,
  configuration: [],
  selections,
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

describe('constraint evaluator', () => {
  it('resolves an entry into groups and nested groups', () => {
    const entry = graph().resolve('e-squad')!
    expect(entry.groups).toHaveLength(1)
    expect(entry.groups[0]!.groups).toHaveLength(1)
    expect(entry.groups[0]!.entries[0]!.name).toBe('Trooper')
  })

  it('accepts a legal squad', () => {
    const result = evaluateRoster(roster([squad(10)]), graph())
    expect(result.issues).toEqual([])
    expect(result.points).toBe(100)
  })

  it('enforces a group minimum', () => {
    const result = evaluateRoster(roster([squad(2)]), graph())
    expect(result.issues.some((i) => i.message.includes('at least 5'))).toBe(true)
  })

  it('enforces a group maximum', () => {
    const result = evaluateRoster(roster([squad(21)]), graph())
    expect(result.issues.some((i) => i.message.includes('at most 20'))).toBe(true)
  })

  it('applies a size-dependent cost modifier', () => {
    expect(evaluateRoster(roster([squad(10)]), graph()).points).toBe(100)
    expect(evaluateRoster(roster([squad(11)]), graph()).points).toBe(200)
  })

  it('raises an option limit once the unit is large enough', () => {
    // The limit counts total models, so 8 + 2 is exactly ten and still capped
    // at one heavy, while 9 + 2 passes ten and unlocks the second.
    const small = evaluateRoster(roster([squad(8, 2)]), graph())
    expect(small.issues.some((i) => i.message.includes('at most 1'))).toBe(true)

    const large = evaluateRoster(roster([squad(9, 2)]), graph())
    expect(large.issues.some((i) => i.message.includes('at most'))).toBe(false)
  })

  it('charges a Requisition Threshold only from the third copy', () => {
    const one = evaluateRoster(roster([squad(10)]), graph())
    const two = evaluateRoster(roster([squad(10), squad(10)]), graph())
    const three = evaluateRoster(roster([squad(10), squad(10), squad(10)]), graph())
    expect(one.points).toBe(100)
    expect(two.points).toBe(200)
    // The third copy is 120, not 100 — this is the case that regressed when
    // local condition groups were unimplemented and every copy paid it.
    expect(three.points).toBe(320)
  })

  it('enforces an army-wide maximum on a datasheet', () => {
    const legal = evaluateRoster(roster([squad(10), squad(10), squad(10)]), graph())
    expect(legal.issues.some((i) => i.message.includes('at most 3'))).toBe(false)
    const tooMany = evaluateRoster(
      roster([squad(10), squad(10), squad(10), squad(10)]),
      graph(),
    )
    expect(tooMany.issues.some((i) => i.message.includes('at most 3'))).toBe(true)
  })

  it('reports nothing as unsupported for data it fully models', () => {
    const result = evaluateRoster(roster([squad(10)]), graph())
    expect(result.unsupported).toEqual([])
  })

  it('counts a weapon two levels below the unit against a unit-scope limit', () => {
    // The spec's flagship case: two special-weapon models in a 12-model unit,
    // each carrying one gun, where the gun is capped at one per unit.
    const twoGuns = sel('e-squad', 'Squad', 'unit', 1, [
      sel('e-trooper', 'Trooper', 'model', 10),
      sel('e-heavy', 'Heavy gunner', 'model', 2, [sel('e-biggun', 'Big gun', 'upgrade', 1)]),
    ])
    const result = evaluateRoster(roster([twoGuns]), graph())
    expect(result.issues.some((i) => i.message.includes('Big gun'))).toBe(true)

    // One gunner with one gun is fine.
    const oneGun = sel('e-squad', 'Squad', 'unit', 1, [
      sel('e-trooper', 'Trooper', 'model', 10),
      sel('e-heavy', 'Heavy gunner', 'model', 1, [sel('e-biggun', 'Big gun', 'upgrade', 1)]),
    ])
    expect(evaluateRoster(roster([oneGun]), graph()).issues).toEqual([])
  })

  it('treats a nested count as per copy of its parent', () => {
    // Two gunners each with one gun means two guns; the same is true for the
    // points, which must multiply through the tree rather than sum raw counts.
    const twoGuns = sel('e-squad', 'Squad', 'unit', 1, [
      sel('e-trooper', 'Trooper', 'model', 10),
      sel('e-heavy', 'Heavy gunner', 'model', 2, [sel('e-biggun', 'Big gun', 'upgrade', 1)]),
    ])
    const result = evaluateRoster(roster([twoGuns]), graph())
    expect(result.issues.some((i) => i.message.includes('has 2'))).toBe(true)
  })

  it('keeps the constraints an entry link carries into a particular parent', () => {
    const entry = graph().resolve('e-squad')!
    const linked = entry.entries.find((e) => e.id === 'e-banner')!
    expect(linked.linkId).toBe('l-banner')

    const twoBanners = sel('e-squad', 'Squad', 'unit', 1, [
      sel('e-trooper', 'Trooper', 'model', 10),
      { ...sel('e-banner', 'Banner', 'upgrade', 2), linkId: 'l-banner' },
    ])
    const result = evaluateRoster(roster([twoBanners]), graph())
    expect(result.issues.some((i) => i.message.includes('Banner'))).toBe(true)
  })

  it('instantiates an entry with its mandatory choices already made', () => {
    const entry = graph().resolve('e-squad')!
    const built = instantiate(entry)
    const result = evaluateRoster(roster([built]), graph())
    // Defaults must not open the editor on errors the user did not cause.
    expect(result.issues).toEqual([])
  })
})
