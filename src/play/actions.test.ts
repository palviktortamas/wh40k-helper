import { describe, expect, it } from 'vitest'
import { apply, isBattleOver } from './actions'
import { defaultCasualtyGroup, emptyMission, totalVp, type Game, type GameUnit } from './types'

// Everything here is invented — the repo must contain no real game data.

const unit = (id: string, groups: { id: string; total: number; wounds: number }[]): GameUnit => ({
  id,
  name: `Unit ${id}`,
  entryId: `e-${id}`,
  points: 100,
  isCharacter: false,
  isWarlord: false,
  models: groups.map((g) => ({
    id: g.id,
    name: `Model ${g.id}`,
    total: g.total,
    alive: g.total,
    wounds: g.wounds,
    currentWounds: g.wounds,
    weapons: [{ name: `Gun ${g.id}`, perModel: 1 }],
  })),
  statuses: [],
  destroyed: false,
  usedOnce: [],
})

const game = (): Game => ({
  id: 'g',
  rosterId: 'r',
  rosterName: 'Test',
  catalogueId: 'c',
  factionName: 'Faction',
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
  opponent: { cp: 0, vpPrimary: 0, vpSecondary: 0 },
  units: [unit('a', [{ id: 'a1', total: 10, wounds: 1 }, { id: 'a2', total: 2, wounds: 1 }]), unit('b', [{ id: 'b1', total: 1, wounds: 6 }])],
  vpByRound: {},
  log: [],
  undo: [],
})

const steps = (g: Game, n: number): Game => {
  let current = g
  for (let i = 0; i < n; i++) current = apply(current, { type: 'nextPhase' })
  return current
}

describe('game actions', () => {
  it('walks the phases, hands the turn over, and starts the next round', () => {
    let g = game()
    g = steps(g, 4)
    expect(g.phase).toBe('fight')
    expect(g.turn).toBe('me')
    g = steps(g, 1)
    expect(g.turn).toBe('opponent')
    expect(g.phase).toBe('command')
    // The opponent gains 1 CP at the start of their Command phase.
    expect(g.opponent.cp).toBe(1)
    g = steps(g, 5)
    expect(g.round).toBe(2)
    expect(g.turn).toBe('me')
    expect(g.me.cp).toBe(2)
    expect(g.vpByRound[1]).toEqual({ me: 0, opponent: 0 })
  })

  it('goes back a phase and back across a turn boundary, taking the CP back', () => {
    let g = steps(game(), 5)
    expect(g.turn).toBe('opponent')
    g = apply(g, { type: 'prevPhase' })
    expect(g.turn).toBe('me')
    expect(g.phase).toBe('fight')
    expect(g.opponent.cp).toBe(0)
    // Cannot go before the first Command phase.
    const start = game()
    expect(apply(start, { type: 'prevPhase' })).toBe(start)
  })

  it('clears turn-scoped statuses when the turn ends', () => {
    let g = apply(game(), { type: 'toggleStatus', unitId: 'a', status: 'advanced' })
    g = apply(g, { type: 'toggleStatus', unitId: 'a', status: 'battleShocked' })
    g = steps(g, 5)
    expect(g.units[0]!.statuses).toEqual(['battleShocked'])
  })

  it('removes a model from the chosen group and destroys the unit when none remain', () => {
    let g = apply(game(), { type: 'removeModel', unitId: 'a', groupId: 'a2' })
    expect(g.units[0]!.models[1]!.alive).toBe(1)
    expect(g.units[0]!.models[0]!.alive).toBe(10)
    for (let i = 0; i < 11; i++) g = apply(g, { type: 'removeModel', unitId: 'a', groupId: i < 10 ? 'a1' : 'a2' })
    expect(g.units[0]!.destroyed).toBe(true)
    expect(g.log.at(-1)!.text).toContain('unit destroyed')
  })

  it('tracks wounds on the current model and does not carry excess damage over', () => {
    let g = apply(game(), { type: 'damage', unitId: 'b', groupId: 'b1', amount: 4 })
    expect(g.units[1]!.models[0]!.currentWounds).toBe(2)
    g = apply(g, { type: 'damage', unitId: 'b', groupId: 'b1', amount: 5 })
    expect(g.units[1]!.models[0]!.alive).toBe(0)
    expect(g.units[1]!.destroyed).toBe(true)
    // Revive restores full strength.
    g = apply(g, { type: 'revive', unitId: 'b' })
    expect(g.units[1]!.models[0]!.currentWounds).toBe(6)
    expect(g.units[1]!.destroyed).toBe(false)
  })

  it('scores VP per player and kind, never below zero', () => {
    let g = apply(game(), { type: 'adjustVp', side: 'me', kind: 'primary', delta: 5 })
    g = apply(g, { type: 'adjustVp', side: 'me', kind: 'secondary', delta: 3 })
    g = apply(g, { type: 'adjustVp', side: 'opponent', kind: 'primary', delta: -2 })
    expect(totalVp(g.me)).toBe(8)
    expect(totalVp(g.opponent)).toBe(0)
  })

  it('undoes the last action, and the one before that', () => {
    const start = game()
    let g = apply(start, { type: 'removeModel', unitId: 'a', groupId: 'a1' })
    g = apply(g, { type: 'adjustCp', side: 'me', delta: 2 })
    expect(g.me.cp).toBe(3)
    g = apply(g, { type: 'undo' })
    expect(g.me.cp).toBe(1)
    expect(g.units[0]!.models[0]!.alive).toBe(9)
    g = apply(g, { type: 'undo' })
    expect(g.units[0]!.models[0]!.alive).toBe(10)
    // Nothing left to undo is a no-op.
    expect(apply(g, { type: 'undo' })).toBe(g)
  })

  it('ends the game with a result, and undo reopens it', () => {
    let g = apply(game(), { type: 'adjustVp', side: 'me', kind: 'primary', delta: 10 })
    g = apply(g, { type: 'endGame' })
    expect(g.status).toBe('finished')
    expect(g.result?.winner).toBe('me')
    expect(g.result?.me).toBe(10)
    // A finished game ignores further play actions.
    expect(apply(g, { type: 'nextPhase' })).toBe(g)
    g = apply(g, { type: 'undo' })
    expect(g.status).toBe('active')
    expect(g.result).toBeUndefined()
  })

  it('knows when the last battle round is over', () => {
    let g = game()
    expect(isBattleOver(g)).toBe(false)
    g = steps(g, 10 * 4 + 9)
    expect(g.round).toBe(5)
    expect(g.turn).toBe('opponent')
    expect(g.phase).toBe('fight')
    expect(isBattleOver(g)).toBe(true)
  })

  it('embarks a unit, shows it as embarked, and spills it when the transport dies', () => {
    let g = apply(game(), { type: 'embark', unitId: 'a', transportId: 'b' })
    expect(g.units[0]!.embarkedIn).toBe('b')
    expect(g.units[0]!.statuses).toEqual(['embarked'])
    // A unit cannot embark in itself.
    expect(apply(g, { type: 'embark', unitId: 'a', transportId: 'a' })).toBe(g)
    g = apply(g, { type: 'destroy', unitId: 'b' })
    expect(g.units[0]!.embarkedIn).toBeUndefined()
    expect(g.units[0]!.statuses).toEqual([])
    expect(g.log.at(-1)!.text).toContain('disembarks')
    // Undo restores the embarkation along with the transport.
    g = apply(g, { type: 'undo' })
    expect(g.units[0]!.embarkedIn).toBe('b')
    g = apply(g, { type: 'disembark', unitId: 'a' })
    expect(g.units[0]!.embarkedIn).toBeUndefined()
  })

  it('runs the Tactical secondary deck: draw, score with the round cap, discard for CP, redraw once', () => {
    const start: Game = {
      ...game(),
      mission: {
        ...emptyMission(),
        secondaryMode: 'tactical',
        deck: ['c1', 'c2', 'c3', 'c4', 'c5'],
      },
    }
    let g = apply(start, { type: 'drawSecondaries' })
    expect(g.mission!.active).toEqual(['c1', 'c2'])
    expect(g.mission!.deck).toEqual(['c3', 'c4', 'c5'])

    // Scoring an achieved card adds VP and discards it.
    g = apply(g, { type: 'scoreSecondary', cardId: 'c1', label: 'C1', vp: 5, discard: true })
    expect(g.me.vpSecondary).toBe(5)
    expect(g.mission!.active).toEqual(['c2'])
    expect(g.mission!.discarded).toEqual(['c1'])

    // Discarding on your own turn is worth 1 CP, once per turn.
    g = apply(g, { type: 'discardSecondary', cardId: 'c2', label: 'C2' })
    expect(g.me.cp).toBe(2)
    g = apply(g, { type: 'drawSecondaries' })
    g = apply(g, { type: 'discardSecondary', cardId: 'c3', label: 'C3' })
    expect(g.me.cp).toBe(2)

    // The once-per-battle 1 CP discard-and-redraw.
    g = apply(g, { type: 'discardRedraw', cardId: 'c4', label: 'C4' })
    expect(g.me.cp).toBe(1)
    expect(g.mission!.active).toEqual(['c5'])
    expect(g.mission!.discardRedrawUsed).toBe(true)
    expect(apply(g, { type: 'discardRedraw', cardId: 'c5', label: 'C5' })).toBe(g)

    // 15 VP per battle round on secondaries.
    g = apply(g, { type: 'scoreSecondary', cardId: 'c5', label: 'C5', vp: 12, discard: false })
    expect(g.me.vpSecondary).toBe(15)
    expect(g.log.at(-1)!.text).toContain('capped')
    // A new battle round resets the cap.
    g = steps(g, 10)
    expect(g.round).toBe(2)
    expect(g.mission!.secondaryThisRound).toBe(0)
  })

  it('ticks and unticks primary scoring lines', () => {
    const start: Game = { ...game(), mission: { ...emptyMission(), myPrimaryId: 'p1' } }
    let g = apply(start, { type: 'scorePrimary', key: '1:0:0', label: 'Hold more', vp: 2 })
    g = apply(g, { type: 'scorePrimary', key: '1:0:0', label: 'Hold more', vp: 2 })
    expect(g.me.vpPrimary).toBe(4)
    expect(g.mission!.primaryScored['1:0:0']).toBe(2)
    g = apply(g, { type: 'unscorePrimary', key: '1:0:0', label: 'Hold more', vp: 2 })
    expect(g.me.vpPrimary).toBe(2)
    expect(g.mission!.primaryScored['1:0:0']).toBe(1)
  })

  it('locks a once-per-battle ability and can unlock it', () => {
    let g = apply(game(), { type: 'toggleOnce', unitId: 'a', abilityId: 'ab1', label: 'Shout' })
    expect(g.units[0]!.usedOnce).toEqual(['ab1'])
    g = apply(g, { type: 'toggleOnce', unitId: 'a', abilityId: 'ab1', label: 'Shout' })
    expect(g.units[0]!.usedOnce).toEqual([])
  })

  it('keeps a per-card counter (undoable, never negative) and a note (not an undo step)', () => {
    const start: Game = { ...game(), mission: { ...emptyMission(), myPrimaryId: 'p1' } }
    let g = apply(start, { type: 'adjustCardCounter', cardId: 'p1', label: 'Markers', delta: 1 })
    g = apply(g, { type: 'adjustCardCounter', cardId: 'p1', label: 'Markers', delta: 1 })
    expect(g.mission!.cardCounters!.p1).toBe(2)
    expect(g.log.at(-1)!.text).toMatch(/counter \+1 → 2/)
    const below = apply(g, { type: 'adjustCardCounter', cardId: 'p1', label: 'Markers', delta: -5 })
    expect(below.mission!.cardCounters!.p1).toBe(0)
    // Undo takes the counter back.
    expect(apply(g, { type: 'undo' }).mission!.cardCounters!.p1).toBe(1)
    const undoDepth = g.undo.length
    g = apply(g, { type: 'setCardNote', cardId: 'p1', note: 'Objective 3 is trapped' })
    expect(g.mission!.cardNotes!.p1).toBe('Objective 3 is trapped')
    expect(g.undo.length).toBe(undoDepth)
    // Undoing the counter keeps the note typed afterwards; a unit note survives too.
    const noted = apply(g, { type: 'setNote', unitId: 'a', note: 'holding the left flank' })
    const undone = apply(noted, { type: 'undo' })
    expect(undone.mission!.cardCounters!.p1).toBe(1)
    expect(undone.mission!.cardNotes!.p1).toBe('Objective 3 is trapped')
    expect(undone.units[0]!.note).toBe('holding the left flank')
    g = apply(g, { type: 'setCardNote', cardId: 'p1', note: '' })
    expect(g.mission!.cardNotes).toEqual({})
    // Games from before the trackers have no maps at all.
    const legacy: Game = { ...start, mission: { ...start.mission! } }
    delete legacy.mission!.cardCounters
    expect(apply(legacy, { type: 'adjustCardCounter', cardId: 'p1', label: 'Markers', delta: 1 }).mission!.cardCounters!.p1).toBe(1)
  })

  it('brings a unit in from Reserves or Deep Strike and says which', () => {
    let g = apply(game(), { type: 'toggleStatus', unitId: 'a', status: 'deepStrike' })
    expect(apply(g, { type: 'arrive', unitId: 'b' })).toBe(g) // not in reserves: no-op
    g = apply(g, { type: 'arrive', unitId: 'a' })
    expect(g.units[0]!.statuses).toEqual([])
    expect(g.log.at(-1)!.text).toMatch(/arrives from Deep Strike/)
    g = apply(g, { type: 'toggleStatus', unitId: 'a', status: 'reserves' })
    g = apply(g, { type: 'arrive', unitId: 'a' })
    expect(g.log.at(-1)!.text).toMatch(/arrives from Strategic Reserves/)
  })
})

describe('reminders in a game', () => {
  it('ticks a reminder, locks a once-per-battle one as the ability used, and undoes', () => {
    let g = apply(game(), { type: 'checkReminder', key: '1:me:a:ab1', label: 'Dig In', unitId: 'a', abilityId: 'ab1' })
    expect(g.remindersDone).toEqual({ '1:me:a:ab1': true })
    expect(g.units[0]!.usedOnce).toEqual([])
    // The very first tick undoes to "nothing ticked", not to a stale map.
    expect(apply(g, { type: 'undo' }).remindersDone).toBeUndefined()
    g = apply(g, { type: 'checkReminder', key: 'battle:a:ab2', label: 'Shout', unitId: 'a', abilityId: 'ab2', once: 'battle' })
    expect(g.units[0]!.usedOnce).toEqual(['ab2'])
    expect(g.log.at(-1)!.text).toMatch(/Shout used \(once per battle\)/)
    // Ticking again unticks and frees the ability.
    g = apply(g, { type: 'checkReminder', key: 'battle:a:ab2', label: 'Shout', unitId: 'a', abilityId: 'ab2', once: 'battle' })
    expect(g.units[0]!.usedOnce).toEqual([])
    expect(g.remindersDone).toEqual({ '1:me:a:ab1': true })
    g = apply(g, { type: 'undo' })
    expect(g.units[0]!.usedOnce).toEqual(['ab2'])
  })
})

describe('default casualty order', () => {
  it('takes the largest living group first and the lone model last', () => {
    const u = unit('a', [
      { id: 'sarge', total: 1, wounds: 1 },
      { id: 'special', total: 2, wounds: 1 },
      { id: 'plain', total: 7, wounds: 1 },
    ])
    expect(defaultCasualtyGroup(u)?.id).toBe('plain')
    u.models[2]!.alive = 0
    expect(defaultCasualtyGroup(u)?.id).toBe('special')
    u.models[1]!.alive = 0
    expect(defaultCasualtyGroup(u)?.id).toBe('sarge')
    u.models[0]!.alive = 0
    expect(defaultCasualtyGroup(u)).toBeUndefined()
  })
})
