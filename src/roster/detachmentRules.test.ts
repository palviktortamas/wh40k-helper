import { describe, expect, it } from 'vitest'
import { ruleAppliesTo, ruleScope, ruleTextFor } from './detachmentRules'

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

  it('reads keywords written in plain capitals, with alternatives and multi-word keywords', () => {
    const text = '- Friendly RED INFANTRY/GREEN WALKERS units’ ranged attacks have [ASSAULT].\n- When a friendly BLUE BIKERS unit moves, it may act.'
    expect(ruleAppliesTo(text, ['Red', 'Infantry'])).toBe(true)
    expect(ruleAppliesTo(text, ['Green', 'Walkers'])).toBe(true)
    expect(ruleAppliesTo(text, ['Blue', 'Bikers'])).toBe(true)
    expect(ruleAppliesTo(text, ['Red', 'Walkers'])).toBe(false)
  })

  it('reads the ^^**Keyword^^** spellings in any case, lists and exclusions', () => {
    const text = 'Add 2 to weapons of friendly ^^**Pale Ones^^** models (excluding ^^**Hulks, Swarm^^** and ^^**Titanic**^^ models).'
    expect(ruleAppliesTo(text, ['Pale', 'Ones'])).toBe(true)
    expect(ruleAppliesTo(text, ['Pale', 'Ones', 'Swarm'])).toBe(false)
    expect(ruleAppliesTo(text, ['Pale', 'Ones', 'Titanic'])).toBe(false)
    expect(ruleAppliesTo('^^**Tall Ones**^^ units have Deep Strike.', ['Tall', 'Ones'])).toBe(true)
  })

  it('joins "or" and "and" lists of plain capitals', () => {
    const text = 'Each time a NOBLE, GUARD or ENVOY unit from your army attacks, add 1.'
    expect(ruleAppliesTo(text, ['Guard'])).toBe(true)
    expect(ruleAppliesTo(text, ['Envoy'])).toBe(true)
    expect(ruleAppliesTo(text, ['Peasant'])).toBe(false)
  })

  it('does not scope a rule to the leader it speaks of', () => {
    expect(ruleAppliesTo('While a RED CHARACTER model is leading this unit, add 1 to Hit rolls.', ['Grots'])).toBeUndefined()
  })

  it('scopes each clause to the units it names', () => {
    const text =
      "- Friendly **GRUNT** units' melee attacks have **[SUSTAINED HITS 1]**.\n" +
      "- If a friendly **RED INFANTRY** unit charged, that unit's melee attacks have **[LETHAL HITS]**."
    expect(ruleTextFor(text, ['Grunt'])).toContain('SUSTAINED')
    expect(ruleTextFor(text, ['Grunt'])).not.toContain('LETHAL')
    expect(ruleTextFor(text, ['Red', 'Infantry'])).toContain('LETHAL')
    expect(ruleTextFor(text, ['Red', 'Infantry'])).not.toContain('SUSTAINED')
    expect(ruleTextFor(text, ['Walker'])).toBeUndefined()
    expect(ruleTextFor('Once per battle, you may do a thing.', ['Walker'])).toBe('Once per battle, you may do a thing.')
  })

  it('scopes sentences as well as bullets, and a bullet that names nobody follows the clause before', () => {
    const text =
      "Friendly **GRUNT** units' attacks have +1 to hit. Friendly **RED** units' attacks have +1 to wound.\n- While riled up, +3\" **R**."
    const grunt = ruleTextFor(text, ['Grunt']) ?? ''
    expect(grunt).toContain('to hit')
    expect(grunt).not.toContain('to wound')
    const red = ruleTextFor(text, ['Red']) ?? ''
    expect(red).toContain('to wound')
    expect(red).toContain('riled up')
    expect(red).not.toContain('to hit')
  })

  it('merges a keyword bolded one word at a time, and ignores "you can only select" sentences', () => {
    const text = 'That **RED** **INFANTRY**/**WALKER** **MOUNTED** unit.'
    expect(ruleAppliesTo(text, ['Red', 'Infantry'])).toBe(true)
    expect(ruleAppliesTo(text, ['Walker', 'Mounted'])).toBe(true)
    expect(ruleAppliesTo(text, ['Mounted'])).toBe(false)
    const heroic = 'One friendly unit within 12". You can only select a **VEHICLE** unit if it is a **CHARACTER**/**WALKER** unit.'
    expect(ruleAppliesTo(heroic, ['Infantry'])).toBeUndefined()
  })
})
