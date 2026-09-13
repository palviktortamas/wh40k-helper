import { describe, expect, it } from 'vitest'
import { ruleAppliesTo, ruleScope } from './detachmentRules'

// Invented rules text in the data's own markup; no real game content.
describe('detachment rule scope', () => {
  it('reads friendly bold keywords, with alternatives and multi-word keywords', () => {
    const scope = ruleScope("Friendly **RED INFANTRY** units' melee attacks have **[SUSTAINED HITS 1]**.")
    expect(scope.include).toEqual([[['RED', 'INFANTRY']]])
    expect(ruleAppliesTo('Friendly **RED INFANTRY** units …', ['Infantry', 'Red', 'Grots'])).toBe(true)
    expect(ruleAppliesTo('Friendly **RED INFANTRY** units …', ['Vehicle', 'Red'])).toBe(false)
  })

  it('treats a slash as alternatives and ignores stat letters and weapon abilities', () => {
    const text = 'Friendly **BIKERS/WALKERS** units have +1 **AP** and **[ASSAULT]**.'
    expect(ruleAppliesTo(text, ['Walkers'])).toBe(true)
    expect(ruleAppliesTo(text, ['Infantry'])).toBe(false)
  })

  it('does not take the enemy target as the friendly unit', () => {
    const text = "Friendly **HUNTER** units' attacks that target a **MONSTER/VEHICLE** unit have +1 **AP**."
    expect(ruleAppliesTo(text, ['Vehicle'])).toBe(false)
    expect(ruleAppliesTo(text, ['Hunter', 'Infantry'])).toBe(true)
  })

  it('honours exclusions', () => {
    const text = 'When a friendly **WALKER** unit (excluding **TITANIC** units) is selected to attack …'
    expect(ruleAppliesTo(text, ['Walker', 'Vehicle'])).toBe(true)
    expect(ruleAppliesTo(text, ['Walker', 'Titanic'])).toBe(false)
  })

  it('falls back to "**X** units" and reports army-wide rules as undefined', () => {
    expect(ruleAppliesTo('**GRUNT** units gain **BATTLELINE**.', ['Grunt'])).toBe(true)
    expect(ruleAppliesTo('Once per battle, at the start of your Command phase, you may …', ['Grunt'])).toBeUndefined()
  })
})
