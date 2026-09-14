import { describe, expect, it } from 'vitest'
import { buildGameUnits, modelGroups } from './snapshot'
import { weaponCounts } from '@/play/weapons'
import type { ParsedCatalogue } from '@/data/model'
import type { Roster, Selection } from '@/roster/types'
import type { Validation } from '@/roster/store'

// Everything here is invented — the repo must contain no real game data.

let counter = 0
const sel = (
  entryId: string,
  name: string,
  type: Selection['type'],
  count: number,
  kids: Selection[] = [],
): Selection => ({ id: `s${counter++}`, entryId, name, type, count, selections: kids })

const catalogue: ParsedCatalogue = {
  id: 'cat',
  name: 'Test',
  revision: 1,
  gameSystemId: 'gs',
  detachments: [],
  rules: [],
  unsupported: [],
  datasheets: [
    {
      id: 'e-squad',
      name: 'Squad',
      keywords: [],
      factionKeywords: [],
      type: 'unit',
      stats: [
        { name: 'Trooper', w: '1' },
        { name: 'Sergeant', w: '2' },
      ],
      weapons: [
        { id: 'w1', name: 'Rifle', kind: 'ranged', keywords: [] },
        { id: 'w2', name: 'Big gun', kind: 'ranged', keywords: [] },
        { id: 'w3', name: 'Knife', kind: 'melee', keywords: [] },
        // A weapon with two firing modes, and one only reachable through a combined weapon.
        { id: 'w5', name: '➤ Big gun - Blast', kind: 'ranged', keywords: [] },
        { id: 'w6', name: 'Gun', kind: 'ranged', keywords: [] },
        { id: 'w7', name: '➤ Combi-flamer - Flame', kind: 'ranged', keywords: [] },
      ],
      abilities: [],
      models: [],
      associations: [],
      constraints: [],
      sources: ['bsdata'],
    },
    {
      id: 'e-walker',
      name: 'Walker',
      keywords: [],
      factionKeywords: [],
      type: 'model',
      stats: [{ name: 'Walker', w: '12' }],
      weapons: [{ id: 'w4', name: 'Cannon', kind: 'ranged', keywords: [] }],
      abilities: [{ id: 'ab', name: 'Damaged: 1-4 Wounds Remaining', kind: 'datasheet', text: '' }],
      models: [],
      associations: [],
      constraints: [],
      sources: ['bsdata'],
    },
  ],
}

const squad = sel('e-squad', 'Squad', 'unit', 1, [
  sel('e-trooper', 'Trooper', 'model', 8, [sel('e-rifle', 'Rifle', 'upgrade', 1), sel('e-knife', 'Knife', 'upgrade', 1)]),
  sel('e-heavy', 'Trooper w/ Big gun', 'model', 2, [sel('e-biggun', 'Big gun', 'upgrade', 1)]),
  sel('e-sgt', 'Sergeant', 'model', 1, [
    sel('e-knife', 'Knife', 'upgrade', 2),
    // A combined weapon: the entry is the flamer and holds the knife as a child.
    sel('e-combi', 'Knife and Combi-flamer', 'upgrade', 1, [sel('e-knife', 'Knife', 'upgrade', 1)]),
  ]),
])
const walker = sel('e-walker', 'Walker', 'model', 1, [sel('e-cannon', 'Cannon', 'upgrade', 2)])
const leader = sel('e-hero', 'Hero', 'model', 1)
leader.attachedTo = squad.id

const roster: Roster = {
  id: 'r',
  name: 'Test',
  catalogueId: 'cat',
  pointsLimit: 2000,
  configuration: [],
  selections: [squad, walker, leader],
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
}

const validation = {
  unitPoints: { [squad.id]: 120, [walker.id]: 150, [leader.id]: 80 },
  characterSelectionIds: [leader.id],
  warlordSelectionId: leader.id,
} as unknown as Validation

describe('game snapshot', () => {
  const units = buildGameUnits(roster, catalogue, validation)

  it('carries the roster’s own names to the table, numbering and all', () => {
    // Two copies of one datasheet must stay distinguishable at the table —
    // "Squad #2 is Battle-shocked" has to mean something.
    const twoSquads: Roster = {
      ...roster,
      selections: [squad, { ...squad, id: 'squad-2' }, { ...walker, customName: 'Old Reliable' }],
    }
    const names = buildGameUnits(twoSquads, catalogue, validation).map((u) => u.name)
    expect(names).toEqual(['Squad #1', 'Squad #2', 'Old Reliable'])
  })

  it('splits a unit into its model types with per-model weapons', () => {
    const unit = units[0]!
    expect(unit.models.map((m) => [m.name, m.total, m.wounds])).toEqual([
      ['Trooper', 8, 1],
      ['Trooper w/ Big gun', 2, 1],
      ['Sergeant', 1, 2],
    ])
    expect(unit.models[2]!.weapons).toEqual([
      { name: 'Knife', perModel: 3 },
      { name: 'Combi-flamer', perModel: 1 },
    ])
    expect(unit.points).toBe(120)
  })

  it('gives a model the weapon it swapped to, and not the one it swapped away', () => {
    // A combined weapon's children are its parts — the part itself, or the
    // choice taken in its place. Both parts chosen means the container's own
    // name carries nothing; one part chosen leaves the other.
    const swapped = sel('e-sgt', 'Sergeant', 'model', 1, [
      sel('e-combi', 'Knife and Combi-flamer', 'upgrade', 1, [
        sel('e-fist', 'Fist', 'upgrade', 1),
        sel('e-gun', 'Carbine', 'upgrade', 1),
      ]),
    ])
    expect(modelGroups(sel('e-squad', 'Squad', 'unit', 1, [swapped]), undefined)[0]!.weapons).toEqual([
      { name: 'Fist', perModel: 1 },
      { name: 'Carbine', perModel: 1 },
    ])
    const half = sel('e-sgt', 'Sergeant', 'model', 1, [
      sel('e-combi', 'Knife and Combi-flamer', 'upgrade', 1, [sel('e-fist', 'Fist', 'upgrade', 1)]),
    ])
    expect(modelGroups(sel('e-squad', 'Squad', 'unit', 1, [half]), undefined)[0]!.weapons).toEqual([
      { name: 'Combi-flamer', perModel: 1 },
      { name: 'Fist', perModel: 1 },
    ])
  })

  it('treats a single-model datasheet as its own model and reads the damaged threshold', () => {
    const unit = units[1]!
    expect(unit.models).toHaveLength(1)
    expect(unit.models[0]!.wounds).toBe(12)
    expect(unit.models[0]!.weapons).toEqual([{ name: 'Cannon', perModel: 2 }])
    expect(unit.damagedAt).toBe(4)
  })

  it('carries the Warlord, Character and leader attachment over', () => {
    const hero = units[2]!
    expect(hero.isWarlord).toBe(true)
    expect(hero.isCharacter).toBe(true)
    expect(hero.leaderOf).toBe(squad.id)
  })

  it('counts weapons from the surviving models only', () => {
    const unit = units[0]!
    const full = weaponCounts(unit, catalogue.datasheets[0])
    // "Big gun" must not be counted as "Gun"; the second firing mode of the
    // big gun gets the big gun's count; the combined weapon's own part reaches
    // the flamer's sub-profile while its knife child counts as a knife.
    expect(full.rows.map((r) => [r.profile.name, r.count])).toEqual([
      ['Rifle', 8],
      ['Big gun', 2],
      ['Knife', 11],
      ['➤ Big gun - Blast', 2],
      ['Gun', 0],
      ['➤ Combi-flamer - Flame', 1],
    ])
    expect(full.unmatched).toEqual([])
    // One big-gun model dies: only its gun goes.
    const wounded = { ...unit, models: unit.models.map((m) => (m.name.includes('Big gun') ? { ...m, alive: 1 } : m)) }
    const after = weaponCounts(wounded, catalogue.datasheets[0])
    expect(after.rows.find((r) => r.profile.name === 'Big gun')!.count).toBe(1)
    expect(after.rows.find((r) => r.profile.name === 'Rifle')!.count).toBe(8)
  })
})
