/**
 * How long a state a rule grants lasts, read from the rule's own words.
 *
 * States used to be cleared by hand, because reading a duration out of prose
 * looked like guesswork. It is not: the rules write durations in a small closed
 * vocabulary — "until the end of the phase", "until the end of the (next) turn",
 * "until the start of your next turn", "until the start of your next <phase>
 * phase", "until the start of the next battle round" — and every one of those
 * names a moment the game tracker already knows. Anything outside that
 * vocabulary ("until that move is finished", "until the end of the battle")
 * keeps no expiry and stays until it is taken off by hand.
 *
 * Nothing here knows a faction: the wording is the core rules' grammar, and the
 * phrase itself comes from the installed data.
 */

import { PHASES, type Phase, type Side } from './types'

export type Moment = { round: number; turn: Side; phase: Phase }

/**
 * A moment as one comparable number. Turn order is the game's own: the player
 * with the first turn of the battle round goes first in every round.
 */
export function momentIndex(moment: Moment, firstTurn: Side): number {
  const half = moment.turn === firstTurn ? 0 : 1
  const phase = Math.max(0, PHASES.indexOf(moment.phase))
  return ((moment.round - 1) * 2 + half) * PHASES.length + phase
}

/** The last moment of the turn `moment` is in. */
const endOfTurn = (moment: Moment): Moment => ({ ...moment, phase: PHASES[PHASES.length - 1]! })

/** The turn after this one, which is the other player's. */
const nextTurn = (moment: Moment, firstTurn: Side): Moment =>
  moment.turn === firstTurn
    ? { ...moment, turn: other(firstTurn) }
    : { round: moment.round + 1, turn: firstTurn, phase: moment.phase }

const other = (side: Side): Side => (side === 'me' ? 'opponent' : 'me')

/**
 * The next moment at or after `after` where `side` is in `phase` — "your next
 * Command phase". A phase still to come in the current turn counts: the rules
 * say "next" of the phase, not of the turn.
 */
function nextPhaseOf(after: Moment, firstTurn: Side, side: Side, phase: Phase): Moment {
  const from = momentIndex(after, firstTurn)
  for (let round = after.round; round <= after.round + 2; round++) {
    for (const turn of [firstTurn, other(firstTurn)] as const) {
      if (turn !== side) continue
      const candidate: Moment = { round, turn, phase }
      if (momentIndex(candidate, firstTurn) > from) return candidate
    }
  }
  return { round: after.round + 2, turn: side, phase }
}

const PHASE_WORDS: Record<string, Phase> = {
  command: 'command',
  movement: 'movement',
  shooting: 'shooting',
  charge: 'charge',
  fight: 'fight',
}

/**
 * The last moment at which a state granted now still holds, as a comparable
 * index — or `undefined` when the wording names no moment the tracker knows.
 *
 * `side` is whose "your" the rule means: the player applying it.
 */
export function expiryFor(
  until: string | undefined,
  now: Moment,
  firstTurn: Side,
  side: Side = 'me',
): number | undefined {
  if (!until) return undefined
  const text = until.toLowerCase()
  const index = (moment: Moment) => momentIndex(moment, firstTurn)
  // A state that lasts the battle is one the player takes off when the battle ends.
  if (/\bend of the battle\b/.test(text)) return undefined

  if (/\bend of (?:the|that|this) phase\b/.test(text)) return index(now)

  if (/\bend of your next turn\b/.test(text)) {
    return index(endOfTurn(nextPhaseOf(now, firstTurn, side, 'command')))
  }
  if (/\bend of (?:the |this )?next turn\b/.test(text)) {
    return index(endOfTurn(nextTurn(now, firstTurn)))
  }
  if (/\bend of (?:the|this|that) turn\b/.test(text)) return index(endOfTurn(now))

  if (/\bstart of the next battle round\b/.test(text)) {
    return index(endOfTurn({ ...now, turn: other(firstTurn) }))
  }

  const startOf = /\bstart of (your|the|your opponent's|my)?\s*(?:next\s+)?(command|movement|shooting|charge|fight)\s+phase\b/.exec(
    text,
  )
  if (startOf) {
    const whose = startOf[1] === "your opponent's" ? other(side) : side
    const phase = PHASE_WORDS[startOf[2]!]!
    return index(nextPhaseOf(now, firstTurn, whose, phase)) - 1
  }

  if (/\bstart of (your|the) next turn\b/.test(text)) {
    const whose = /\bstart of the next turn\b/.test(text) ? undefined : side
    const moment = whose
      ? nextPhaseOf(now, firstTurn, whose, 'command')
      : nextTurn(now, firstTurn)
    return index({ ...moment, phase: 'command' }) - 1
  }

  return undefined
}

/**
 * The durations to offer when the rule granting a state names none — and
 * plenty do not: a faction rule reads "become **riled up**, as stated in other
 * rules", and the rule that states it may belong to a datasheet the army never
 * took. Guessing there would be wrong as often as right, so the player says
 * once and the tracker takes the state off by itself. The wordings are the
 * rules' own, so they go through `expiryFor` like any other.
 */
export const DURATIONS: { label: string; value: string }[] = [
  { label: 'until I take it off', value: '' },
  { label: 'until the end of this phase', value: 'until the end of the phase' },
  { label: 'until the end of this turn', value: 'until the end of the turn' },
  { label: 'until the start of my next turn', value: 'until the start of your next turn' },
  { label: 'until the end of the next turn', value: 'until the end of the next turn' },
]

/** Whether a state whose expiry is `until` is over at `now`. */
export const hasLapsed = (until: number, now: Moment, firstTurn: Side): boolean =>
  momentIndex(now, firstTurn) > until

/** The moment an index stands for — the inverse of `momentIndex`. */
export function momentAt(index: number, firstTurn: Side): Moment {
  const phase = PHASES[index % PHASES.length]!
  const half = Math.floor(index / PHASES.length)
  return { round: Math.floor(half / 2) + 1, turn: half % 2 === 0 ? firstTurn : other(firstTurn), phase }
}

/**
 * The last moment a state holds, in words a player can check against the
 * tracker: "ends after round 2, opponent's Fight phase".
 */
export function describeExpiry(until: number, firstTurn: Side): string {
  const { round, turn, phase } = momentAt(until, firstTurn)
  const whose = turn === 'me' ? 'your' : "the opponent's"
  return `ends after round ${round}, ${whose} ${phase} phase`
}
