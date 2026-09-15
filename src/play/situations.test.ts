/**
 * Situations: the things that happened to a unit this turn which its rules
 * react to — it charged, it advanced, it fell back, it arrived.
 *
 * The app already tracked most of these as statuses and did nothing with them:
 * a rule that says "if this unit made a charge move this turn, +1 A" showed its
 * `*` and stayed grey whatever the player ticked. Toggling the situation is
 * what makes those numbers real.
 *
 * Invented rule text — the repo holds no game data.
 */

import { describe, expect, it } from 'vitest'
import { activePhrases, situationsIn } from './situations'

describe('which situations a unit’s rules react to', () => {
  it('finds the situation a rule names, whatever wording it uses', () => {
    expect(
      situationsIn(['If this unit made a charge move this turn, add 1 to its Attacks.'])
        .filter((s) => !s.always)
        .map((s) => s.status),
    ).toEqual(['charged'])
    expect(
      situationsIn(['When this unit is selected to make an advance/fall-back move, …'])
        .filter((s) => !s.always)
        .map((s) => s.status),
    ).toEqual(['advanced', 'fellBack'])
  })

  it('offers only the core states for a unit whose rules mention none', () => {
    // Battle-shock changes a unit's OC, its Leadership and what it may spend
    // CP on wherever it happens, so its toggle is always at hand; nothing else
    // is offered unless a rule asks for it.
    expect(situationsIn(['This unit has 4+ Sv.']).map((s) => s.status)).toEqual(['battleShocked'])
  })

  it('does not offer the same situation twice', () => {
    expect(
      situationsIn([
        'If this unit made a charge move this turn, +1 A.',
        'While this unit made a charge move, its attacks have [LANCE].',
      ]).filter((s) => !s.always),
    ).toHaveLength(1)
  })

  it('reads the situation of arriving, which a rule may call several things', () => {
    expect(
      situationsIn(['…after this unit arrives from strategic reserves…'])
        .filter((s) => !s.always)
        .map((s) => s.status),
    ).toEqual(['arrived'])
  })
})

describe('what a switched-on situation means to a condition', () => {
  it('turns the phrases its rules use into active states', () => {
    expect(activePhrases(['charged'])).toContain('made a charge move')
  })

  it('says nothing for a situation that is switched off', () => {
    expect(activePhrases([])).toEqual([])
  })
})
