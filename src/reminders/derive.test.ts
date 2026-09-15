import { describe, expect, it } from 'vitest'
import type { ParsedCatalogue } from '@/data/model'
import type { Game } from '@/play/types'
import { doneKey, groupByRule, isDone, remindersForCatalogue, remindersForGame, showsNow } from './derive'
import type { Reminder, ReminderOverride } from './types'

// Everything invented — the repo holds no real game data.

const catalogue: ParsedCatalogue = {
  id: 'cat',
  name: 'Faction',
  revision: 1,
  gameSystemId: 'gs',
  rules: [],
  unsupported: [],
  enhancements: [{ id: 'enh-1', name: 'Shiny Hat', kind: 'enhancement', text: 'Once per battle, in your Command phase, gain 1 CP.' }],
  detachments: [
    {
      name: 'Loud Detachment',
      forceDispositions: [],
      enhancements: [],
      rules: [{ id: 'det-1', name: 'Loudness', kind: 'detachment', text: 'Each time a unit is selected to charge, add 1 to the roll.' }],
      sources: ['bsdata'],
    },
    {
      name: 'Quiet Detachment',
      forceDispositions: [],
      enhancements: [],
      rules: [{ id: 'det-2', name: 'Quietness', kind: 'detachment', text: 'In your Shooting phase, this unit may not be seen.' }],
      sources: ['bsdata'],
    },
  ],
  datasheets: [
    {
      id: 'ds-a',
      name: 'Grunts',
      keywords: [],
      factionKeywords: [],
      type: 'unit',
      stats: [],
      weapons: [],
      abilities: [
        { id: 'army-1', name: 'Army Shout', kind: 'faction', text: 'In your Command phase, shout.' },
        { id: 'ab-1', name: 'Dig In', kind: 'datasheet', text: 'In your Movement phase, this unit may dig in.' },
        { id: 'ab-2', name: 'Thick Skin', kind: 'datasheet', text: 'This unit has a 5+ invulnerable save.' },
      ],
      models: [],
      associations: [],
      constraints: [],
      sources: ['bsdata'],
    },
  ],
}

const game = (over: Partial<Game> = {}): Game => ({
  id: 'g',
  rosterId: 'r',
  rosterName: 'Test',
  catalogueId: 'cat',
  factionName: 'Faction',
  detachmentNames: ['Loud Detachment'],
  pointsLimit: 1000,
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
  opponent: { cp: 0, vpPrimary: 0, vpSecondary: 0 },
  units: [
    { id: 'u1', name: 'Grunts', entryId: 'ds-a', points: 50, isCharacter: false, isWarlord: false, models: [], statuses: [], destroyed: false, usedOnce: [], enhancements: [{ id: 'enh-1', name: 'Shiny Hat' }] },
    { id: 'u2', name: 'Grunts', entryId: 'ds-a', points: 50, isCharacter: false, isWarlord: false, models: [], statuses: [], destroyed: false, usedOnce: [] },
    { id: 'u3', name: 'Grunts', entryId: 'ds-a', points: 50, isCharacter: false, isWarlord: false, models: [], statuses: [], destroyed: true, usedOnce: [] },
  ],
  vpByRound: {},
  log: [],
  undo: [],
  ...over,
})

describe('reminders for a game', () => {
  it('lists army rules once, the detachment rules, and each living unit\'s abilities and enhancements', () => {
    const list = remindersForGame(game(), catalogue, new Map())
    const army = list.filter((r) => r.owner === 'army')
    expect(army.map((r) => r.id)).toEqual(['army-1'])
    expect(list.filter((r) => r.owner === 'detachment').map((r) => r.trigger)).toEqual(['charge_phase'])
    const u1 = list.filter((r) => r.unitId === 'u1')
    expect(u1.map((r) => r.sourceName)).toEqual(['Dig In', 'Thick Skin', 'Shiny Hat'])
    expect(u1.find((r) => r.id === 'enh-1')).toMatchObject({ trigger: 'command_phase', once: 'battle', enabled: true })
    expect(u1.find((r) => r.id === 'ab-2')?.enabled).toBe(false)
    // The destroyed copy raises nothing; the second living copy does.
    expect(list.filter((r) => r.unitId === 'u3')).toHaveLength(0)
    expect(list.filter((r) => r.unitId === 'u2')).toHaveLength(2)
  })

  it('lists the rules of every detachment the army took', () => {
    const list = remindersForGame(game({ detachmentNames: ['Loud Detachment', 'Quiet Detachment'] }), catalogue, new Map())
    const detachment = list.filter((r) => r.owner === 'detachment')

    expect(detachment.map((r) => r.id)).toEqual(['det-1', 'det-2'])
    expect(detachment.map((r) => r.sourceName)).toEqual(['Loudness', 'Quietness'])
  })

  it('raises no detachment reminders for an army that took none', () => {
    const list = remindersForGame(game({ detachmentNames: [] }), catalogue, new Map())
    expect(list.filter((r) => r.owner === 'detachment')).toEqual([])
  })

  it('applies overrides by rule id to every copy', () => {
    const overrides = new Map<string, ReminderOverride>([
      ['ab-2', { id: 'ab-2', enabled: true, trigger: 'when_targeted', text: 'Invuln 5+', updatedAt: 0 }],
    ])
    const list = remindersForGame(game(), catalogue, overrides).filter((r) => r.id === 'ab-2')
    expect(list).toHaveLength(2)
    for (const r of list) expect(r).toMatchObject({ enabled: true, trigger: 'when_targeted', text: 'Invuln 5+' })
  })

  it('shows the right triggers per phase and turn', () => {
    const r = (trigger: Reminder['trigger']): Reminder => ({ id: 'x', sourceName: 'X', owner: 'army', trigger, text: '', enabled: true })
    expect(showsNow(r('command_phase'), { round: 1, phase: 'command', turn: 'me' })).toBe(true)
    expect(showsNow(r('command_phase'), { round: 1, phase: 'command', turn: 'opponent' })).toBe(false)
    expect(showsNow(r('start_of_battle'), { round: 1, phase: 'command', turn: 'me' })).toBe(true)
    expect(showsNow(r('start_of_battle'), { round: 2, phase: 'command', turn: 'me' })).toBe(false)
    expect(showsNow(r('when_charged'), { round: 1, phase: 'charge', turn: 'opponent' })).toBe(true)
    expect(showsNow(r('when_charged'), { round: 1, phase: 'charge', turn: 'me' })).toBe(false)
    expect(showsNow(r('opponent_turn'), { round: 1, phase: 'movement', turn: 'opponent' })).toBe(true)
    expect(showsNow(r('end_of_turn'), { round: 1, phase: 'fight', turn: 'me' })).toBe(true)
    expect(showsNow(r('once_per_battle'), { round: 1, phase: 'command', turn: 'me' })).toBe(true)
    expect(showsNow({ ...r('command_phase'), enabled: false }, { round: 1, phase: 'command', turn: 'me' })).toBe(false)
  })

  it('keys ticks per turn, and once-per-battle ones for the whole game, honouring the datasheet checkbox', () => {
    const list = remindersForGame(game(), catalogue, new Map())
    const dig = list.find((r) => r.unitId === 'u1' && r.id === 'ab-1')!
    const hat = list.find((r) => r.unitId === 'u1' && r.id === 'enh-1')!
    expect(doneKey(dig, { round: 2, turn: 'me' })).toBe('2:me:u1:ab-1')
    expect(doneKey(hat, { round: 2, turn: 'me' })).toBe('battle:u1:enh-1')
    const g = game()
    g.units[0]!.usedOnce = ['enh-1']
    expect(isDone(hat, g, g.units[0])).toBe(true)
    expect(isDone(dig, g, g.units[0])).toBe(false)
    expect(isDone(dig, { ...g, remindersDone: { '1:me:u1:ab-1': true } }, g.units[0])).toBe(true)
  })

  it('lists a whole catalogue for the settings screen, grouped', () => {
    const groups = remindersForCatalogue(catalogue, new Map())
    expect(groups.map((g) => g.group)).toEqual([
      'Army rules',
      'Detachment: Loud Detachment',
      'Detachment: Quiet Detachment',
      'Enhancements',
      'Grunts',
    ])
    expect(groups[4]!.reminders.map((r) => r.id)).toEqual(['ab-1', 'ab-2'])
  })
})

describe('groupByRule', () => {
  const reminder = (over: Partial<Reminder>): Reminder => ({
    id: 'ab-1',
    sourceName: 'Dig In',
    owner: 'unit',
    trigger: 'movement_phase',
    text: 'Dig in.',
    enabled: true,
    ...over,
  })

  it('folds the same rule on several units into one entry with every unit as a member', () => {
    const grouped = groupByRule([
      reminder({ ownerName: 'Grunts #1', unitId: 'u1' }),
      reminder({ ownerName: 'Grunts #2', unitId: 'u2' }),
      reminder({ id: 'ab-9', sourceName: 'Other', ownerName: 'Grunts #1', unitId: 'u1' }),
    ])
    expect(grouped.map((g) => g.members.length)).toEqual([2, 1])
    expect(grouped[0]!.members.map((m) => m.ownerName)).toEqual(['Grunts #1', 'Grunts #2'])
    expect(grouped[0]!.first.sourceName).toBe('Dig In')
  })

  it('keeps an army rule and a unit rule with the same id apart, and keeps the order of first appearance', () => {
    const grouped = groupByRule([
      reminder({ id: 'x', owner: 'army' }),
      reminder({ id: 'y', ownerName: 'A', unitId: 'u1' }),
      reminder({ id: 'x', owner: 'unit', ownerName: 'A', unitId: 'u1' }),
    ])
    expect(grouped.map((g) => `${g.first.owner}:${g.first.id}`)).toEqual(['army:x', 'unit:y', 'unit:x'])
  })
})
