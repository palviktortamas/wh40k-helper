/**
 * Every change to a game goes through `apply`, which records the previous
 * state for undo and writes a log line. Pure: screens call it and persist the
 * result, tests call it directly.
 */

import {
  LAST_ROUND,
  PHASES,
  PHASE_LABELS,
  STATUS_LABELS,
  TURN_STATUSES,
  UNDO_DEPTH,
  totalVp,
  type Game,
  type GameState,
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
  | { type: 'toggleOnce'; unitId: string; abilityId: string; label: string }
  | { type: 'setNote'; unitId: string; note: string }
  | { type: 'embark'; unitId: string; transportId: string }
  | { type: 'disembark'; unitId: string }
  | { type: 'undo' }
  | { type: 'endGame' }

const snapshot = (game: Game): GameState => ({
  round: game.round,
  phase: game.phase,
  turn: game.turn,
  me: { ...game.me },
  opponent: { ...game.opponent },
  units: game.units.map((u) => ({
    ...u,
    models: u.models.map((m) => ({ ...m, weapons: m.weapons.map((w) => ({ ...w })) })),
    statuses: [...u.statuses],
    usedOnce: [...u.usedOnce],
  })),
  vpByRound: { ...game.vpByRound },
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
  const secondPlayer = other(game.firstTurn)
  if (game.turn === secondPlayer) {
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
  // Each player gains 1 CP at the start of their Command phase (Core Rules).
  const key = next.turn
  next = { ...next, [key]: { ...next[key], cp: next[key].cp + 1 } }
  return withLog(next, `${key === 'me' ? 'You gain' : 'Opponent gains'} 1 CP`)
}

function retreat(game: Game): Game {
  const index = PHASES.indexOf(game.phase)
  if (index > 0) {
    const phase = PHASES[index - 1]!
    return withLog({ ...game, phase }, `Back to ${PHASE_LABELS[phase]} phase`)
  }
  if (game.round === 1 && game.turn === game.firstTurn) return game
  // Back into the previous turn's Fight phase; the CP that turn granted is taken back.
  const key = game.turn
  let next: Game = { ...game, [key]: { ...game[key], cp: Math.max(0, game[key].cp - 1) } }
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

function applyAction(game: Game, action: GameAction): Game {
  switch (action.type) {
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
      const { result: _result, ...rest } = game
      void _result
      return withLog(
        { ...rest, ...previous, status: 'active', undo: game.undo.slice(0, -1) },
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
