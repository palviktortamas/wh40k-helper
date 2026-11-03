import { describe, expect, it } from 'vitest'
import { apply } from './actions'
import { hostOf, wholeUnitOf } from './attached'
import { isLive } from './mods'
import { belowHalfStrength, unitsToTest, type Game, type GameUnit } from './types'
import { attachedFamily, effectsForUnit } from './unitEffects'
import type { Datasheet, ParsedCatalogue } from '@/data/model'

// Everything here is invented — the repo must contain no real game data.

const unit = (id: string, total: number, extra: Partial<GameUnit> = {}): GameUnit => ({
  id,
  name: `Unit ${id}`,
  entryId: `ds-${id}`,
  points: 100,
  isCharacter: false,
  isWarlord: false,
  models: [{ id: `${id}-g`, name: 'Model', total, alive: total, wounds: 1, currentWounds: 1, weapons: [] }],
  statuses: [],
  destroyed: false,
  usedOnce: [],
  ...extra,
})

const gameWith = (units: GameUnit[]): Game =>
  ({
    id: 'g',
    rosterId: 'r',
    rosterName: 'Test',
    catalogueId: 'c',
    factionName: 'F',
    detachmentNames: [],
    pointsLimit: 2000,
    opponentName: 'Opp',
    opponentFaction: '',
    firstTurn: 'me',
    startedIllegal: false,
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
    round: 1,
    phase: 'command',
    turn: 'me',
    me: { cp: 1, vpPrimary: 0, vpSecondary: 0 },
    opponent: { cp: 1, vpPrimary: 0, vpSecondary: 0 },
    units,
    vpByRound: {},
    log: [],
    undo: [],
  }) as Game

// A mob of ten with a character and a support character standing with it.
const mob = () => unit('mob', 10)
const boss = () => unit('boss', 1, { leaderOf: 'mob' })
const medic = () => unit('medic', 1, { leaderOf: 'mob' })
const mobGame = () => gameWith([mob(), boss(), medic(), unit('other', 5)])

describe('statuses belong to the attached unit', () => {
  it('shocks the whole unit, characters included, and clears it the same way', () => {
    const shocked = apply(mobGame(), { type: 'toggleStatus', unitId: 'mob', status: 'battleShocked' })
    expect(shocked.units.filter((u) => u.statuses.includes('battleShocked')).map((u) => u.id)).toEqual([
      'mob',
      'boss',
      'medic',
    ])
    // Tapped on the character, it is still the unit that is shocked.
    const cleared = apply(shocked, { type: 'toggleStatus', unitId: 'boss', status: 'battleShocked' })
    expect(cleared.units.some((u) => u.statuses.includes('battleShocked'))).toBe(false)
  })

  it('tests one row per attached unit', () => {
    const shocked = apply(mobGame(), { type: 'toggleStatus', unitId: 'mob', status: 'battleShocked' })
    expect(unitsToTest(shocked.units).map((u) => u.id)).toEqual(['mob'])
  })
})

describe('below half-strength is read over the whole attached unit', () => {
  it('counts the characters in Starting Strength', () => {
    // Four of the mob's ten left is under half for the mob alone, but the unit
    // is twelve models with two characters and six of them stand.
    const hurt = mobGame().units.map((u) =>
      u.id === 'mob' ? { ...u, models: u.models.map((m) => ({ ...m, alive: 4 })) } : u,
    )
    expect(belowHalfStrength(hurt[0]!)).toBe(true)
    expect(belowHalfStrength(hurt[0]!, hurt)).toBe(false)
    // …and a character standing with the mob is judged with it.
    expect(belowHalfStrength(hurt[1]!, hurt)).toBe(false)
    const worse = hurt.map((u) =>
      u.id === 'mob' ? { ...u, models: u.models.map((m) => ({ ...m, alive: 3 })) } : u,
    )
    expect(belowHalfStrength(worse[1]!, worse)).toBe(true)
  })
})

describe('a character whose bodyguard has fallen', () => {
  const fallen = () => apply(mobGame(), { type: 'destroy', unitId: 'mob' })

  it('stops leading and is a unit of its own', () => {
    const g = fallen()
    const characterOf = g.units.find((u) => u.id === 'boss')!
    expect(hostOf(characterOf, g.units)).toBeUndefined()
    expect(wholeUnitOf(characterOf, g.units).map((u) => u.id)).toEqual(['boss'])
    // The destroyed mob no longer drags its characters in either.
    expect(wholeUnitOf(g.units[0]!, g.units).map((u) => u.id)).toEqual(['mob'])
  })

  it('is not shocked along with the host', () => {
    const g = apply(fallen(), { type: 'toggleStatus', unitId: 'boss', status: 'battleShocked' })
    expect(g.units.filter((u) => u.statuses.includes('battleShocked')).map((u) => u.id)).toEqual(['boss'])
  })

  it('goes back to leading when the bodyguard is restored', () => {
    const g = apply(fallen(), { type: 'revive', unitId: 'mob' })
    const characterOf = g.units.find((u) => u.id === 'boss')!
    expect(hostOf(characterOf, g.units)?.id).toBe('mob')
    expect(wholeUnitOf(characterOf, g.units).map((u) => u.id)).toEqual(['mob', 'boss', 'medic'])
  })
})

// --- the rules read with each member's own facts -----------------------------

const ds = (id: string, name: string, abilities: { id: string; name: string; text: string }[] = []): Datasheet =>
  ({
    id,
    name,
    keywords: ['INFANTRY'],
    factionKeywords: [],
    type: 'unit',
    stats: [{ name, w: '1' }],
    weapons: [],
    abilities: abilities.map((a) => ({ ...a, kind: 'datasheet' as const })),
    models: [],
    associations: [],
    constraints: [],
    sources: ['bsdata'],
  }) as unknown as Datasheet

const lordText = 'While this model is leading a unit, this unit has a 4+ **Sv**.'
const catalogue = {
  id: 'cat',
  name: 'Test',
  revision: 1,
  gameSystemId: 'gs',
  detachments: [],
  rules: [],
  unsupported: [],
  enhancements: [],
  datasheets: [
    ds('ds-mob', 'Mob'),
    ds('ds-boss', 'Boss', [{ id: 'a1', name: 'Warband', text: lordText }]),
  ],
} as unknown as ParsedCatalogue

describe('"while this model is leading a unit" on the bodyguard’s card', () => {
  const sheets = new Map(catalogue.datasheets.map((d) => [d.id, d]))
  const bossUnit = (): GameUnit => ({ ...unit('boss', 1, { leaderOf: 'mob' }), entryId: 'ds-boss' })
  const mobUnit = (): GameUnit => ({ ...unit('mob', 10), entryId: 'ds-mob' })

  it('is met while the character stands with it', () => {
    const units = [mobUnit(), bossUnit()]
    const { mods } = effectsForUnit({
      unit: units[0]!,
      sheet: sheets.get('ds-mob'),
      catalogue,
      detachmentNames: [],
      attached: attachedFamily(units[0]!, units, sheets),
    })
    const sv = mods.find((m) => m.stat === 'SV')
    expect(sv?.value).toBe('4+')
    expect(sv && isLive(sv)).toBe(true)
  })

  it('is not met once the bodyguard is gone', () => {
    const units = [{ ...mobUnit(), destroyed: true }, bossUnit()]
    const { mods } = effectsForUnit({
      unit: units[1]!,
      sheet: sheets.get('ds-boss'),
      catalogue,
      detachmentNames: [],
      attached: attachedFamily(units[1]!, units, sheets),
    })
    const sv = mods.find((m) => m.stat === 'SV')
    expect(sv && isLive(sv)).toBeFalsy()
  })
})
