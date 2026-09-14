/**
 * The 11th-edition modular detachment system: an army takes as many
 * detachments as its Detachment Points budget allows, and that budget comes
 * from the game system, not from anything hard-coded here.
 *
 * Everything below is invented — the repo must contain no real game data — but
 * it mirrors the real shape: a Configuration entry holding a `min 1 / max -1`
 * group of detachments that each cost Detachment Points, and a force entry
 * whose `max` on that cost type is raised by the battle size chosen.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { evaluateRoster } from './evaluate'
import { detachmentOptions, validate, withDetachmentToggled, normaliseRoster } from './store'
import { exportRosterText } from './export'
import type { Catalogue, GameSystem, SelectionEntry } from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { Roster, Selection } from './types'

const dp = (value: number) => ({ name: 'Detachment Points', typeId: COST_TYPE.detachmentPoints, value })

/** Battle sizes: the big one raises the Detachment Points cap from 2 to 3. */
const battleSize: SelectionEntry = {
  id: 'e-size',
  name: 'Battle Size',
  type: 'upgrade',
  categoryLinks: [{ id: 'cl-size', targetId: 'cat-config', primary: true }],
  selectionEntryGroups: [
    {
      id: 'g-size',
      name: 'Battle Size',
      constraints: [
        { id: 'c-size-min', type: 'min', value: 1, field: 'selections', scope: 'parent' },
        { id: 'c-size-max', type: 'max', value: 1, field: 'selections', scope: 'parent' },
      ],
      selectionEntries: [
        { id: 'e-small', name: 'Skirmish', type: 'upgrade' },
        { id: 'e-large', name: 'Grand Battle', type: 'upgrade' },
      ],
    },
  ],
}

const detachmentPicker: SelectionEntry = {
  id: 'e-detachments',
  name: 'Detachment',
  type: 'upgrade',
  categoryLinks: [{ id: 'cl-det', targetId: 'cat-config', primary: true }],
  selectionEntryGroups: [
    {
      id: 'g-detachment',
      name: 'Detachment',
      constraints: [
        { id: 'c-det-min', type: 'min', value: 1, field: 'selections', scope: 'parent' },
        { id: 'c-det-max', type: 'max', value: -1, field: 'selections', scope: 'parent' },
      ],
      selectionEntries: [
        { id: 'e-vanguard', name: 'Vanguard', type: 'upgrade', costs: [dp(1)] },
        { id: 'e-bulwark', name: 'Bulwark', type: 'upgrade', costs: [dp(2)] },
        { id: 'e-spearhead', name: 'Spearhead', type: 'upgrade', costs: [dp(3)] },
      ],
    },
  ],
}

const gameSystem: GameSystem = {
  id: 'gs',
  name: 'Test System',
  revision: 1,
  battleScribeVersion: '2.03',
  costTypes: [
    { id: COST_TYPE.points, name: 'pts' },
    { id: COST_TYPE.detachmentPoints, name: 'Detachment Points' },
  ],
  categoryEntries: [
    { id: 'cat-config', name: 'Configuration' },
    { id: 'cat-troop', name: 'Troop' },
  ],
  forceEntries: [
    {
      id: 'f-army',
      name: 'Army Roster',
      constraints: [
        {
          id: 'c-dp-max',
          type: 'max',
          value: 2,
          field: COST_TYPE.detachmentPoints,
          scope: 'parent',
          shared: true,
          includeChildSelections: true,
        },
      ],
      modifiers: [
        {
          type: 'set',
          field: 'c-dp-max',
          value: 3,
          conditions: [
            {
              type: 'equalTo',
              value: 1,
              field: 'selections',
              scope: 'force',
              shared: true,
              childId: 'e-large',
              includeChildSelections: true,
            },
          ],
        },
      ],
    },
  ],
  sharedSelectionEntries: [battleSize, detachmentPicker],
}

const catalogue: Catalogue = {
  id: 'cat',
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  sharedSelectionEntries: [
    {
      id: 'e-squad',
      name: 'Squad',
      type: 'unit',
      categoryLinks: [{ id: 'cl-squad', targetId: 'cat-troop', primary: true }],
      costs: [{ name: 'pts', typeId: COST_TYPE.points, value: 100 }],
    },
  ],
}

const graph = () => buildGraph(gameSystem, catalogue)

const bareRoster = (): Roster => ({
  id: 'r',
  name: 'Test',
  catalogueId: 'cat',
  pointsLimit: 2000,
  configuration: [],
  selections: [],
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

/** A roster with the configuration instantiated and the named battle size set. */
const started = (size: 'e-small' | 'e-large'): Roster => {
  const g = graph()
  const base = normaliseRoster(bareRoster(), g)
  const config = base.configuration.map((entry) =>
    entry.entryId === 'e-size'
      ? {
          ...entry,
          selections: [
            {
              id: `size-${size}`,
              entryId: size,
              groupId: 'g-size',
              name: size === 'e-large' ? 'Grand Battle' : 'Skirmish',
              type: 'upgrade' as const,
              count: 1,
              selections: [] as Selection[],
            },
          ],
        }
      : entry,
  )
  return { ...base, configuration: config }
}

/** One unit, so the core checks that only apply to a real army do apply. */
const withSquad = (roster: Roster): Roster => ({
  ...roster,
  selections: [
    { id: 'u1', entryId: 'e-squad', name: 'Squad', type: 'unit', count: 1, selections: [] },
  ],
})

const take = (roster: Roster, ...entryIds: string[]): Roster =>
  entryIds.reduce((r, id) => withDetachmentToggled(r, graph(), id, true), roster)

describe('detachment points budget', () => {
  it('offers every detachment the data defines, with its cost', () => {
    const options = detachmentOptions(graph())
    expect(options.map((o) => o.entry.name)).toEqual(['Bulwark', 'Spearhead', 'Vanguard'])
    expect(options.map((o) => o.entry.costs[COST_TYPE.detachmentPoints])).toEqual([2, 3, 1])
  })

  it('reports every chosen detachment, not just the first', () => {
    const result = evaluateRoster(take(started('e-large'), 'e-vanguard', 'e-bulwark'), graph())

    expect(result.detachments.map((d) => d.name)).toEqual(['Vanguard', 'Bulwark'])
    expect(result.detachments.map((d) => d.dp)).toEqual([1, 2])
    expect(result.detachmentPoints).toBe(3)
  })

  it('reads the points budget from the battle size the data gates it on', () => {
    expect(evaluateRoster(started('e-small'), graph()).detachmentPointsLimit).toBe(2)
    expect(evaluateRoster(started('e-large'), graph()).detachmentPointsLimit).toBe(3)
  })

  it('accepts a combination that spends the whole budget', () => {
    const result = evaluateRoster(take(started('e-large'), 'e-vanguard', 'e-bulwark'), graph())
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('rejects a combination that overspends the budget', () => {
    const result = evaluateRoster(take(started('e-small'), 'e-vanguard', 'e-bulwark'), graph())
    expect(result.detachmentPoints).toBe(3)
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true)
  })

  it('drops a detachment again without disturbing the others', () => {
    const both = take(started('e-large'), 'e-vanguard', 'e-bulwark')
    const one = withDetachmentToggled(both, graph(), 'e-vanguard', false)

    const result = evaluateRoster(one, graph())
    expect(result.detachments.map((d) => d.name)).toEqual(['Bulwark'])
    expect(result.detachmentPoints).toBe(2)
  })

  it('tells an army with no detachment at all that it needs one', () => {
    const issues = validate(withSquad(started('e-large')), graph()).issues
    expect(issues.some((i) => i.severity === 'error' && /at least one detachment/i.test(i.message))).toBe(true)
  })

  it('does not ask for a detachment when several are taken', () => {
    const both = take(withSquad(started('e-large')), 'e-vanguard', 'e-bulwark')
    const issues = validate(both, graph()).issues
    expect(issues.some((i) => /detachment/i.test(i.message) && i.severity === 'error')).toBe(false)
  })

  it('writes every detachment into the text export, with the points total', () => {
    const both = take(withSquad(started('e-large')), 'e-vanguard', 'e-bulwark')
    const g = graph()
    const text = exportRosterText(both, g, validate(both, g), 'Test Catalogue')

    expect(text).toContain('Detachments: Vanguard (1 DP), Bulwark (2 DP) — 3/3 DP')
  })

  it('writes a single detachment without pluralising the label', () => {
    const one = take(withSquad(started('e-large')), 'e-spearhead')
    const g = graph()
    const text = exportRosterText(one, g, validate(one, g), 'Test Catalogue')

    expect(text).toContain('Detachment: Spearhead (3 DP) — 3/3 DP')
  })

  it('ignores a second request to take a detachment already taken', () => {
    const once = take(started('e-large'), 'e-spearhead')
    const twice = withDetachmentToggled(once, graph(), 'e-spearhead', true)

    expect(evaluateRoster(twice, graph()).detachmentPoints).toBe(3)
  })
})
