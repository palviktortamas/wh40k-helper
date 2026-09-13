/**
 * Play Mode (spec §6). A game is a frozen snapshot of a roster plus the live
 * table state: round, phase, whose turn, CP and VP, and every unit's models,
 * wounds and statuses. Editing the roster afterwards never touches a game.
 */

export type Phase = 'command' | 'movement' | 'shooting' | 'charge' | 'fight'

export const PHASES: readonly Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight']

export const PHASE_LABELS: Record<Phase, string> = {
  command: 'Command',
  movement: 'Movement',
  shooting: 'Shooting',
  charge: 'Charge',
  fight: 'Fight',
}

export type Side = 'me' | 'opponent'

export type UnitStatus =
  | 'battleShocked'
  | 'advanced'
  | 'fellBack'
  | 'reserves'
  | 'deepStrike'
  | 'embarked'

export const STATUS_LABELS: Record<UnitStatus, string> = {
  battleShocked: 'Battle-shocked',
  advanced: 'Advanced',
  fellBack: 'Fell back',
  reserves: 'Reserves',
  deepStrike: 'Deep Strike',
  embarked: 'Embarked',
}

/** Statuses that clear at the end of the turn they were gained in. */
export const TURN_STATUSES: readonly UnitStatus[] = ['advanced', 'fellBack']

/**
 * One model type inside a unit — "Boy", "Boy w/ Rokkit launcha", "Nob" — with
 * its own count and weapons, so removing a model can say *which* model died and
 * the weapons table stays right (spec §6.3).
 */
export type ModelGroup = {
  /** The roster selection this came from. */
  id: string
  name: string
  total: number
  alive: number
  /** Wounds characteristic of one model. */
  wounds: number
  /** Wounds left on the model currently taking damage. */
  currentWounds: number
  /** Weapons every model in this group carries, by name. */
  weapons: { name: string; perModel: number }[]
}

export type GameUnit = {
  /** The roster selection id, stable for the life of the game. */
  id: string
  name: string
  entryId: string
  points: number
  isCharacter: boolean
  isWarlord: boolean
  /** For a Leader: the unit id it is attached to. */
  leaderOf?: string
  /** The transport this unit is currently embarked in, by unit id. */
  embarkedIn?: string
  /** Datasheet transport capacity text, shown as a reminder when embarking (not enforced). */
  transportCapacity?: string
  models: ModelGroup[]
  /** The unit's damaged profile applies at or below this many wounds, when it has one. */
  damagedAt?: number
  statuses: UnitStatus[]
  destroyed: boolean
  /** Ids of once-per-battle abilities already used. */
  usedOnce: string[]
  note?: string
  /** Enhancements taken on this unit (catalogue entry id + name), for the reminders. */
  enhancements?: { id: string; name: string }[]
}

export type PlayerScore = {
  cp: number
  /** Primary and secondary mission VP kept apart, as the scoresheet does. */
  vpPrimary: number
  vpSecondary: number
}

export type SecondaryMode = 'fixed' | 'tactical'

/**
 * Mission setup and the live state of the secondary deck (spec §6.1–6.2).
 * Card ids refer to the imported mission deck; the deck itself is not copied
 * into the game.
 */
export type MissionState = {
  myDisposition?: string
  opponentDisposition?: string
  myPrimaryId?: string
  opponentPrimaryId?: string
  deploymentId?: string
  twistId?: string
  /** D6 roll: 1–5 one central objective, 6 two. */
  centralObjectives?: 1 | 2
  attacker?: Side
  secondaryMode?: SecondaryMode
  /** Fixed mode: the two chosen cards. */
  fixedIds: string[]
  /** Tactical mode: the shuffled draw pile, the active cards, the discard pile. */
  deck: string[]
  active: string[]
  discarded: string[]
  /** Once per battle: 1 CP to discard one active card and draw a replacement. */
  discardRedrawUsed: boolean
  /** Once per own turn: discarding active cards yields 1 CP. */
  cpForDiscardThisTurn: boolean
  /** Secondary VP scored this battle round (the deck caps it at 15). */
  secondaryThisRound: number
  /** Primary scoring lines ticked, keyed `${round}:${block}:${line}`, and how often. */
  primaryScored: Record<string, number>
  /**
   * Card-state trackers (spec §6.2): what a card needs the player to remember —
   * operation markers placed, objectives consecrated, condemned units, the
   * beacon unit — as one counter and one free-text note per card id. Absent on
   * games from before the trackers existed.
   */
  cardCounters?: Record<string, number>
  cardNotes?: Record<string, string>
}

export const SECONDARY_ROUND_CAP = 15
export const TACTICAL_DRAW = 2

export const emptyMission = (): MissionState => ({
  fixedIds: [],
  deck: [],
  active: [],
  discarded: [],
  discardRedrawUsed: false,
  cpForDiscardThisTurn: false,
  secondaryThisRound: 0,
  primaryScored: {},
  cardCounters: {},
  cardNotes: {},
})

/** Statuses that mean the unit is not on the battlefield yet. */
export const RESERVE_STATUSES: readonly UnitStatus[] = ['reserves', 'deepStrike']

export const inReserves = (unit: GameUnit): boolean =>
  unit.statuses.some((s) => RESERVE_STATUSES.includes(s))

/**
 * Which model dies when the player does not say (spec §6.3: plain models
 * first, then specials, the unit's own character last). Model groups have no
 * role flag, so the order is by size: the largest living group is the plain
 * infantry, a group of one is the sergeant. Ties keep the roster order.
 */
export function defaultCasualtyGroup(unit: GameUnit): ModelGroup | undefined {
  const living = unit.models.filter((g) => g.alive > 0)
  if (living.length === 0) return undefined
  return living.reduce((best, g) => (g.total > best.total ? g : best))
}

/** Everything undo has to restore. */
export type GameState = {
  round: number
  phase: Phase
  turn: Side
  me: PlayerScore
  opponent: PlayerScore
  units: GameUnit[]
  /** Total VP at the end of each battle round, for the summary. */
  vpByRound: Record<number, { me: number; opponent: number }>
  /** Absent on games started before the mission deck existed. */
  mission?: MissionState
  /**
   * Reminders ticked off (spec §6.4), keyed by the reminder's done-key
   * (`round:turn:owner:id`, or `battle:owner:id` for once-per-battle ones).
   */
  remindersDone?: Record<string, true>
}

export type LogEntry = {
  at: number
  round: number
  phase: Phase
  turn: Side
  text: string
}

export type GameResult = {
  winner: Side | 'draw'
  me: number
  opponent: number
  endedAt: number
}

export type Game = GameState & {
  id: string
  rosterId: string
  rosterName: string
  catalogueId: string
  factionName: string
  detachmentName?: string
  pointsLimit: number
  opponentName: string
  opponentFaction: string
  /** Who takes the first turn of every battle round. */
  firstTurn: Side
  /** The roster was not legal when the game started; the player overrode it. */
  startedIllegal: boolean
  status: 'active' | 'finished'
  createdAt: number
  updatedAt: number
  log: LogEntry[]
  /** Previous states, newest last; capped at UNDO_DEPTH. */
  undo: GameState[]
  result?: GameResult
}

export const UNDO_DEPTH = 30
export const LAST_ROUND = 5

export const totalVp = (score: PlayerScore): number => score.vpPrimary + score.vpSecondary

export const modelsAlive = (unit: GameUnit): number =>
  unit.models.reduce((sum, g) => sum + g.alive, 0)

export const modelsTotal = (unit: GameUnit): number =>
  unit.models.reduce((sum, g) => sum + g.total, 0)

/** Wounds left on the unit's current model, summed when several groups are mid-damage. */
export const woundsRemaining = (unit: GameUnit): number =>
  unit.models.reduce((sum, g) => sum + (g.alive > 0 ? g.currentWounds + (g.alive - 1) * g.wounds : 0), 0)

export const woundsTotal = (unit: GameUnit): number =>
  unit.models.reduce((sum, g) => sum + g.total * g.wounds, 0)
