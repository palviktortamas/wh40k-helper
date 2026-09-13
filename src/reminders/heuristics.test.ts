import { describe, expect, it } from 'vitest'
import { infer, plainText, shortText } from './heuristics'

// Invented rule text in the game's generic phase vocabulary — no real cards.

describe('reminder heuristics', () => {
  it('reads the phase from the text and keeps the first sentence', () => {
    const r = infer('Battle Cry', 'In your Command phase, this unit can shout. If it does, add 1 to its Leadership until your next turn.')
    expect(r.trigger).toBe('command_phase')
    expect(r.text).toBe('In your Command phase, this unit can shout.')
    expect(r.enabled).toBe(true)
    expect(r.once).toBeUndefined()
  })

  it('prefers the specific moment over the phase it happens in', () => {
    expect(infer('Counter', 'Each time an enemy unit declares a charge against this unit, it can shoot in the Charge phase.').trigger).toBe('when_charged')
    expect(infer('Shield', 'Each time this unit is selected as the target of a ranged attack, roll a D6.').trigger).toBe('when_targeted')
    expect(infer('Drop', 'When this unit arrives from Strategic Reserves, it can make a Normal move.').trigger).toBe('on_arrival_from_reserves')
    expect(infer('Spite', "In your opponent's Shooting phase, this unit can move 3\".").trigger).toBe('opponent_turn')
    expect(infer('Tally', 'At the end of your turn, count models within range.').trigger).toBe('end_of_turn')
  })

  it('marks once-per-battle and once-per-turn, and uses them as the trigger when there is no phase', () => {
    const once = infer('Big Shout (Once per battle)', 'Roll a D6.')
    expect(once.once).toBe('battle')
    expect(once.trigger).toBe('once_per_battle')
    expect(once.enabled).toBe(true)
    const phased = infer('Rally', 'Once per battle, in your Command phase, this unit regains a model.')
    expect(phased.once).toBe('battle')
    expect(phased.trigger).toBe('command_phase')
    expect(infer('Trick', 'Once per turn, re-roll one dice.').trigger).toBe('once_per_turn')
  })

  it('leaves passive rules off by default', () => {
    const r = infer('Thick Hide', 'This model has a 5+ invulnerable save.')
    expect(r.trigger).toBe('custom')
    expect(r.enabled).toBe(false)
  })

  it('strips HTML and cuts long text', () => {
    expect(plainText('<b>Hit</b> &amp; run<br/>fast')).toBe('Hit & run fast')
    const long = shortText(`${'word '.repeat(60)}end.`)
    expect(long.length).toBeLessThanOrEqual(140)
    expect(long.endsWith('…')).toBe(true)
  })
})
