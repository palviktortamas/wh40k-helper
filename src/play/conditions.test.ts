import { describe, expect, it } from 'vitest'
import { conditionMet } from './conditions'

// Invented rule wording in the core rules' own grammar — no game data here.

describe('conditionMet', () => {
  it('is met when the clause names a state the unit is in', () => {
    expect(conditionMet('while this unit is worked up', ['worked up'])).toBe(true)
    expect(conditionMet('if this unit made a charge move this turn', ['made a charge move'])).toBe(true)
  })

  it('is not met by a state the unit is not in', () => {
    expect(conditionMet('while this unit is worked up', [])).toBe(false)
    expect(conditionMet('while this unit is worked up', ['advanced'])).toBe(false)
  })

  it('an unconditional rule is always in force', () => {
    expect(conditionMet(undefined, [])).toBe(true)
  })

  it('is not met when the clause negates the state', () => {
    // Half a codex reads "if this unit is not battle-shocked"; a plain
    // substring test turned every one of those live at exactly the wrong
    // moment.
    expect(conditionMet('if this unit is not battle-shocked', ['is battle-shocked'])).toBe(false)
    expect(conditionMet('while this unit is no longer worked up', ['worked up'])).toBe(false)
  })

  it('still reads a later, unnegated mention', () => {
    expect(
      conditionMet('if this unit is not embarked and is worked up', ['worked up']),
    ).toBe(true)
  })
})
