/**
 * Rules the data states at the model level or through an attachment, which a
 * single-level fixture misses: a Character keyword that lives on one model, a
 * required choice whose options all sit in nested groups, and a "retainers"
 * association that names `model-or-unit` and tests a keyword on the unit it
 * joins *including* the characters already leading it.
 *
 * Invented units — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { analyseRoster } from './evaluate'
import { instantiate } from './defaults'
import { validate } from './store'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { Catalogue, GameSystem, SelectionEntry } from '@/data/bsdata/schema'
import type { Roster, Selection } from './types'

const pts = (value: number) => [{ name: 'pts', typeId: COST_TYPE.points, value }]

const gameSystem: GameSystem = {
  id: 'gs',
  name: 'Test System',
  revision: 1,
  battleScribeVersion: '2.03',
  costTypes: [{ id: COST_TYPE.points, name: 'pts' }],
  categoryEntries: [
    { id: 'cat-troop', name: 'Troop' },
    { id: 'cat-hero', name: 'Character' },
    { id: 'cat-tech', name: 'Technician' },
  ],
}

/** The Character keyword sits on the lord's model, not on the unit. */
const lord: SelectionEntry = {
  id: 'e-lord',
  name: 'Lord and Throne',
  type: 'unit',
  categoryLinks: [{ id: 'cl-lord', targetId: 'cat-troop', primary: true }],
  costs: pts(300),
  selectionEntries: [
    {
      id: 'm-lord',
      name: 'Lord',
      type: 'model',
      categoryLinks: [{ id: 'cl-lord-m', targetId: 'cat-hero', primary: false }],
      constraints: [{ id: 'c-lord-min', type: 'min', value: 1, field: 'selections', scope: 'parent' }],
    },
  ],
}

/** A character whose Abilities group demands one pick; every option is nested. */
const crucible: SelectionEntry = {
  id: 'e-crucible',
  name: 'Adept',
  type: 'unit',
  categoryLinks: [
    { id: 'cl-adept', targetId: 'cat-hero', primary: true },
    { id: 'cl-adept-t', targetId: 'cat-tech', primary: false },
  ],
  costs: pts(70),
  selectionEntryGroups: [
    {
      id: 'g-abilities',
      name: 'Abilities',
      constraints: [
        { id: 'c-ab-min', type: 'min', value: 1, field: 'selections', scope: 'parent' },
        { id: 'c-ab-max', type: 'max', value: 1, field: 'selections', scope: 'parent' },
      ],
      selectionEntryGroups: [
        {
          id: 'g-tech-abilities',
          name: 'Technician abilities',
          // Offered to technicians only: hidden for anyone else.
          modifiers: [
            {
              type: 'set',
              field: 'hidden',
              value: true,
              conditions: [
                { type: 'notInstanceOf', value: 1, field: 'selections', scope: 'ancestor', childId: 'cat-tech' },
              ],
            },
          ],
          selectionEntries: [{ id: 'u-tech-1', name: 'Tinker', type: 'upgrade' }],
        },
        {
          id: 'g-shared-abilities',
          name: 'Shared abilities',
          selectionEntries: [
            { id: 'u-shared-1', name: 'Plan', type: 'upgrade' },
            { id: 'u-shared-2', name: 'Logic', type: 'upgrade' },
          ],
        },
      ],
    },
  ],
}

const mob: SelectionEntry = {
  id: 'e-mob',
  name: 'Mob',
  type: 'unit',
  categoryLinks: [{ id: 'cl-mob', targetId: 'cat-troop', primary: true }],
  costs: pts(100),
}

/** Joins "a unit led by a Technician", as the data words it. */
const retainers: SelectionEntry = {
  id: 'e-retainers',
  name: 'Retainers',
  type: 'unit',
  categoryLinks: [{ id: 'cl-ret', targetId: 'cat-troop', primary: true }],
  costs: pts(40),
  associations: [
    {
      id: 'a-retainers',
      name: 'Retinue',
      label: 'Retainers',
      action: 'group',
      childId: 'model-or-unit',
      scope: 'force',
      max: 1,
      conditionGroups: [
        {
          type: 'or',
          conditions: [{ type: 'instanceOf', value: 1, field: 'selections', scope: 'self', shared: true, childId: 'cat-tech' }],
        },
      ],
    },
  ],
}

/** An ordinary leader who is not a Technician. */
const captain: SelectionEntry = {
  id: 'e-captain',
  name: 'Captain',
  type: 'unit',
  categoryLinks: [{ id: 'cl-capt', targetId: 'cat-hero', primary: true }],
  costs: pts(60),
  associations: [
    { id: 'a-captain', name: 'Leader', label: 'Leader', action: 'group', childId: 'e-mob', scope: 'roster', max: 1 },
  ],
}

const { selectionEntryGroups: _groups, ...crucibleBare } = crucible
void _groups
const adeptLeads: SelectionEntry = {
  ...crucibleBare,
  id: 'e-adept-leader',
  name: 'Leading Adept',

  associations: [
    { id: 'a-adept', name: 'Leader', label: 'Leader', action: 'group', childId: 'e-mob', scope: 'roster', max: 1 },
  ],
}

const catalogue: Catalogue = {
  id: 'cat',
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  sharedSelectionEntries: [lord, crucible, mob, retainers, captain, adeptLeads],
}

const graph = () => buildGraph(gameSystem, catalogue)

const unit = (id: string, entryId: string, name: string, attach?: [string, string]): Selection => ({
  id,
  entryId,
  name,
  type: 'unit',
  count: 1,
  selections: [],
  ...(attach ? { attachedTo: attach[0], associationId: attach[1] } : {}),
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

describe('a Character keyword carried by one model', () => {
  it('makes the whole unit a Character, so it may be the Warlord', () => {
    const lordUnit: Selection = {
      ...unit('u1', 'e-lord', 'Lord and Throne'),
      selections: [{ id: 'm1', entryId: 'm-lord', name: 'Lord', type: 'model', count: 1, selections: [] }],
    }
    const a = analyseRoster(roster([lordUnit, unit('u2', 'e-mob', 'Mob')]), graph())
    expect(a.characterSelectionIds).toEqual(['u1'])
  })
})

describe('a required choice whose options are all in nested groups', () => {
  it('is made on a fresh add, from an option the data does not switch off', () => {
    const fresh = instantiate(graph().resolve('e-crucible')!)
    const flat = JSON.stringify(fresh)
    expect(flat).toContain('u-shared-1')
    expect(flat).not.toContain('u-tech-1')

    const errors = validate(roster([fresh]), graph()).issues.filter(
      (i) => i.severity === 'error' && /Abilities.*at least/.test(i.message),
    )
    expect(errors).toEqual([])
  })
})

describe('a keyword test on the unit a character joins', () => {
  const attach = (hostEntry: string, ...leaders: Selection[]) =>
    roster([unit('host', hostEntry, 'Host'), ...leaders])

  it('accepts a model-or-unit association onto a unit that has the keyword itself', () => {
    const r = attach('e-crucible', unit('r1', 'e-retainers', 'Retainers', ['host', 'a-retainers']))
    const a = analyseRoster(r, graph())
    expect(a.issues.filter((i) => i.selectionId === 'r1' && i.severity === 'error')).toEqual([])
    expect(a.leaderTargets('r1')[0]!.targetIds).toContain('host')
  })

  it('refuses a unit that has no such character in it', () => {
    const a = analyseRoster(attach('e-mob', unit('r1', 'e-retainers', 'Retainers', ['host', 'a-retainers'])), graph())
    expect(a.issues.some((i) => i.selectionId === 'r1' && /cannot be attached/.test(i.message))).toBe(true)
  })

  it('accepts a unit led by such a character, and not one led by another kind', () => {
    const led = roster([
      unit('host', 'e-mob', 'Mob'),
      unit('l1', 'e-adept-leader', 'Leading Adept', ['host', 'a-adept']),
      unit('r1', 'e-retainers', 'Retainers', ['host', 'a-retainers']),
    ])
    const ok = analyseRoster(led, graph())
    expect(ok.issues.filter((i) => i.selectionId === 'r1' && i.severity === 'error')).toEqual([])

    const other = roster([
      unit('host', 'e-mob', 'Mob'),
      unit('l1', 'e-captain', 'Captain', ['host', 'a-captain']),
      unit('r1', 'e-retainers', 'Retainers', ['host', 'a-retainers']),
    ])
    expect(analyseRoster(other, graph()).issues.some((i) => i.selectionId === 'r1' && /cannot be attached/.test(i.message))).toBe(true)
  })
})
