import { describe, expect, it } from 'vitest'
import { loadoutByModel, weaponCounts } from './weapons'
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
    weapon('w-launcher-b', '➤ Launcher - Single'),
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
    expect(groups[2]!.rows.map((r) => r.profile.name)).toEqual(['➤ Launcher - Blast', '➤ Launcher - Single', 'Blade'])
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
