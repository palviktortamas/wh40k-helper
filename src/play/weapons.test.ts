import { describe, expect, it } from 'vitest'
import { groupModes, loadoutByModel, weaponCounts } from './weapons'
import type { Datasheet } from '@/data/model'
import type { ModelGroup } from './types'

// Invented data — the repo must contain no real game data.

const weapon = (id: string, name: string, kind: 'ranged' | 'melee' = 'ranged', shared = false) => ({
  id,
  name,
  kind,
  keywords: [],
  ...(shared ? { shared: true } : {}),
})

const sheet = {
  id: 'sheet',
  name: 'Mob',
  keywords: [],
  factionKeywords: [],
  type: 'unit',
  stats: [],
  weapons: [
    weapon('w-pistol', 'Pistol'),
    weapon('w-heavy', 'Heavy gun'),
    weapon('w-launcher-a', '➤ Launcher - Blast'),
    // The sources are hand-maintained and the spacing around the mode marker
    // is not reliable: one profile of one weapon on one datasheet is written
    // without the leading space, and that profile used to fall out of the
    // weapon entirely — the unit's own gun listed under "options not taken".
    weapon('w-launcher-b', '➤ Launcher- Single'),
    weapon('w-combi-a', '➤ Combi-gun - Blast'),
    weapon('w-combi-b', '➤ Combi-gun - Single'),
    weapon('w-blade', 'Blade', 'melee'),
    weapon('w-fist', 'Fist', 'melee'),
    weapon('w-relic', 'Relic grenade', 'ranged', true),
  ],
  abilities: [],
  models: [],
  associations: [],
  constraints: [],
  sources: ['bsdata'],
} as unknown as Datasheet

const group = (name: string, alive: number, weapons: { name: string; perModel: number }[]): ModelGroup => ({
  id: name,
  name,
  total: alive,
  alive,
  wounds: 1,
  currentWounds: 1,
  weapons,
})

const unit = {
  models: [
    group('Trooper', 12, [{ name: 'Pistol', perModel: 1 }, { name: 'Blade', perModel: 1 }]),
    group('Trooper w/ Heavy gun', 2, [{ name: 'Heavy gun', perModel: 1 }, { name: 'Blade', perModel: 1 }]),
    group('Trooper w/ Launcher', 2, [{ name: 'Launcher', perModel: 1 }, { name: 'Blade', perModel: 1 }]),
    group('Boss', 2, [{ name: 'Fist', perModel: 1 }, { name: 'Trophy rack', perModel: 1 }]),
  ],
}

describe('loadout by model', () => {
  const groups = loadoutByModel(unit, sheet)

  it('keeps the unit’s model types apart, so the table says which model carries what', () => {
    expect(groups.map((g) => [g.name, g.alive, g.total])).toEqual([
      ['Trooper', 12, 12],
      ['Trooper w/ Heavy gun', 2, 2],
      ['Trooper w/ Launcher', 2, 2],
      ['Boss', 2, 2],
    ])
    // Ranged first: that is the order the weapons come up in at the table.
    expect(groups[1]!.rows.map((r) => [r.profile.name, r.count])).toEqual([
      ['Heavy gun', 1],
      ['Blade', 1],
    ])
    expect(groups[0]!.rows.map((r) => r.profile.name)).toEqual(['Pistol', 'Blade'])
  })

  it('lists every firing mode of a weapon that has several — the choice is made at the table', () => {
    expect(groups[2]!.rows.map((r) => r.profile.name)).toEqual(['➤ Launcher - Blast', '➤ Launcher- Single', 'Blade'])
  })

  it('keeps wargear that matches no weapon profile rather than dropping it', () => {
    expect(groups[3]!.unmatched).toEqual([['Trophy rack', 1]])
  })

  it('counts the models still alive', () => {
    const wounded = { models: unit.models.map((g) => (g.name === 'Trooper' ? { ...g, alive: 5 } : g)) }
    expect(loadoutByModel(wounded, sheet)[0]).toMatchObject({ alive: 5, total: 12 })
  })

  it('drops a model group once every model in it is dead', () => {
    const dead = { models: unit.models.map((g) => (g.name === 'Boss' ? { ...g, alive: 0 } : g)) }
    expect(loadoutByModel(dead, sheet).map((g) => g.name)).not.toContain('Boss')
  })
})

describe('weapon counts', () => {
  it('never offers a profile the unit reaches only through a shared option tree', () => {
    const { rows } = weaponCounts(unit, sheet)
    expect(rows.map((r) => r.profile.name)).not.toContain('Relic grenade')
  })

  it('still shows such a profile when a model actually carries it', () => {
    const withRelic = { models: [group('Boss', 1, [{ name: 'Relic grenade', perModel: 1 }])] }
    const { rows } = weaponCounts(withRelic, sheet)
    expect(rows.find((r) => r.profile.name === 'Relic grenade')?.count).toBe(1)
  })
})

describe('weapons with more than one firing mode', () => {
  it('reads as one weapon, with its modes under it', () => {
    const { rows } = weaponCounts(
      { models: [group('Trooper', 2, [{ name: 'Launcher', perModel: 1 }])] },
      sheet,
    )
    const groups = groupModes(rows.filter((r) => r.count > 0))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('Launcher')
    // Two profiles, one weapon: the count is the weapon's, not two weapons'.
    expect(groups[0]!.count).toBe(2)
    expect(groups[0]!.modes.map((m) => m.label)).toEqual(['Blast', 'Single'])
  })

  it('leaves a plain weapon alone', () => {
    const { rows } = weaponCounts(
      { models: [group('Trooper', 3, [{ name: 'Pistol', perModel: 1 }])] },
      sheet,
    )
    const groups = groupModes(rows.filter((r) => r.count > 0))
    expect(groups).toEqual([
      { name: 'Pistol', count: 3, modes: [{ label: undefined, profile: rows[0]!.profile }] },
    ])
  })

  it('keeps two weapons that merely start with the same word apart', () => {
    const { rows } = weaponCounts(
      {
        models: [
          group('Trooper', 1, [
            { name: 'Pistol', perModel: 1 },
            { name: 'Heavy gun', perModel: 1 },
          ]),
        ],
      },
      sheet,
    )
    expect(groupModes(rows.filter((r) => r.count > 0)).map((g) => g.name)).toEqual([
      'Pistol',
      'Heavy gun',
    ])
  })
})

describe('the mode marker, as the sources actually write it', () => {
  it('folds a mode whose separator is missing a space', () => {
    const { rows } = weaponCounts(
      { models: [group('Trooper', 2, [{ name: 'Launcher', perModel: 1 }])] },
      sheet,
    )
    // Both modes belong to the carried weapon, however the source spaced them.
    expect(rows.filter((r) => r.count > 0).map((r) => r.profile.id).sort()).toEqual([
      'w-launcher-a',
      'w-launcher-b',
    ])
    const groups = groupModes(rows.filter((r) => r.count > 0))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('Launcher')
    expect(groups[0]!.modes.map((m) => m.label)).toEqual(['Blast', 'Single'])
  })

  it('does not split a weapon whose own name is hyphenated', () => {
    const { rows } = weaponCounts(
      { models: [group('Trooper', 1, [{ name: 'Combi-gun', perModel: 1 }])] },
      sheet,
    )
    const groups = groupModes(rows.filter((r) => r.count > 0))
    expect(groups.map((g) => g.name)).toEqual(['Combi-gun'])
    expect(groups[0]!.modes.map((m) => m.label)).toEqual(['Blast', 'Single'])
  })

  it('keeps a name that merely opens with punctuation', () => {
    const { rows } = weaponCounts(
      { models: [group('Trooper', 1, [{ name: '’Eavy gun', perModel: 1 }])] },
      { ...sheet, weapons: [weapon('w-eavy', '’Eavy gun')] } as never,
    )
    expect(groupModes(rows)[0]!.name).toBe('’Eavy gun')
  })
})

describe('a weapon whose profiles are told apart by a bracketed qualifier', () => {
  const stikka = {
    ...sheet,
    weapons: [weapon('w-s-r', 'Stikka (ranged)'), weapon('w-s-m', 'Stikka (melee)', 'melee')],
  } as unknown as typeof sheet

  it('belongs to the weapon the loadout names', () => {
    const { rows, unmatched } = weaponCounts(
      { models: [group('Rider', 3, [{ name: 'Stikka', perModel: 1 }])] },
      stikka,
    )
    expect(unmatched).toEqual([])
    expect(rows.map((r) => r.count)).toEqual([3, 3])
    expect(groupModes(rows.filter((r) => r.profile.kind === 'ranged'))[0]).toMatchObject({
      name: 'Stikka',
      count: 3,
    })
  })
})
