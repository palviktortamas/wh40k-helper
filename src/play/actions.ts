/**
 * Every change to a game goes through `apply`, which records the previous
 * state for undo and writes a log line. Pure: screens call it and persist the
 * result, tests call it directly.
 */

import {
  LAST_ROUND,
  PHASES,
  PHASE_LABELS,
  RESERVE_STATUSES,
  SECONDARY_ROUND_CAP,
  STATUS_LABELS,
  TACTICAL_DRAW,
  TURN_STATUSES,
  UNDO_DEPTH,
  totalVp,
  type Game,
  type GameState,
  type MissionState,
  type Phase,
  type Side,
  type UnitStatus,
} from './types'

export type GameAction =
  | { type: 'nextPhase' }
  | { type: 'prevPhase' }
  | { type: 'adjustCp'; side: Side; delta: number }
  | { type: 'adjustVp'; side: Side; kind: 'primary' | 'secondary'; delta: number }
  | { type: 'removeModel'; unitId: string; groupId: string }
  | { type: 'addModel'; unitId: string; groupId: string }
  | { type: 'damage'; unitId: string; groupId: string; amount: number }
  | { type: 'healModel'; unitId: string; groupId: string; amount: number }
  | { type: 'destroy'; unitId: string }
  | { type: 'revive'; unitId: string }
  | { type: 'toggleStatus'; unitId: string; status: UnitStatus }
  | { type: 'toggleMark'; unitId: string; mark: string; label: string }
  | { type: 'applyMark'; unitIds: string[]; mark: string; label: string; source: string }
  | { type: 'clearMarks' }
  | { type: 'toggleOnce'; unitId: string; abilityId: string; label: string }
  | { type: 'setNote'; unitId: string; note: string }
  | { type: 'embark'; unitId: string; transportId: string }
  | { type: 'disembark'; unitId: string }
  // Missions (spec §6.2)
  | { type: 'drawSecondaries'; count?: number }
  | { type: 'discardSecondary'; cardId: string; label: string }
  | { type: 'discardRedraw'; cardId: string; label: string }
  | { type: 'scoreSecondary'; cardId: string; label: string; vp: number; discard: boolean }
  | { type: 'scorePrimary'; key: string; label: string; vp: number }
  | { type: 'unscorePrimary'; key: string; label: string; vp: number }
  | { type: 'shuffleWhenDrawn'; cardId: string; label: string }
  | { type: 'adjustCardCounter'; cardId: string; label: string; delta: number }
  | { type: 'setCardNote'; cardId: string; note: string }
  | { type: 'arrive'; unitId: string }
  // Reminders (spec §6.4): tick one off; a once-per-battle one also marks the ability used.
  | { type: 'checkReminder'; key: string; label: string; unitId?: string; abilityId?: string; once?: 'battle' | 'turn' }
  // Stratagems: once per phase (Core Rules); using one spends its CP, tapping again takes it back.
  | { type: 'useStratagem'; key: string; id: string; name: string; cp: number }
  | { type: 'undo' }
  | { type: 'endGame' }

const snapshot = (game: Game): GameState => ({
  round: game.round,
  phase: game.phase,
  turn: game.turn,
  me: { ...game.me },
  opponent: { ...game.opponent },
  ...(game.mission
    ? {
        mission: {
          ...game.mission,
          fixedIds: [...game.mission.fixedIds],
          deck: [...game.mission.deck],
          active: [...game.mission.active],
          discarded: [...game.mission.discarded],
          primaryScored: { ...game.mission.primaryScored },
          cardCounters: { ...game.mission.cardCounters },
          cardNotes: { ...game.mission.cardNotes },
        },
      }
    : {}),
  units: game.units.map((u) => ({
    ...u,
    models: u.models.map((m) => ({ ...m, weapons: m.weapons.map((w) => ({ ...w })) })),
    statuses: [...u.statuses],
    ...(u.marks ? { marks: [...u.marks] } : {}),
    usedOnce: [...u.usedOnce],
  })),
  vpByRound: { ...game.vpByRound },
  ...(game.remindersDone ? { remindersDone: { ...game.remindersDone } } : {}),
  ...(game.stratagemsUsed ? { stratagemsUsed: { ...game.stratagemsUsed } } : {}),
})

const other = (side: Side): Side => (side === 'me' ? 'opponent' : 'me')

function withLog(game: Game, text: string): Game {
  return {
    ...game,
    log: [
      ...game.log,
      { at: Date.now(), round: game.round, phase: game.phase, turn: game.turn, text },
    ],
  }
}

/** Records the state before a change, so it can be undone. */
function remember(game: Game): Game {
  const undo = [...game.undo, snapshot(game)]
  return { ...game, undo: undo.slice(-UNDO_DEPTH) }
}

const unitName = (game: Game, unitId: string) =>
  game.units.find((u) => u.id === unitId)?.name ?? 'Unit'

function updateUnit(game: Game, unitId: string, fn: (unit: Game['units'][number]) => Game['units'][number]): Game {
  return { ...game, units: game.units.map((u) => (u.id === unitId ? fn(u) : u)) }
}

function updateGroup(
  game: Game,
  unitId: string,
  groupId: string,
  fn: (group: Game['units'][number]['models'][number]) => Game['units'][number]['models'][number],
): Game {
  return updateUnit(game, unitId, (unit) => {
    const models = unit.models.map((m) => (m.id === groupId ? fn(m) : m))
    const alive = models.reduce((sum, m) => sum + m.alive, 0)
    return { ...unit, models, destroyed: alive === 0 }
  })
}

/** Turn-scoped statuses drop when the turn ends. */
const clearTurnStatuses = (game: Game): Game => ({
  ...game,
  units: game.units.map((u) => ({
    ...u,
    statuses: u.statuses.filter((s) => !TURN_STATUSES.includes(s)),
  })),
})

function advance(game: Game): Game {
  const index = PHASES.indexOf(game.phase)
  if (index < PHASES.length - 1) {
    const phase = PHASES[index + 1]!
    return withLog({ ...game, phase }, `${PHASE_LABELS[phase]} phase`)
  }
  // End of a turn.
  let next = clearTurnStatuses(game)
  if (next.mission) next = { ...next, mission: { ...next.mission, cpForDiscardThisTurn: false } }
  const secondPlayer = other(game.firstTurn)
  if (game.turn === secondPlayer) {
    // A new battle round: the 15 VP secondary cap starts over.
    if (next.mission) next = { ...next, mission: { ...next.mission, secondaryThisRound: 0 } }
    // End of the battle round: record the score.
    next = {
      ...next,
      vpByRound: {
        ...next.vpByRound,
        [game.round]: { me: totalVp(game.me), opponent: totalVp(game.opponent) },
      },
      round: game.round + 1,
      turn: game.firstTurn,
      phase: 'command',
    }
    next = withLog(next, `Battle round ${next.round} begins`)
  } else {
    next = withLog(
      { ...next, turn: secondPlayer, phase: 'command' },
      `${secondPlayer === 'me' ? 'Your' : "Opponent's"} turn`,
    )
  }
  return grantCoreCp(next)
}

/**
 * 11th edition Core Rules, Command phase, "Gain Core CP" step: *both* players
 * gain 1 CP in every Command phase — the active player's and the opponent's
 * alike (verified 2026-09-13). Not "the active player gains 1 CP".
 */
function grantCoreCp(game: Game): Game {
  const next: Game = {
    ...game,
    me: { ...game.me, cp: game.me.cp + 1 },
    opponent: { ...game.opponent, cp: game.opponent.cp + 1 },
  }
  return withLog(next, 'Command phase: both players gain 1 CP')
}

const takeBackCoreCp = (game: Game): Game => ({
  ...game,
  me: { ...game.me, cp: Math.max(0, game.me.cp - 1) },
  opponent: { ...game.opponent, cp: Math.max(0, game.opponent.cp - 1) },
})

function retreat(game: Game): Game {
  const index = PHASES.indexOf(game.phase)
  if (index > 0) {
    const phase = PHASES[index - 1]!
    return withLog({ ...game, phase }, `Back to ${PHASE_LABELS[phase]} phase`)
  }
  if (game.round === 1 && game.turn === game.firstTurn) return game
  // Back into the previous turn's Fight phase; the CP this Command phase granted both players is taken back.
  let next: Game = takeBackCoreCp(game)
  if (game.turn === game.firstTurn) {
    const round = game.round - 1
    const { [round]: _dropped, ...vpByRound } = next.vpByRound
    void _dropped
    next = { ...next, round, turn: other(game.firstTurn), phase: 'fight', vpByRound }
  } else {
    next = { ...next, turn: game.firstTurn, phase: 'fight' }
  }
  return withLog(next, 'Back to the previous turn')
}

const setEmbarked = (unit: Game['units'][number], transportId: string | undefined) => {
  const { embarkedIn: _old, ...rest } = unit
  void _old
  const statuses = rest.statuses.filter((s) => s !== 'embarked')
  return transportId
    ? { ...rest, embarkedIn: transportId, statuses: [...statuses, 'embarked' as const] }
    : { ...rest, statuses }
}

/** A destroyed transport spills its passengers (emergency disembarkation). */
function evacuate(game: Game): Game {
  let next = game
  for (const unit of game.units) {
    if (!unit.embarkedIn) continue
    const transport = game.units.find((t) => t.id === unit.embarkedIn)
    if (transport && !transport.destroyed) continue
    next = withLog(
      updateUnit(next, unit.id, (u) => setEmbarked(u, undefined)),
      `${unit.name} disembarks — ${transport?.name ?? 'its transport'} was destroyed`,
    )
  }
  return next
}

export function apply(game: Game, action: GameAction): Game {
  if (game.status === 'finished' && action.type !== 'undo') return game
  const next = applyAction(game, action)
  return next === game ? game : evacuate(next)
}

const withMission = (game: Game, fn: (m: MissionState) => MissionState): Game =>
  game.mission ? { ...game, mission: fn(game.mission) } : game

function applyAction(game: Game, action: GameAction): Game {
  switch (action.type) {
    case 'drawSecondaries': {
      if (!game.mission || game.mission.secondaryMode !== 'tactical') return game
      const count = action.count ?? TACTICAL_DRAW
      const g = remember(game)
      const drawn = g.mission!.deck.slice(0, count)
      if (drawn.length === 0) return withLog(g, 'The Secondary Mission deck is empty')
      const next = withMission(g, (m) => ({
        ...m,
        deck: m.deck.slice(drawn.length),
        active: [...m.active, ...drawn],
      }))
      return withLog(next, `Drew ${drawn.length} Secondary Mission card${drawn.length === 1 ? '' : 's'}`)
    }
    case 'discardSecondary': {
      if (!game.mission?.active.includes(action.cardId)) return game
      const g = remember(game)
      // On your own turn, discarding one or more cards is worth 1 CP, once.
      const gainCp = g.turn === 'me' && !g.mission!.cpForDiscardThisTurn
      let next = withMission(g, (m) => ({
        ...m,
        active: m.active.filter((id) => id !== action.cardId),
        discarded: [...m.discarded, action.cardId],
        cpForDiscardThisTurn: m.cpForDiscardThisTurn || gainCp,
      }))
      if (gainCp) next = { ...next, me: { ...next.me, cp: next.me.cp + 1 } }
      return withLog(next, `Discarded ${action.label}${gainCp ? ' — +1 CP' : ''}`)
    }
    case 'discardRedraw': {
      if (!game.mission?.active.includes(action.cardId) || game.mission.discardRedrawUsed || game.me.cp < 1)
        return game
      const g = remember(game)
      const replacement = g.mission!.deck[0]
      const next = withMission(g, (m) => ({
        ...m,
        active: [...m.active.filter((id) => id !== action.cardId), ...(replacement ? [replacement] : [])],
        deck: m.deck.slice(replacement ? 1 : 0),
        discarded: [...m.discarded, action.cardId],
        discardRedrawUsed: true,
      }))
      return withLog(
        { ...next, me: { ...next.me, cp: next.me.cp - 1 } },
        `Spent 1 CP to discard ${action.label} and draw a replacement (once per battle)`,
      )
    }
    case 'shuffleWhenDrawn': {
      // A WHEN DRAWN rule: put the card back and draw another.
      if (!game.mission?.active.includes(action.cardId)) return game
      const g = remember(game)
      const replacement = g.mission!.deck[0]
      const rest = g.mission!.deck.slice(replacement ? 1 : 0)
      const at = Math.floor(Math.random() * (rest.length + 1))
      const next = withMission(g, (m) => ({
        ...m,
        active: [...m.active.filter((id) => id !== action.cardId), ...(replacement ? [replacement] : [])],
        deck: [...rest.slice(0, at), action.cardId, ...rest.slice(at)],
      }))
      return withLog(next, `${action.label} shuffled back into the deck; drew a new card`)
    }
    case 'scoreSecondary': {
      if (!game.mission) return game
      const g = remember(game)
      // The deck caps secondary VP at 15 per battle round (end-of-battle VP exempt).
      const room = Math.max(0, SECONDARY_ROUND_CAP - g.mission!.secondaryThisRound)
      const vp = Math.min(action.vp, room)
      let next: Game = {
        ...g,
        me: { ...g.me, vpSecondary: g.me.vpSecondary + vp },
        mission: { ...g.mission!, secondaryThisRound: g.mission!.secondaryThisRound + vp },
      }
      if (action.discard && next.mission!.secondaryMode === 'tactical')
        next = withMission(next, (m) => ({
          ...m,
          active: m.active.filter((id) => id !== action.cardId),
          discarded: [...m.discarded, action.cardId],
        }))
      const discarded = action.discard && next.mission!.secondaryMode === 'tactical'
      return withLog(
        next,
        vp === 0 && discarded
          ? `${action.label} achieved and discarded`
          : `${action.label}: +${vp} VP${vp < action.vp ? ` (capped at ${SECONDARY_ROUND_CAP} this round)` : ''}${
              discarded ? ' — card achieved and discarded' : ''
            }`,
      )
    }
    case 'scorePrimary': {
      if (!game.mission) return game
      const g = remember(game)
      const next: Game = {
        ...g,
        me: { ...g.me, vpPrimary: g.me.vpPrimary + action.vp },
        mission: {
          ...g.mission!,
          primaryScored: { ...g.mission!.primaryScored, [action.key]: (g.mission!.primaryScored[action.key] ?? 0) + 1 },
        },
      }
      return withLog(next, `Primary — ${action.label}: +${action.vp} VP`)
    }
    case 'unscorePrimary': {
      if (!game.mission?.primaryScored[action.key]) return game
      const g = remember(game)
      const times = g.mission!.primaryScored[action.key]! - 1
      const { [action.key]: _dropped, ...rest } = g.mission!.primaryScored
      void _dropped
      const next: Game = {
        ...g,
        me: { ...g.me, vpPrimary: Math.max(0, g.me.vpPrimary - action.vp) },
        mission: { ...g.mission!, primaryScored: times > 0 ? { ...rest, [action.key]: times } : rest },
      }
      return withLog(next, `Primary — ${action.label}: −${action.vp} VP`)
    }
    case 'adjustCardCounter': {
      if (!game.mission) return game
      const g = remember(game)
      const current = g.mission!.cardCounters?.[action.cardId] ?? 0
      const value = Math.max(0, current + action.delta)
      if (value === current) return game
      const next = withMission(g, (m) => ({ ...m, cardCounters: { ...m.cardCounters, [action.cardId]: value } }))
      return withLog(next, `${action.label}: counter ${action.delta > 0 ? '+' : ''}${action.delta} → ${value}`)
    }
    case 'setCardNote': {
      // Typing is not an undo step, like a unit note.
      if (!game.mission) return game
      const { [action.cardId]: _old, ...rest } = game.mission.cardNotes ?? {}
      void _old
      return withMission(game, (m) => ({
        ...m,
        cardNotes: action.note ? { ...rest, [action.cardId]: action.note } : rest,
      }))
    }
    case 'checkReminder': {
      const g = remember(game)
      const done = Boolean(g.remindersDone?.[action.key])
      const { [action.key]: _old, ...rest } = g.remindersDone ?? {}
      void _old
      let next: Game = { ...g, remindersDone: done ? rest : { ...rest, [action.key]: true } }
      // A once-per-battle reminder and the datasheet's "used" checkbox are the same fact.
      if (action.once === 'battle' && action.unitId && action.abilityId) {
        const { unitId, abilityId } = action
        next = updateUnit(next, unitId, (u) => ({
          ...u,
          usedOnce: done ? u.usedOnce.filter((id) => id !== abilityId) : [...new Set([...u.usedOnce, abilityId])],
        }))
      }
      const who = action.unitId ? `${unitName(g, action.unitId)}: ` : ''
      return withLog(
        next,
        `${who}${action.label} ${done ? 'unticked' : action.once === 'battle' ? 'used (once per battle)' : 'done'}`,
      )
    }
    case 'arrive': {
      const unit = game.units.find((u) => u.id === action.unitId)
      if (!unit || !unit.statuses.some((s) => RESERVE_STATUSES.includes(s))) return game
      const g = remember(game)
      const from = unit.statuses.includes('deepStrike') ? 'Deep Strike' : 'Strategic Reserves'
      const next = updateUnit(g, action.unitId, (u) => ({
        ...u,
        statuses: u.statuses.filter((s) => !RESERVE_STATUSES.includes(s)),
      }))
      return withLog(next, `${unit.name} arrives from ${from}`)
    }
    case 'embark': {
      if (action.unitId === action.transportId) return game
      const g = remember(game)
      const next = updateUnit(g, action.unitId, (u) => setEmbarked(u, action.transportId))
      return withLog(next, `${unitName(g, action.unitId)} embarks in ${unitName(g, action.transportId)}`)
    }
    case 'disembark': {
      if (!game.units.find((u) => u.id === action.unitId)?.embarkedIn) return game
      const g = remember(game)
      const next = updateUnit(g, action.unitId, (u) => setEmbarked(u, undefined))
      return withLog(next, `${unitName(g, action.unitId)} disembarks`)
    }
    case 'nextPhase':
      return advance(remember(game))
    case 'prevPhase':
      if (game.phase === 'command' && game.round === 1 && game.turn === game.firstTurn) return game
      return retreat(remember(game))
    case 'adjustCp': {
      const g = remember(game)
      const score = { ...g[action.side], cp: Math.max(0, g[action.side].cp + action.delta) }
      return withLog(
        { ...g, [action.side]: score },
        `${action.side === 'me' ? 'Your' : "Opponent's"} CP ${action.delta > 0 ? '+' : ''}${action.delta} → ${score.cp}`,
      )
    }
    case 'adjustVp': {
      const g = remember(game)
      const field = action.kind === 'primary' ? 'vpPrimary' : 'vpSecondary'
      const score = { ...g[action.side], [field]: Math.max(0, g[action.side][field] + action.delta) }
      return withLog(
        { ...g, [action.side]: score },
        `${action.side === 'me' ? 'Your' : "Opponent's"} ${action.kind} VP ${action.delta > 0 ? '+' : ''}${action.delta} → ${totalVp(score)}`,
      )
    }
    case 'removeModel': {
      const g = remember(game)
      const next = updateGroup(g, action.unitId, action.groupId, (m) =>
        m.alive <= 0 ? m : { ...m, alive: m.alive - 1, currentWounds: m.wounds },
      )
      const group = next.units.find((u) => u.id === action.unitId)?.models.find((m) => m.id === action.groupId)
      const unit = next.units.find((u) => u.id === action.unitId)
      return withLog(
        next,
        `${unitName(g, action.unitId)}: ${group?.name ?? 'model'} destroyed${unit?.destroyed ? ' — unit destroyed' : ''}`,
      )
    }
    case 'addModel': {
      const g = remember(game)
      const next = updateGroup(g, action.unitId, action.groupId, (m) =>
        m.alive >= m.total ? m : { ...m, alive: m.alive + 1 },
      )
      return withLog(next, `${unitName(g, action.unitId)}: model returned`)
    }
    case 'damage': {
      const g = remember(game)
      const next = updateGroup(g, action.unitId, action.groupId, (m) => {
        if (m.alive <= 0) return m
        const left = m.currentWounds - action.amount
        // Excess damage does not carry over to the next model (Core Rules).
        return left > 0
          ? { ...m, currentWounds: left }
          : { ...m, alive: m.alive - 1, currentWounds: m.wounds }
      })
      const unit = next.units.find((u) => u.id === action.unitId)
      const group = unit?.models.find((m) => m.id === action.groupId)
      const before = g.units.find((u) => u.id === action.unitId)?.models.find((m) => m.id === action.groupId)
      const killed = before && group && group.alive < before.alive
      return withLog(
        next,
        `${unitName(g, action.unitId)}: ${action.amount} damage to ${group?.name ?? 'model'}${
          killed ? ' — model destroyed' : ` (${group?.currentWounds ?? '?'} W left)`
        }${unit?.destroyed ? ' — unit destroyed' : ''}`,
      )
    }
    case 'healModel': {
      const g = remember(game)
      const next = updateGroup(g, action.unitId, action.groupId, (m) =>
        m.alive <= 0 ? m : { ...m, currentWounds: Math.min(m.wounds, m.currentWounds + action.amount) },
      )
      return withLog(next, `${unitName(g, action.unitId)}: ${action.amount} wound${action.amount === 1 ? '' : 's'} restored`)
    }
    case 'destroy': {
      const g = remember(game)
      const next = updateUnit(g, action.unitId, (u) => ({
        ...u,
        destroyed: true,
        models: u.models.map((m) => ({ ...m, alive: 0, currentWounds: m.wounds })),
      }))
      return withLog(next, `${unitName(g, action.unitId)} destroyed`)
    }
    case 'revive': {
      const g = remember(game)
      const next = updateUnit(g, action.unitId, (u) => ({
        ...u,
        destroyed: false,
        models: u.models.map((m) => ({ ...m, alive: m.total, currentWounds: m.wounds })),
      }))
      return withLog(next, `${unitName(g, action.unitId)} restored to full strength`)
    }
    case 'toggleStatus': {
      const g = remember(game)
      const has = g.units.find((u) => u.id === action.unitId)?.statuses.includes(action.status)
      const next = updateUnit(g, action.unitId, (u) => ({
        ...u,
        statuses: has ? u.statuses.filter((s) => s !== action.status) : [...u.statuses, action.status],
      }))
      return withLog(
        next,
        `${unitName(g, action.unitId)}: ${has ? 'no longer' : 'now'} ${STATUS_LABELS[action.status]}`,
      )
    }
    case 'toggleMark': {
      const g = remember(game)
      const has = g.units.find((u) => u.id === action.unitId)?.marks?.includes(action.mark)
      const next = updateUnit(g, action.unitId, (u) => ({
        ...u,
        marks: has ? (u.marks ?? []).filter((m) => m !== action.mark) : [...new Set([...(u.marks ?? []), action.mark])],
      }))
      return withLog(next, `${unitName(g, action.unitId)}: ${has ? 'no longer' : 'now'} ${action.label}`)
    }
    case 'applyMark': {
      const g = remember(game)
      // Applying to nobody is a mis-tap, not a state change worth an undo step.
      if (action.unitIds.length === 0) return game
      const next: Game = {
        ...g,
        units: g.units.map((u) =>
          action.unitIds.includes(u.id)
            ? { ...u, marks: [...new Set([...(u.marks ?? []), action.mark])] }
            : u,
        ),
      }
      const who =
        action.unitIds.length === g.units.filter((u) => !u.destroyed).length
          ? 'every unit'
          : action.unitIds.map((id) => unitName(g, id)).join(', ')
      return withLog(next, `${action.source}: ${who} now ${action.label}`)
    }
    case 'clearMarks': {
      const g = remember(game)
      if (!g.units.some((u) => (u.marks ?? []).length > 0)) return game
      const next: Game = { ...g, units: g.units.map((u) => ({ ...u, marks: [] })) }
      return withLog(next, 'Cleared every faction state')
    }
    case 'useStratagem': {
      const g = remember(game)
      const used = Boolean(g.stratagemsUsed?.[action.key])
      const { [action.key]: _old, ...rest } = g.stratagemsUsed ?? {}
      void _old
      // Using a Stratagem spends its CP; tapping again takes both back.
      const cp = Math.max(0, g.me.cp + (used ? action.cp : -action.cp))
      const next: Game = {
        ...g,
        me: { ...g.me, cp },
        stratagemsUsed: used ? rest : { ...rest, [action.key]: true },
      }
      return withLog(
        next,
        used ? `${action.name} taken back (+${action.cp} CP)` : `Stratagem: ${action.name} (−${action.cp} CP)`,
      )
    }
    case 'toggleOnce': {
      const g = remember(game)
      const used = g.units.find((u) => u.id === action.unitId)?.usedOnce.includes(action.abilityId)
      const next = updateUnit(g, action.unitId, (u) => ({
        ...u,
        usedOnce: used
          ? u.usedOnce.filter((id) => id !== action.abilityId)
          : [...u.usedOnce, action.abilityId],
      }))
      return withLog(next, `${unitName(g, action.unitId)}: ${action.label} ${used ? 'available again' : 'used'}`)
    }
    case 'setNote':
      return updateUnit(game, action.unitId, (u) =>
        action.note ? { ...u, note: action.note } : (({ note: _n, ...rest }) => (void _n, rest))(u),
      )
    case 'undo': {
      const previous = game.undo[game.undo.length - 1]
      if (!previous) return game
      // Optional state keys must not survive from the current game when the snapshot lacks them.
      const { result: _result, remindersDone: _ticks, ...rest } = game
      void _result
      void _ticks
      // Notes are not undo steps, so undo leaves the notes as they are now.
      const notes = new Map(game.units.map((u) => [u.id, u.note]))
      const units = previous.units.map((u) => {
        const { note: _stale, ...unit } = u
        void _stale
        const note = notes.get(u.id)
        return note ? { ...unit, note } : unit
      })
      const mission =
        previous.mission && game.mission
          ? { ...previous.mission, cardNotes: game.mission.cardNotes ?? {} }
          : previous.mission
      return withLog(
        {
          ...rest,
          ...previous,
          units,
          ...(mission ? { mission } : {}),
          status: 'active',
          undo: game.undo.slice(0, -1),
        },
        'Undo',
      )
    }
    case 'endGame': {
      const g = remember(game)
      const me = totalVp(g.me)
      const opponent = totalVp(g.opponent)
      const vpByRound = { ...g.vpByRound, [g.round]: { me, opponent } }
      return withLog(
        {
          ...g,
          status: 'finished',
          vpByRound,
          result: {
            winner: me === opponent ? 'draw' : me > opponent ? 'me' : 'opponent',
            me,
            opponent,
            endedAt: Date.now(),
          },
        },
        `Game over: ${me} – ${opponent}`,
      )
    }
  }
}

/** Whether the game has reached the end of the last battle round. */
export const isBattleOver = (game: Game): boolean =>
  game.round > LAST_ROUND ||
  (game.round === LAST_ROUND && game.turn !== game.firstTurn && game.phase === 'fight')

export const phaseLabel = (phase: Phase): string => PHASE_LABELS[phase]
