import { describe, expect, it } from 'vitest'
import { resolveGrants, weaponGrants } from './grants'

// Invented rules written in the sources' own grammar — no game data here.

describe('weapon grants', () => {
  it('reads an unconditional grant and which half of the datasheet it lands on', () => {
    const grants = weaponGrants([
      { name: 'Get Stuck In', text: "Friendly **SOME KEYWORD** units' melee attacks have **[SUSTAINED HITS 1]**.", source: 'Detachment' },
    ])
    expect(grants).toEqual([
      { keyword: 'SUSTAINED HITS 1', kind: 'melee', subject: 'unit', rule: 'Get Stuck In', source: 'Detachment' },
    ])
  })

  it('keeps the condition a grant hangs on, and drops the scope phrase', () => {
    const grants = weaponGrants([
      {
        name: 'Tide of Muscle',
        text: 'In the Fight phase, if this unit made a **charge move** this turn, this unit’s melee attacks have **[LETHAL HITS]**.',
        source: 'Datasheet',
      },
    ])
    expect(grants).toHaveLength(1)
    expect(grants[0]!.keyword).toBe('LETHAL HITS')
    expect(grants[0]!.when).toBe('In the Fight phase, if this unit made a charge move this turn')
  })

  it('splits a bulleted rule and takes each grant on its own terms', () => {
    const grants = weaponGrants([
      {
        name: 'Waaagh!',
        text:
          '<p>Friendly units can: - Re-roll <b>advance rolls</b>. - Become **worked up**. While a unit is **worked up**: - That unit has 5+ **InSv**. - That unit’s ranged attacks have **[ASSAULT]**.</p>',
        source: 'Faction',
      },
    ])
    expect(grants.map((g) => [g.keyword, g.kind, g.when])).toEqual([
      ['ASSAULT', 'ranged', 'While a unit is worked up'],
    ])
  })

  it('takes every ability of a multi-ability grant, and a grant with no half named lands on both', () => {
    const grants = weaponGrants([
      { name: 'Rule', text: "That unit's attacks have **[LANCE]** and **[TWIN-LINKED]** until the end of the turn.", source: 'Stratagem' },
    ])
    expect(grants.map((g) => [g.keyword, g.kind])).toEqual([
      ['LANCE', 'any'],
      ['TWIN-LINKED', 'any'],
    ])
  })

  it('ignores the many rules that change something other than a weapon ability', () => {
    expect(
      weaponGrants([
        { name: 'A', text: "Friendly **SOME UNIT** units' ranged attacks have +1 to **hit rolls**.", source: 'Detachment' },
        { name: 'B', text: 'This unit can re-roll **charge rolls**.', source: 'Detachment' },
        { name: 'C', text: "This unit's attacks have the relevant rule(s).", source: 'Detachment' },
      ]),
    ).toEqual([])
  })

  it('does not repeat the same ability from the same rule', () => {
    const grants = weaponGrants([
      {
        name: 'Rule',
        text: "Friendly **A** units' melee attacks have **[CLEAVE 1]**. Friendly **A** units' melee attacks have **[CLEAVE 1]**.",
        source: 'Detachment',
      },
    ])
    expect(grants).toHaveLength(1)
  })
})

describe('the older, spelled-out grammar', () => {
  it('reads an ability given to a unit’s weapons rather than to its attacks', () => {
    const grants = weaponGrants([
      {
        name: 'Nebuloscope',
        text: "Ranged weapons equipped by models in the bearer's unit have the [IGNORES COVER] ability.",
        source: 'Enhancement',
      },
      { name: 'Unflinching', text: "The bearer's melee weapons have the [PRECISION] and [ANTI-INFANTRY 5+] abilities.", source: 'Enhancement' },
    ])
    expect(grants.map((g) => [g.keyword, g.kind])).toEqual([
      ['IGNORES COVER', 'ranged'],
      ['PRECISION', 'melee'],
      ['ANTI-INFANTRY 5+', 'melee'],
    ])
  })
})

describe('states a unit is already in', () => {
  it('marks a grant live once its condition is a state the unit holds', () => {
    const grants = weaponGrants([
      { name: 'Roar', text: 'While a unit is **worked up**: - That unit’s ranged attacks have **[ASSAULT]**.', source: 'Faction' },
      { name: 'Charge', text: 'If this unit made a **charge move**, its melee attacks have **[LETHAL HITS]**.', source: 'Datasheet' },
    ])
    expect(resolveGrants(grants, ['worked up']).map((g) => [g.keyword, g.met])).toEqual([
      ['ASSAULT', true],
      ['LETHAL HITS', undefined],
    ])
  })
})

describe('who a granted ability is for', () => {
  it('tells an ability given to the unit from one given to the bearer alone', () => {
    const grants = weaponGrants([
      { name: 'Horde', text: "This unit's melee attacks have **[SUSTAINED HITS 1]**.", source: 'Detachment' },
      { name: 'Relic', text: "This model's melee attacks have **[PRECISION]**.", source: 'Enhancement' },
      { name: 'Scope', text: "Ranged weapons equipped by the bearer have the [IGNORES COVER] ability.", source: 'Enhancement' },
    ])
    expect(grants.map((g) => [g.rule, g.subject])).toEqual([
      ['Horde', 'unit'],
      ['Relic', 'model'],
      ['Scope', 'model'],
    ])
  })
})

describe('a weapon ability a Stratagem gives', () => {
  it('is read from plain brackets, which is how the export writes it', () => {
    const grants = weaponGrants([
      { name: "Hit 'em Harder", text: "Your unit's melee attacks have [Lethal Hits].", source: 'Stratagem' },
    ])
    expect(grants.map((g) => [g.keyword, g.kind])).toEqual([['Lethal Hits', 'melee']])
  })
})

describe('"if you do" is not a condition', () => {
  it('reads a rule the player chooses to use as in force once it is used', () => {
    // "You can use this ability. If you do, …" waits on the player, not on the
    // battlefield — and putting the rule into effect *is* the player doing it.
    const [grant] = weaponGrants([
      {
        name: 'Ammo Runts',
        text: 'When this unit is selected to shoot, you can use this ability. If you do, this unit’s ranged attacks have **[IGNORES COVER]**.',
        source: 'Datasheet',
      },
    ])
    expect(grant?.when).toBeUndefined()
  })
})
