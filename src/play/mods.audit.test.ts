import { describe, expect, it } from 'vitest'
import { applyMod, modsFor, resolveMods, skillMods, statMods } from './mods'

// Audit 2026-11-03: conditions, scopes, weapon filters and arithmetic.
// Invented rules in the sources' own grammar — no game data here.

describe('a bullet keeps its condition', () => {
  it('reads "- While this unit is riled up, +3" R" as conditional, not always on', () => {
    const [mod] = statMods([
      {
        name: 'Barrage',
        text: "Friendly **SOME** units' ranged attacks have **[ASSAULT]**. ⏎ - While this unit is **riled up**, +3\" **R**.",
        source: 'Detachment',
      },
    ])
    expect(mod).toMatchObject({ stat: 'R', value: '+3"', when: 'While this unit is riled up' })
  })

  it('keeps the condition of a hit bonus written as a bullet', () => {
    const [mod] = statMods([
      {
        name: 'Sky Hands',
        text: "- Friendly **AIRCRAFT** do not count. - While a friendly **SOME** unit is **riled up**, this unit's ranged attacks have +1 to **hit rolls**.",
        source: 'Datasheet',
      },
    ])
    expect(mod?.when).toBe('While a friendly SOME unit is riled up')
  })

  it('does not give an enemy’s penalty to this unit', () => {
    // The enemy's attacks suffer it while the enemy is engaged with us; our own
    // Ballistic Skill does not.
    expect(
      statMods([
        {
          name: 'Cover Fire',
          text: 'While an enemy unit is **engaged** with only **SOME** units: - That enemy unit can be targeted. - When shooting that enemy unit, those ranged attacks have -1 to **hit rolls**.',
          source: 'Datasheet',
        },
      ]),
    ).toEqual([])
  })

  it('keeps a condition on "that unit" as a state, never as an always-on change', () => {
    const [mod] = statMods([
      {
        name: 'Muck Barrage',
        text: 'That enemy unit is **covered**: - While a unit is **covered**, that unit’s attacks have -1 to **hit rolls**.',
        source: 'Datasheet',
      },
    ])
    expect(mod?.when).toBe('While a unit is covered')
  })

  it('leaves an aura for the others off the model that projects it', () => {
    expect(
      statMods([
        {
          name: 'Herald (Aura)',
          text: "While a friendly **SOME** unit is within 6\" of this unit, that unit's melee attacks have: - +1 to **hit rolls**.",
          source: 'Datasheet',
        },
      ]),
    ).toEqual([])
  })

  it('carries the half of the datasheet named in the heading down to its bullets', () => {
    const mods = statMods([
      {
        name: 'Swagger',
        text: "This model's melee attacks have: - +1 **A**. - Or: If this unit has 11+ models, +2 **A**.",
        source: 'Datasheet',
      },
    ])
    expect(mods.map((m) => [m.value, m.target])).toEqual([
      ['+1', 'melee'],
      ['+2', 'melee'],
    ])
  })
})

describe('a range change only touches ranges', () => {
  const range = (target: 'any' | 'ranged' | 'melee') => ({
    stat: 'R',
    op: 'delta' as const,
    value: '+3"',
    target,
    subject: 'unit' as const,
    rule: 'r',
    source: 's',
  })
  it('leaves a melee weapon’s "Melee" range alone', () => {
    expect(applyMod('Melee', [range('any')])).toMatchObject({ value: 'Melee', changed: false, pending: [] })
  })
  it('does not offer a range modifier to melee weapons at all', () => {
    expect(modsFor([range('melee')], 'melee', 'R')).toEqual([])
    expect(modsFor([range('any')], 'ranged', 'R')).toHaveLength(1)
  })
  it('still adds to a numeric range', () => {
    expect(applyMod('24"', [range('ranged')])).toMatchObject({ value: '27"', changed: true })
  })
})

describe('a condition on the target is a condition', () => {
  const read = (text: string) => statMods([{ name: 'r', text, source: 's' }])[0]

  it('reads "attacks that target a MONSTER/VEHICLE unit" as conditional', () => {
    expect(read("This unit's attacks that target a **MONSTER/VEHICLE** unit have +1 **AP**.")).toMatchObject({
      stat: 'AP',
      when: 'attacks that target a MONSTER/VEHICLE unit',
      against: true,
    })
  })
  it('reads the other target conditions the data writes', () => {
    expect(read("This unit's attacks that target a unit within range of an **objective** have +1 **AP**.")?.when).toBe(
      'attacks that target a unit within range of an objective',
    )
    expect(read("This unit's attacks that target a unit that has no models with a **T** of 7+ have +1 to **hit rolls**.")?.when).toBe(
      'attacks that target a unit that has no models with a T of 7+',
    )
    expect(read("This unit's ranged attacks that target a unit (excluding **FLY** units) have +1 to **hit rolls**.")?.when).toBe(
      'attacks that target a unit (excluding FLY units)',
    )
    expect(
      read('Each time this model makes an attack that targets the closest eligible target, add 1 to the Armour Penetration characteristic of that attack.'),
    ).toMatchObject({ stat: 'AP', against: true })
    expect(
      read('Each time this model makes an attack that targets the closest eligible target, add 1 to the Armour Penetration characteristic of that attack.')?.when,
    ).toMatch(/targets the closest eligible target/)
  })
  it('is not a condition when any unit will do', () => {
    expect(read("This unit's attacks that target a unit have +1 **AP**.")?.when).toBeUndefined()
  })
  it('does not turn live, however many states the unit is in', () => {
    const [mod] = resolveMods(
      statMods([
        { name: 'r', text: 'While this unit is **riled up**, this unit’s attacks that target a **MONSTER** unit have +1 **AP**.', source: 's' },
      ]),
      ['riled up'],
    )
    expect(mod?.when).toMatch(/riled up/)
    expect(mod?.met).toBeUndefined()
  })
  it('does not double a target that the condition already names', () => {
    const [mod] = statMods([
      {
        name: 'Zog',
        text: "In your Shooting phase, if this unit's Zogger weapon targets a unit (excluding **MONSTER/VEHICLE** units), that weapon has +6 **A**.",
        source: 's',
      },
    ])
    expect(mod?.when).toBe("In your Shooting phase, if this unit's Zogger weapon targets a unit (excluding MONSTER/VEHICLE units)")
    expect(mod?.weapon).toEqual({ name: 'Zogger' })
  })
  it('keeps a heading’s target on the bullets under it', () => {
    const mods = statMods([
      { name: 'Flare', text: "If you do, this unit's attacks that target that unit have: - +1 **AP**.", source: 's' },
    ])
    expect(mods[0]?.when).toMatch(/that target that unit/)
    expect(mods[0]?.against).toBe(true)
  })
  it('still ignores attacks aimed at this unit', () => {
    expect(statMods([{ name: 'r', text: 'Attacks that target this unit have: - -1 **AP**.', source: 's' }])).toEqual([])
  })
})

describe('a bonus for some weapons only', () => {
  const rule = (text: string) => statMods([{ name: 'r', text, source: 's' }])
  const shot = { name: 'Zap gun', keywords: ['PSYCHIC', 'HEAVY'] }
  const other = { name: 'Slugga', keywords: ['PISTOL'] }

  it('keeps a keyword filter on the modifier', () => {
    const mods = rule("Friendly **SOME** models' **[PSYCHIC]** attacks have: - +1 **S**.")
    expect(mods[0]).toMatchObject({ stat: 'S', weapon: { keyword: 'PSYCHIC' } })
    expect(modsFor(mods, 'ranged', 'S', shot)).toHaveLength(1)
    expect(modsFor(mods, 'ranged', 'S', other)).toEqual([])
  })
  it('keeps a weapon-name filter, and reads the whole list "A, WS and S"', () => {
    const mods = rule("- This unit is **riled up**. - This unit's Rusty Choppers weapons have +1 **A**, **WS** and **S**.")
    expect(mods.map((m) => m.stat)).toEqual(['A', 'WS', 'S'])
    expect(mods.every((m) => m.weapon?.name === 'Rusty Choppers')).toBe(true)
    expect(modsFor(mods, 'melee', 'WS', { name: 'Rusty choppers', keywords: [] })).toHaveLength(1)
    expect(modsFor(mods, 'melee', 'WS', { name: 'Choppa', keywords: [] })).toEqual([])
  })
  it('keeps an exclusion', () => {
    const mods = rule('This unit\'s ranged attacks (excluding **[TORRENT]** attacks) have +3" **R**.')
    expect(mods[0]?.weapon).toEqual({ except: 'TORRENT' })
    expect(modsFor(mods, 'ranged', 'R', { name: 'Flamer', keywords: ['TORRENT'] })).toEqual([])
    expect(modsFor(mods, 'ranged', 'R', other)).toHaveLength(1)
  })
  it('offers a filtered modifier to no weapon when the caller names none', () => {
    expect(modsFor(rule("This unit's Rusty Choppers weapons have +1 **A**."), 'melee', 'A')).toEqual([])
  })
  it('lets the hit cell see the filter too', () => {
    const mods = rule("Friendly **SOME** models' **[PSYCHIC]** attacks have +1 to **hit rolls**.")
    expect(skillMods(mods, 'ranged', shot)).toHaveLength(1)
    expect(skillMods(mods, 'ranged', other)).toEqual([])
  })
})

describe('arithmetic on what is printed', () => {
  const mod = (stat: string, value: string) => ({
    stat,
    op: 'delta' as const,
    value,
    target: 'any' as const,
    subject: 'unit' as const,
    rule: 'r',
    source: 's',
  })
  it('adds a number to a dice expression instead of reading its first digit', () => {
    expect(applyMod('2D6', [mod('A', '+1')]).value).toBe('2D6+1')
    expect(applyMod('2D6', [mod('A', '-1')]).value).toBe('2D6-1')
    expect(applyMod('D6+3', [mod('A', '+1')]).value).toBe('D6+4')
    expect(applyMod('D6+1', [mod('A', '-1')]).value).toBe('D6')
  })
  it('never goes below the least a characteristic can be', () => {
    expect(applyMod('2"', [mod('M', '-4"')]).value).toBe('0"')
    expect(applyMod('1', [mod('OC', '-4')]).value).toBe('0')
    expect(applyMod('2', [mod('T', '-5')]).value).toBe('1')
    expect(applyMod('1', [mod('W', '-5')]).value).toBe('1')
  })
  it('reads "improve the Weapon Skill characteristic by 1" as a better skill', () => {
    const [ws] = statMods([
      { name: 'Whetstone', text: "Improve the Weapon Skill characteristic of weapons equipped by models in the bearer's unit by 1.", source: 's' },
    ])
    expect(applyMod('3+', [ws!]).value).toBe('2+')
    const [worse] = statMods([
      { name: 'Dazzle', text: 'Worsen the Ballistic Skill characteristic of weapons equipped by models in this unit by 1.', source: 's' },
    ])
    expect(applyMod('3+', [worse!]).value).toBe('4+')
    const [save] = statMods([{ name: 'Plates', text: 'Improve the Save characteristic of models in this unit by 1.', source: 's' }])
    expect(applyMod('4+', [save!]).value).toBe('3+')
  })
})

describe('"instead"', () => {
  const text =
    'Add 1 to the Objective Control characteristic of models in your unit. If your unit has the VEHICLE keyword, add 3 to the Objective Control characteristic instead.'
  it('replaces the base value when its condition holds, and does not stack with it', () => {
    const mods = statMods([{ name: 'Stubborn', text, source: 'Stratagem' }])
    expect(mods.map((m) => [m.value, m.when, m.instead])).toEqual([
      ['+1', undefined, undefined],
      ['+3', 'If your unit has the VEHICLE keyword', true],
    ])
    // Not met: the base alone.
    expect(applyMod('2', mods).value).toBe('3')
    // Met: the +3, and the +1 is gone.
    expect(applyMod('2', mods.map((m) => (m.instead ? { ...m, met: true } : m))).value).toBe('5')
  })
  it('takes the condition of the sentence before a leading "Instead"', () => {
    const [mod] = statMods([
      {
        name: 'Node',
        text: "Each time the bearer's unit Advances, do not make an Advance roll for it. Instead, until the end of the phase, add 6\" to the Move characteristic of models in the bearer's unit.",
        source: 'Enhancement',
      },
    ])
    expect(mod).toMatchObject({ stat: 'M', value: '+6"', when: "Each time the bearer's unit Advances" })
    expect(mod?.instead).toBeUndefined()
  })
})

describe('"against ranged attacks"', () => {
  it('shows the invulnerable save as conditional, never a plain 4+', () => {
    const [mod] = statMods([{ name: 'Field', text: 'This unit has 4+ **InSv** against ranged attacks.', source: 'Datasheet' }])
    expect(mod).toMatchObject({ stat: 'INVSV', value: '4+', when: 'against ranged attacks', against: true })
    const applied = applyMod('—', [mod!])
    expect(applied.changed).toBe(false)
    expect(applied.pending).toHaveLength(1)
  })
})
