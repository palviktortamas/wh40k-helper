import { describe, expect, it } from 'vitest'
import { effectsForUnit } from './unitEffects'
import type { Datasheet, ParsedCatalogue } from '@/data/model'
import type { GameUnit } from './types'

// Invented data and invented rules — the repo must contain no real game data.

const sheet = (id: string, name: string, abilities: { id: string; name: string; text: string }[] = []): Datasheet =>
  ({
    id,
    name,
    keywords: ['INFANTRY'],
    factionKeywords: ['GREENSKINS'],
    type: 'unit',
    stats: [{ name, w: '1' }],
    weapons: [],
    abilities: abilities.map((a) => ({ ...a, kind: 'datasheet' as const })),
    models: [],
    associations: [],
    constraints: [],
    sources: ['bsdata'],
  }) as unknown as Datasheet

const catalogue = {
  id: 'cat',
  name: 'Test',
  revision: 1,
  gameSystemId: 'gs',
  detachments: [],
  rules: [],
  unsupported: [],
  enhancements: [
    { id: 'enh-unit', name: 'Banner', kind: 'enhancement', text: 'This unit has 4+ **Sv**.' },
    { id: 'enh-model', name: 'Boosta', kind: 'enhancement', text: 'This model has +2" **M**.' },
  ],
  datasheets: [sheet('ds-mob', 'Mob'), sheet('ds-boss', 'Boss')],
} as unknown as ParsedCatalogue

const unit = (id: string, entryId: string, name: string): GameUnit =>
  ({
    id,
    name,
    entryId,
    points: 0,
    isCharacter: false,
    isWarlord: false,
    models: [],
    statuses: [],
    destroyed: false,
    usedOnce: [],
  }) as unknown as GameUnit

const mob = unit('u1', 'ds-mob', 'Mob')

describe('a unit and the characters attached to it', () => {
  it('takes what a leader’s enhancement gives the whole unit', () => {
    const { mods } = effectsForUnit({
      unit: mob,
      sheet: catalogue.datasheets[0]!,
      catalogue,
      detachmentNames: [],
      attached: [
        { name: 'Boss', sheet: catalogue.datasheets[1]!, enhancements: [{ id: 'enh-unit', name: 'Banner' }] },
      ],
    })
    expect(mods.map((m) => [m.stat, m.value, m.source])).toEqual([['SV', '4+', 'Enhancement · Boss']])
  })

  it('leaves what it gives the bearer alone with the bearer', () => {
    const { mods } = effectsForUnit({
      unit: mob,
      sheet: catalogue.datasheets[0]!,
      catalogue,
      detachmentNames: [],
      attached: [
        { name: 'Boss', sheet: catalogue.datasheets[1]!, enhancements: [{ id: 'enh-model', name: 'Boosta' }] },
      ],
    })
    expect(mods).toEqual([])
  })

  it('carries the unit’s own enhancement to the character too', () => {
    // Shown on the character's card: it is one unit, so "this unit" reaches it.
    const boss = { ...unit('u2', 'ds-boss', 'Boss'), leaderOf: 'u1' }
    const { mods } = effectsForUnit({
      unit: boss,
      sheet: catalogue.datasheets[1]!,
      catalogue,
      detachmentNames: [],
      attached: [
        { name: 'Mob', sheet: catalogue.datasheets[0]!, enhancements: [{ id: 'enh-unit', name: 'Banner' }] },
      ],
    })
    expect(mods.map((m) => [m.stat, m.source])).toEqual([['SV', 'Enhancement · Mob']])
  })

  it('does not say the same thing twice when both carry the rule', () => {
    const shared = [{ id: 'a1', name: 'Waaagh', text: "This unit's melee attacks have **[SUSTAINED HITS 1]**." }]
    const { grants } = effectsForUnit({
      unit: mob,
      sheet: sheet('ds-mob', 'Mob', shared),
      catalogue,
      detachmentNames: [],
      attached: [{ name: 'Boss', sheet: sheet('ds-boss', 'Boss', shared) }],
    })
    expect(grants.map((g) => [g.keyword, g.source])).toEqual([['SUSTAINED HITS 1', 'Datasheet']])
  })
})

describe('a state belongs to the whole attached unit', () => {
  // A codex state, granted by one rule and read by another (see play/marks.ts).
  const stateful = {
    ...catalogue,
    rules: [
      {
        id: 'r-state',
        name: 'War Chant',
        kind: 'faction',
        text: 'Friendly **GREENSKINS** units are **worked up**. While a unit is **worked up**, that unit has 5+ **InSv**.',
      },
    ],
  } as unknown as ParsedCatalogue
  const marks = [{ key: 'worked up', label: 'worked up' }]

  it('gives the character the save when it carries the same rule itself', () => {
    // The real shape, and the one that bit: a faction rule is printed on every
    // datasheet, so the character has its own copy of it — waiting on a state
    // the character is not in, while the unit it has joined is. Deduplicating
    // by rule alone let that waiting copy shadow the live one, and the
    // character kept a save it should have had.
    const both = {
      ...stateful,
      datasheets: [
        sheet('ds-mob', 'Mob', [{ id: 'r-state', name: 'War Chant', text: stateful.rules[0]!.text }]),
        sheet('ds-boss', 'Boss', [{ id: 'r-state', name: 'War Chant', text: stateful.rules[0]!.text }]),
      ],
    } as unknown as ParsedCatalogue
    const boss = { ...unit('u2', 'ds-boss', 'Boss'), leaderOf: 'u1' }
    const { mods } = effectsForUnit({
      unit: boss,
      sheet: both.datasheets[1]!,
      catalogue: both,
      detachmentNames: [],
      marks,
      attached: [{ name: 'Mob', sheet: both.datasheets[0]!, marks: ['worked up'] }],
    })
    expect(mods.find((m) => m.stat === 'INVSV')?.met).toBe(true)
  })

  it('gives the character the save the unit’s state grants, even with none printed', () => {
    // The character is part of the unit the state is on, so it is in that
    // state too — and an invulnerable save it does not print is exactly the
    // one a player will not think to look for.
    const boss = { ...unit('u2', 'ds-boss', 'Boss'), leaderOf: 'u1' }
    const { mods } = effectsForUnit({
      unit: boss,
      sheet: catalogue.datasheets[1]!,
      catalogue: stateful,
      detachmentNames: [],
      marks,
      attached: [{ name: 'Mob', sheet: catalogue.datasheets[0]!, marks: ['worked up'] }],
    })
    const inv = mods.find((m) => m.stat === 'INVSV')
    expect(inv).toBeDefined()
    expect(inv!.met).toBe(true)
  })

  it('leaves the save waiting when nobody in the unit is in that state', () => {
    const boss = { ...unit('u2', 'ds-boss', 'Boss'), leaderOf: 'u1' }
    const { mods } = effectsForUnit({
      unit: boss,
      sheet: catalogue.datasheets[1]!,
      catalogue: stateful,
      detachmentNames: [],
      marks,
      attached: [{ name: 'Mob', sheet: catalogue.datasheets[0]!, marks: [] }],
    })
    expect(mods.find((m) => m.stat === 'INVSV')?.met ?? false).toBe(false)
  })
})
