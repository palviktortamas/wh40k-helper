import { describe, expect, it } from 'vitest'
import { resolveGrants, weaponGrants } from './grants'

// Audit 2026-11-03: a condition on the target is a condition for grants too.
// Invented rules in the sources' own grammar — no game data here.

describe('a grant that depends on what the attack is aimed at', () => {
  it('is conditional, and stays so whatever state the unit is in', () => {
    const grants = weaponGrants([
      {
        name: 'Hunter',
        text: "Friendly **SOME** units' attacks that target a **MONSTER/VEHICLE** unit have **[LETHAL HITS]**.",
        source: 'Detachment',
      },
    ])
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      keyword: 'LETHAL HITS',
      when: 'attacks that target a MONSTER/VEHICLE unit',
      against: true,
    })
    // A state the unit is in cannot settle which unit it is shooting at.
    expect(resolveGrants(grants, ['monster/vehicle'])[0]?.met).toBeUndefined()
  })

  it('keeps the target of a heading on the bullets under it', () => {
    const grants = weaponGrants([
      {
        name: 'Flare',
        text: "If you do, this unit's attacks that target that unit have: - +1 **AP**. - **[LETHAL HITS]**.",
        source: 'Datasheet',
      },
    ])
    expect(grants.map((g) => [g.keyword, g.against])).toEqual([['LETHAL HITS', true]])
    expect(grants[0]?.when).toMatch(/that target that unit/)
  })

  it('is not a condition when the attack may be aimed at any unit', () => {
    const [grant] = weaponGrants([
      { name: 'Any', text: "This unit's attacks that target a unit have **[LANCE]**.", source: 'Datasheet' },
    ])
    expect(grant?.when).toBeUndefined()
    expect(grant?.against).toBeUndefined()
  })
})
