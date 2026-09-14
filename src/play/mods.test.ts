import { describe, expect, it } from 'vitest'
import { applyMod, modsFor, resolveMods, statMods } from './mods'

// Invented rules in the sources' own grammar — no game data here.

describe('stat modifiers', () => {
  it('reads a characteristic a rule sets outright', () => {
    expect(statMods([{ name: "'Ardboyz", text: '**SOME** unit only. This unit has 4+ **Sv**.', source: 'Enhancement' }])).toEqual([
      { stat: 'SV', op: 'set', value: '4+', target: 'unit', rule: "'Ardboyz", source: 'Enhancement' },
    ])
  })

  it('reads a change to a characteristic, inches and all', () => {
    const mods = statMods([
      { name: 'Boosta', text: 'This model has +2" **M**.', source: 'Enhancement' },
      { name: 'Tough', text: 'This model has +1 **T**.', source: 'Enhancement' },
    ])
    expect(mods.map((m) => [m.stat, m.op, m.value])).toEqual([
      ['M', 'delta', '+2"'],
      ['T', 'delta', '+1'],
    ])
  })

  it('puts a weapon characteristic on the weapons, not on the unit', () => {
    const mods = statMods([
      { name: 'Brutal', text: "This model's melee attacks have +1 **D**.", source: 'Enhancement' },
      { name: 'Dakka', text: 'While this unit is **worked up**, +3" **R**.', source: 'Detachment' },
    ])
    expect(mods.map((m) => [m.stat, m.target, m.value, m.when])).toEqual([
      ['D', 'melee', '+1', undefined],
      ['R', 'any', '+3"', 'While this unit is worked up'],
    ])
  })

  it('ignores a characteristic given to somebody else', () => {
    expect(
      statMods([
        {
          name: 'Blitzboss',
          text: 'A **TRANSPORT** unit this unit is embarked within has: - +2" **M**. - 5+ **InSv**.',
          source: 'Enhancement',
        },
      ]),
    ).toEqual([])
  })

  it('ignores the many rules that change something that is not a characteristic', () => {
    expect(
      statMods([
        { name: 'A', text: "This unit's ranged attacks have +1 to **hit rolls**.", source: 'Detachment' },
        { name: 'B', text: 'This unit can re-roll **charge rolls**.', source: 'Detachment' },
        { name: 'C', text: 'This unit has 11+ models.', source: 'Detachment' },
        { name: 'D', text: "This unit's melee attacks have **[SUSTAINED HITS 1]**.", source: 'Detachment' },
      ]),
    ).toEqual([])
  })

  it('marks a modifier live when its condition is a state the unit is in', () => {
    const mods = resolveMods(
      statMods([{ name: 'Frenzy', text: 'While a unit is **worked up**, that unit has 5+ **InSv**.', source: 'Faction' }]),
      ['worked up'],
    )
    expect(mods[0]).toMatchObject({ stat: 'INVSV', value: '5+', met: true })
  })
})

describe('applying a modifier to a printed value', () => {
  const mod = (stat: string, op: 'delta' | 'set', value: string, when?: string) => ({
    stat,
    op,
    value,
    target: 'unit' as const,
    rule: 'r',
    source: 's',
    ...(when ? { when } : {}),
  })

  it('adds a delta and keeps the unit of measure', () => {
    expect(applyMod('6"', [mod('M', 'delta', '+2"')])).toMatchObject({ value: '8"', changed: true })
    expect(applyMod('5', [mod('T', 'delta', '-1')])).toMatchObject({ value: '4', changed: true })
  })

  it('sets a characteristic outright, and keeps the best of two', () => {
    expect(applyMod('5+', [mod('SV', 'set', '4+')])).toMatchObject({ value: '4+' })
    expect(applyMod('5+', [mod('SV', 'set', '6+'), mod('SV', 'set', '4+')])).toMatchObject({ value: '4+' })
  })

  it('reads +1 AP as one better, the way the rules mean it', () => {
    expect(applyMod('-2', [mod('AP', 'delta', '+1')])).toMatchObject({ value: '-3' })
    expect(applyMod('0', [mod('AP', 'delta', '+1')])).toMatchObject({ value: '-1' })
  })

  it('does not pretend to do arithmetic on a dice value', () => {
    expect(applyMod('D6', [mod('D', 'delta', '+1')])).toMatchObject({ value: 'D6+1' })
  })

  it('does not change a number for a condition that does not hold yet', () => {
    // A 5+ invulnerable save the unit only has while worked up is not an
    // invulnerable save; it is a note about one.
    const applied = applyMod('5', [mod('T', 'delta', '+1', 'while it is worked up')])
    expect(applied).toMatchObject({ value: '5', changed: false })
    expect(applied.pending.map((m) => m.value)).toEqual(['+1'])
  })

  it('changes it once that condition is met, and says the change can end', () => {
    const applied = applyMod('5', [{ ...mod('T', 'delta', '+1', 'while it is worked up'), met: true }])
    expect(applied).toMatchObject({ value: '6', changed: true, temporary: true, pending: [] })
  })

  it('leaves a value alone when nothing modifies it', () => {
    expect(applyMod('5+', [])).toEqual({ value: '5+', changed: false, temporary: false, pending: [] })
    expect(applyMod(undefined, [])).toEqual({ value: '—', changed: false, temporary: false, pending: [] })
  })
})

describe('picking the modifiers that apply', () => {
  const mods = statMods([
    { name: 'A', text: 'This unit has +1 **T**.', source: 'x' },
    { name: 'B', text: "This unit's melee attacks have +1 **A**.", source: 'x' },
    { name: 'C', text: "This unit's ranged attacks have +1 **S**.", source: 'x' },
    { name: 'D', text: 'While **worked up**, +3" **R**.', source: 'x' },
  ])

  it('keeps unit characteristics off the weapons and the other way round', () => {
    expect(modsFor(mods, 'unit', 'T').map((m) => m.rule)).toEqual(['A'])
    expect(modsFor(mods, 'melee', 'A').map((m) => m.rule)).toEqual(['B'])
    expect(modsFor(mods, 'ranged', 'A')).toEqual([])
    // A modifier that names neither half lands on both.
    expect(modsFor(mods, 'ranged', 'R').map((m) => m.rule)).toEqual(['D'])
    expect(modsFor(mods, 'melee', 'R').map((m) => m.rule)).toEqual(['D'])
  })
})

describe('what a modifier reader must not be fooled by', () => {
  it('ignores a modifier on attacks that come the other way', () => {
    expect(
      statMods([
        { name: 'Armoured', text: 'Attacks that target this unit have -1 **D**.', source: 'x' },
        { name: 'Bulky', text: 'Ranged attacks that target this unit have -1 **AP**.', source: 'x' },
      ]),
    ).toEqual([])
  })

  it('still reads a modifier on attacks this unit makes against a named target', () => {
    const mods = statMods([
      { name: 'Hunter', text: "Friendly **SOME** units' attacks that target a **MONSTER** unit have +1 **AP**.", source: 'x' },
    ])
    expect(mods.map((m) => [m.stat, m.value])).toEqual([['AP', '+1']])
  })

  it('leaves a modifier that counts something to the rule’s own text', () => {
    expect(
      statMods([
        { name: 'Loaded', text: "This unit's weapon has +2 **A** for each model embarked (to a maximum of +22 **A**).", source: 'x' },
      ]),
    ).toEqual([])
  })

  it('takes both characteristics when one change is written for two', () => {
    const mods = statMods([
      { name: 'Charge', text: "This unit's melee attacks have +1 **A** and **S**.", source: 'x' },
    ])
    expect(mods.map((m) => [m.stat, m.value, m.target])).toEqual([
      ['A', '+1', 'melee'],
      ['S', '+1', 'melee'],
    ])
  })
})

describe('the older, spelled-out grammar', () => {
  it('reads "add N to the X characteristic", on the unit and on its weapons', () => {
    const mods = statMods([
      { name: 'Node', text: "Add 6\" to the Move characteristic of models in the bearer's unit.", source: 'Enhancement' },
      { name: 'Ankh', text: 'Add 2 to the Attacks characteristic of melee weapons equipped by the bearer.', source: 'Enhancement' },
      { name: 'Bolas', text: "Subtract 2 from that unit's Move characteristic.", source: 'Enhancement' },
    ])
    expect(mods.map((m) => [m.stat, m.op, m.value, m.target])).toEqual([
      ['M', 'delta', '+6"', 'unit'],
      ['A', 'delta', '+2', 'melee'],
      ['M', 'delta', '-2', 'unit'],
    ])
  })

  it('reads "improve the Armour Penetration characteristic by N"', () => {
    const mods = statMods([
      { name: 'Superiority', text: "Each time a model in the bearer's unit makes an attack, improve the Armour Penetration characteristic of that attack by 1.", source: 'Enhancement' },
    ])
    expect(mods.map((m) => [m.stat, m.value, m.target])).toEqual([['AP', '+1', 'any']])
  })

  it('does not take a modifier the older grammar gives to somebody else', () => {
    expect(
      statMods([
        { name: 'Pin', text: "While a unit is pinned, subtract 2 from that enemy unit's Move characteristic.", source: 'x' },
      ]),
    ).toEqual([])
  })
})
