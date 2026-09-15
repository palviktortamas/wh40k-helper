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
      situationsIn(['If this unit made a charge move this turn, add 1 to its Attacks.']).map(
        (s) => s.status,
      ),
    ).toEqual(['charged'])
    expect(
      situationsIn(['When this unit is selected to make an advance/fall-back move, …']).map(
        (s) => s.status,
      ),
    ).toEqual(['advanced', 'fellBack'])
  })

  it('offers nothing for a unit whose rules never mention one', () => {
    expect(situationsIn(['This unit has 4+ Sv.'])).toEqual([])
  })

  it('does not offer the same situation twice', () => {
    expect(
      situationsIn([
        'If this unit made a charge move this turn, +1 A.',
        'While this unit made a charge move, its attacks have [LANCE].',
      ]),
    ).toHaveLength(1)
  })

  it('reads the situation of arriving, which a rule may call several things', () => {
    expect(situationsIn(['…after this unit arrives from strategic reserves…'])[0]?.status).toBe(
      'arrived',
    )
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
