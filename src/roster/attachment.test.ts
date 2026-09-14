/**
 * Leaders and Support characters attach through two different association
 * groups, and a unit may hold one of each — not two of either. The app used to
 * call both "Leader", which made a Support character look like a second leader.
 *
 * Invented units — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { analyseRoster } from './evaluate'
import { validate } from './store'
import { attachmentKind, attachmentsOf, heldOfKind } from './attachment'
import { ASSOCIATION, COST_TYPE } from '@/data/bsdata/schema'
import type { Catalogue, GameSystem, SelectionEntry } from '@/data/bsdata/schema'
import type { Roster, Selection } from './types'

const pts = (value: number) => [{ name: 'pts', typeId: COST_TYPE.points, value }]

/** The mob everyone attaches to: one Leader and one Support, no more. */
const mob: SelectionEntry = {
  id: 'e-mob',
  name: 'Mob',
  type: 'unit',
  categoryLinks: [{ id: 'cl-mob', targetId: 'cat-troop', primary: true }],
  costs: pts(100),
  constraints: [
    {
      id: 'c-one-leader',
      childId: ASSOCIATION.leader,
      childName: 'Leader',
      field: 'associations',
      scope: 'self',
      shared: true,
      type: 'max',
      value: 1,
    },
    {
      id: 'c-one-support',
      childId: ASSOCIATION.support,
      childName: 'Support',
      field: 'associations',
      scope: 'self',
      shared: true,
      type: 'max',
      value: 1,
    },
  ],
}

const character = (id: string, name: string, label: string): SelectionEntry => ({
  id,
  name,
  type: 'unit',
  categoryLinks: [{ id: `cl-${id}`, targetId: 'cat-hero', primary: true }],
  costs: pts(50),
  associations: [
    {
      id: `a-${id}`,
      name: label,
      label,
      action: 'group',
      childId: 'e-mob',
      scope: 'roster',
      max: 1,
    },
  ],
})

const gameSystem: GameSystem = {
  id: 'gs',
  name: 'Test System',
  revision: 1,
  battleScribeVersion: '2.03',
  costTypes: [{ id: COST_TYPE.points, name: 'pts' }],
  categoryEntries: [
    { id: 'cat-troop', name: 'Troop' },
    { id: 'cat-hero', name: 'Character' },
  ],
}

const catalogue: Catalogue = {
  id: 'cat',
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  sharedSelectionEntries: [
    mob,
    character('e-boss', 'Boss', 'Leader'),
    character('e-second-boss', 'Other Boss', 'Leader'),
    character('e-banner', 'Banner Bearer', 'Supported by'),
    character('e-thralls', 'Thralls', 'Retainers'),
  ],
}

const graph = () => buildGraph(gameSystem, catalogue)

const unit = (id: string, entryId: string, name: string, attach?: string): Selection => ({
  id,
  entryId,
  name,
  type: 'unit',
  count: 1,
  selections: [],
  ...(attach ? { attachedTo: attach, associationId: `a-${entryId}` } : {}),
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

describe('attachmentKind', () => {
  it('calls a unit that joins as a Leader a Leader', () => {
    expect(attachmentKind(graph().resolve('e-boss')!)?.label).toBe('Leader')
  })

  it('calls a unit labelled "Supported by" a Support character, as the rules do', () => {
    expect(attachmentKind(graph().resolve('e-banner')!)?.label).toBe('Support')
  })

  it('carries through a kind the game system never named', () => {
    // Necrons attach Cryptothralls to a Cryptek as "Retainers" — neither
    // Leader nor Support, and no reason for the app to know about it.
    expect(attachmentKind(graph().resolve('e-thralls')!)?.label).toBe('Retainers')
  })

  it('gives a unit that joins nothing no kind at all', () => {
    expect(attachmentKind(graph().resolve('e-mob')!)).toBeUndefined()
  })
})

describe('attachmentsOf', () => {
  it('reports a unit that has nothing attached as empty', () => {
    const r = roster([unit('u1', 'e-mob', 'Mob')])
    expect(attachmentsOf(r, graph(), 'u1').size).toBe(0)
  })

  it('reports what is attached, by kind', () => {
    const r = roster([
      unit('u1', 'e-mob', 'Mob'),
      unit('u2', 'e-boss', 'Boss', 'u1'),
      unit('u3', 'e-banner', 'Banner Bearer', 'u1'),
    ])
    const held = attachmentsOf(r, graph(), 'u1')
    const leaderKind = attachmentKind(graph().resolve('e-boss')!)!
    const supportKind = attachmentKind(graph().resolve('e-banner')!)!

    expect(heldOfKind(held, leaderKind).map((u) => u.name)).toEqual(['Boss'])
    expect(heldOfKind(held, supportKind).map((u) => u.name)).toEqual(['Banner Bearer'])
  })

  it('does not count the unit asking, so its own slot reads free', () => {
    const r = roster([unit('u1', 'e-mob', 'Mob'), unit('u2', 'e-boss', 'Boss', 'u1')])
    const held = attachmentsOf(r, graph(), 'u1')
    const leaderKind = attachmentKind(graph().resolve('e-boss')!)!
    expect(heldOfKind(held, leaderKind, 'u2')).toEqual([])
  })
})

describe('how many characters a unit may hold', () => {
  it('accepts one Leader and one Support on the same unit', () => {
    const r = roster([
      unit('u1', 'e-mob', 'Mob'),
      unit('u2', 'e-boss', 'Boss', 'u1'),
      unit('u3', 'e-banner', 'Banner Bearer', 'u1'),
    ])
    const errors = validate(r, graph()).issues.filter((i) => i.severity === 'error')
    expect(errors.filter((i) => i.selectionId === 'u1' || i.selectionId === 'u2' || i.selectionId === 'u3')).toEqual([])
  })

  it('refuses a second Leader on a unit that already has one', () => {
    const r = roster([
      unit('u1', 'e-mob', 'Mob'),
      unit('u2', 'e-boss', 'Boss', 'u1'),
      unit('u3', 'e-second-boss', 'Other Boss', 'u1'),
    ])
    const errors = validate(r, graph()).issues.filter((i) => i.severity === 'error')
    const cap = errors.find((i) => i.selectionId === 'u1')
    // The message has to name the rule that was broken. It used to read
    // "at most 1 points in this selection", which says nothing.
    expect(cap?.message).toContain('Leader')
    expect(cap?.message).not.toContain('points')
  })
})

describe('the unattached warning', () => {
  it('calls an unattached Support character a Support character, not a Leader', () => {
    const r = roster([unit('u1', 'e-mob', 'Mob'), unit('u3', 'e-banner', 'Banner Bearer')])
    const warning = validate(r, graph()).issues.find((i) => i.selectionId === 'u3')
    expect(warning?.message).toContain('Support')
    expect(warning?.message).not.toContain('Leader')
    expect(warning?.rule).toContain('Support')
  })

  it('still calls an unattached Leader a Leader', () => {
    const r = roster([unit('u1', 'e-mob', 'Mob'), unit('u2', 'e-boss', 'Boss')])
    const warning = validate(r, graph()).issues.find((i) => i.selectionId === 'u2')
    expect(warning?.message).toContain('Leader')
  })
})

describe('analysis still resolves the attachment', () => {
  it('links a support character to its unit', () => {
    const r = roster([unit('u1', 'e-mob', 'Mob'), unit('u3', 'e-banner', 'Banner Bearer', 'u1')])
    expect(analyseRoster(r, graph()).issues.filter((i) => i.severity === 'error')).toEqual([])
  })
})
