/**
 * What a profile *is* is read from the characteristics it carries, not from
 * the name of its type.
 *
 * A codex invents profile types freely — a psyker's powers, a dynasty's aura
 * table, a button with a D6 result per row — and a parser that only knows the
 * type called "Abilities" silently drops every one of them. A unit missing an
 * ability at the table is the worst failure this app has: the rule is simply
 * not there to be found.
 *
 * Invented names throughout; the repo holds no game data.
 */

import { describe, expect, it } from 'vitest'
import { classifyProfile } from './profiles'
import type { Profile } from './schema'

const profile = (typeName: string, characteristics: [string, string][]): Profile => ({
  id: 'p',
  name: 'Something',
  typeId: 't',
  typeName,
  characteristics: characteristics.map(([name, $text]) => ({ name, typeId: `c-${name}`, $text })),
})

describe('classifyProfile', () => {
  it('knows a stat line by its characteristics', () => {
    expect(
      classifyProfile(
        profile('Unit', [
          ['M', '6"'],
          ['T', '5'],
          ['SV', '5+'],
          ['W', '1'],
          ['LD', '7+'],
          ['OC', '2'],
        ]),
      ),
    ).toEqual({ kind: 'stats' })
  })

  it('knows a stat line down to its bare bones', () => {
    expect(classifyProfile(profile('Unit', [['W', '4']]))).toEqual({ kind: 'stats' })
  })

  it('knows a weapon, and which skill it rolls', () => {
    expect(
      classifyProfile(
        profile('Ranged Weapons', [
          ['Range', '18"'],
          ['A', '2'],
          ['BS', '5+'],
          ['S', '4'],
          ['AP', '0'],
          ['D', '1'],
          ['Keywords', '-'],
        ]),
      ),
    ).toEqual({ kind: 'weapon', weapon: 'ranged' })
    expect(
      classifyProfile(
        profile('Melee Weapons', [
          ['Range', 'Melee'],
          ['A', '3'],
          ['WS', '3+'],
          ['S', '5'],
          ['AP', '-1'],
          ['D', '2'],
        ]),
      ),
    ).toEqual({ kind: 'weapon', weapon: 'melee' })
  })

  it('knows a weapon a codex files under its own type name', () => {
    // A psyker's powers, a star god's, a vehicle's special attack: the rows are
    // weapon rows whatever the codex calls the table.
    expect(
      classifyProfile(
        profile('Star Powers', [
          ['Range', '24"'],
          ['A', 'D6'],
          ['BS', '2+'],
          ['S', '8'],
          ['AP', '-2'],
          ['D', '3'],
          ['Keywords', 'Blast'],
        ]),
      ),
    ).toEqual({ kind: 'weapon', weapon: 'ranged' })
  })

  it('knows transport capacity', () => {
    expect(classifyProfile(profile('Transport', [['Capacity', 'Ten models.']]))).toEqual({
      kind: 'transport',
    })
  })

  it('takes any other profile with rules text as an ability', () => {
    expect(classifyProfile(profile('Abilities', [['Description', 'Does a thing.']]))).toEqual({
      kind: 'ability',
    })
    // The plural spelling one codex uses, and another's word for the same thing.
    expect(classifyProfile(profile('Psychic Powers', [['Descriptions', 'Roll a D6.']]))).toEqual({
      kind: 'ability',
      group: 'Psychic Powers',
    })
    expect(classifyProfile(profile('Court Abilities', [['Effect', 'While within 6".']]))).toEqual({
      kind: 'ability',
      group: 'Court Abilities',
    })
  })

  it('ignores a profile with nothing in it', () => {
    expect(classifyProfile(profile('Abilities', [['Description', '']]))).toBeUndefined()
    expect(classifyProfile(profile('Mystery', []))).toBeUndefined()
  })
})
