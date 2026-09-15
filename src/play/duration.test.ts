/**
 * How long a state a rule grants actually lasts.
 *
 * The rules write durations in a small, closed vocabulary ("until the end of
 * the phase", "until the start of your next turn"), so the wording can be read
 * rather than guessed at. Anything outside that vocabulary keeps no expiry and
 * is cleared by hand, as every state used to be.
 *
 * Invented wording only where it has to be — the phrases themselves are the
 * rules' own grammar, not game data.
 */

import { describe, expect, it } from 'vitest'
import { describeExpiry, expiryFor, hasLapsed, momentIndex, type Moment } from './duration'

const at = (round: number, turn: Moment['turn'], phase: Moment['phase']): Moment => ({
  round,
  turn,
  phase,
})

describe('momentIndex', () => {
  it('orders the phases of a turn', () => {
    expect(momentIndex(at(1, 'me', 'command'), 'me')).toBeLessThan(
      momentIndex(at(1, 'me', 'fight'), 'me'),
    )
  })

  it('puts the second player after the first, whoever that is', () => {
    expect(momentIndex(at(1, 'opponent', 'command'), 'me')).toBeGreaterThan(
      momentIndex(at(1, 'me', 'fight'), 'me'),
    )
    expect(momentIndex(at(1, 'me', 'command'), 'opponent')).toBeGreaterThan(
      momentIndex(at(1, 'opponent', 'fight'), 'opponent'),
    )
  })

  it('orders the battle rounds', () => {
    expect(momentIndex(at(2, 'me', 'command'), 'me')).toBeGreaterThan(
      momentIndex(at(1, 'opponent', 'fight'), 'me'),
    )
  })
})

describe('expiryFor', () => {
  const now = at(1, 'me', 'movement')

  it('reads nothing from a rule that says nothing', () => {
    expect(expiryFor(undefined, now, 'me')).toBeUndefined()
    expect(expiryFor('until that move is finished', now, 'me')).toBeUndefined()
    expect(expiryFor('until the end of the battle', now, 'me')).toBeUndefined()
  })

  it('ends with this phase', () => {
    const until = expiryFor('until the end of the phase', now, 'me')!
    expect(hasLapsed(until, now, 'me')).toBe(false)
    expect(hasLapsed(until, at(1, 'me', 'shooting'), 'me')).toBe(true)
  })

  it('ends with this turn', () => {
    const until = expiryFor('until the end of the turn', now, 'me')!
    expect(hasLapsed(until, at(1, 'me', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(1, 'opponent', 'command'), 'me')).toBe(true)
  })

  it('ends with the next turn, whoever takes it', () => {
    const until = expiryFor('until the end of the next turn', now, 'me')!
    expect(hasLapsed(until, at(1, 'opponent', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(2, 'me', 'command'), 'me')).toBe(true)
  })

  it('ends with your own next turn, skipping the one between', () => {
    const until = expiryFor('until the end of your next turn', now, 'me')!
    expect(hasLapsed(until, at(1, 'opponent', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(2, 'me', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(2, 'opponent', 'command'), 'me')).toBe(true)
  })

  it('ends as your own next turn starts', () => {
    const until = expiryFor('until the start of your next turn', now, 'me')!
    expect(hasLapsed(until, at(1, 'opponent', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(2, 'me', 'command'), 'me')).toBe(true)
  })

  it('ends as a named phase of your next turn starts', () => {
    const until = expiryFor('until the start of your next Command phase', now, 'me')!
    expect(hasLapsed(until, at(1, 'opponent', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(2, 'me', 'command'), 'me')).toBe(true)

    // Granted in the Shooting phase itself, "your next" is next turn's.
    const shooting = expiryFor('until the start of your next Shooting phase', at(1, 'me', 'shooting'), 'me')!
    expect(hasLapsed(shooting, at(2, 'me', 'movement'), 'me')).toBe(false)
    expect(hasLapsed(shooting, at(2, 'me', 'shooting'), 'me')).toBe(true)
  })

  it('reads a phase still to come in this very turn as this turn', () => {
    const until = expiryFor('until the start of your next Fight phase', now, 'me')!
    expect(hasLapsed(until, at(1, 'me', 'charge'), 'me')).toBe(false)
    expect(hasLapsed(until, at(1, 'me', 'fight'), 'me')).toBe(true)
  })

  it('ends with the battle round', () => {
    const until = expiryFor('until the start of the next battle round', now, 'me')!
    expect(hasLapsed(until, at(1, 'opponent', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(2, 'me', 'command'), 'me')).toBe(true)
  })

  it('is read from the opponent turn it was granted in, not from yours', () => {
    const until = expiryFor('until the start of your next turn', at(1, 'opponent', 'shooting'), 'me')!
    expect(hasLapsed(until, at(1, 'opponent', 'fight'), 'me')).toBe(false)
    expect(hasLapsed(until, at(2, 'me', 'command'), 'me')).toBe(true)
  })
})

describe('describeExpiry', () => {
  it('names the last moment the state holds, against the tracker', () => {
    const until = expiryFor('until the end of the next turn', at(1, 'me', 'command'), 'me')!
    expect(describeExpiry(until, 'me')).toBe("ends after round 1, the opponent's fight phase")
  })
})
