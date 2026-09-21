/**
 * Synthetic catalogues, shaped like the real sources but carrying no game data
 * (see CLAUDE.md). They pin the two things a datasheet's ability list must not
 * lose: the value a link appends to a shared rule's name, and the transport
 * capacity.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from './parse'
import type { Catalogue, GameSystem, Profile, Rule, SelectionEntry } from './schema'

const gameSystem: GameSystem = {
  id: 'gs',
  name: 'Test System',
  revision: 1,
  battleScribeVersion: '2.03',
}

const rule = (id: string, name: string): Rule => ({ id, name, description: 'Some rules text.' })

const statsProfile: Profile = {
  id: 'p-stats',
  name: 'Wagon',
  typeId: 't-unit',
  typeName: 'Unit',
  characteristics: [
    { name: 'M', typeId: 'c-m', $text: '12"' },
    { name: 'T', typeId: 'c-t', $text: '8' },
    { name: 'W', typeId: 'c-w', $text: '10' },
  ],
}

const transportProfile: Profile = {
  id: 'p-transport',
  name: 'Wagon',
  typeId: 't-transport',
  typeName: 'Transport',
  characteristics: [
    { name: 'Capacity', typeId: 'c-cap', $text: 'This model has a transport capacity of 12 models.' },
  ],
}

const build = (entry: SelectionEntry, rules: Rule[]): Catalogue => ({
  id: 'cat',
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  categoryEntries: [{ id: 'cat-role', name: 'Vehicle' }],
  sharedRules: rules,
  sharedSelectionEntries: [entry],
  entryLinks: [{ id: 'root-link', name: entry.name, targetId: entry.id, type: 'selectionEntry' }],
})

const wagon = (extra: Partial<SelectionEntry>): SelectionEntry => ({
  id: 'e-wagon',
  name: 'Wagon',
  type: 'unit',
  categoryLinks: [{ id: 'cl', name: 'Vehicle', targetId: 'cat-role', primary: true }],
  profiles: [statsProfile],
  ...extra,
})

const sheetOf = (cat: Catalogue) => {
  const sheet = parseCatalogue(gameSystem, cat).datasheets[0]
  if (!sheet) throw new Error('no datasheet parsed')
  return sheet
}

describe('a linked rule keeps the value the datasheet gives it', () => {
  // BSData names a shared rule once and each datasheet that links it appends
  // its own number through a `name` modifier on the link. That number — how
  // far, how many, on what roll — is the only part of the rule that differs
  // per unit, so dropping it makes the ability useless at the table.
  it('appends the link\'s value to the rule name', () => {
    const sheet = sheetOf(
      build(
        wagon({
          infoLinks: [
            {
              id: 'il-1',
              name: 'Shared Rule',
              targetId: 'r-1',
              type: 'rule',
              modifiers: [{ type: 'append', field: 'name', value: 'D3' }],
            },
          ],
        }),
        [rule('r-1', 'Shared Rule')],
      ),
    )
    expect(sheet.abilities.map((a) => a.name)).toContain('Shared Rule D3')
  })

  it('appends a numeric value, and honours the join the source asks for', () => {
    const sheet = sheetOf(
      build(
        wagon({
          infoLinks: [
            {
              id: 'il-1',
              name: 'Counted Rule',
              targetId: 'r-1',
              type: 'rule',
              modifiers: [{ type: 'append', field: 'name', value: 12 }],
            },
            {
              id: 'il-2',
              name: 'Joined Rule',
              targetId: 'r-2',
              type: 'rule',
              modifiers: [{ type: 'append', field: 'name', value: '5+', join: ' ' }],
            },
          ],
        }),
        [rule('r-1', 'Counted Rule'), rule('r-2', 'Joined Rule')],
      ),
    )
    const names = sheet.abilities.map((a) => a.name)
    expect(names).toContain('Counted Rule 12')
    expect(names).toContain('Joined Rule 5+')
  })

  it('leaves a plain link alone, and ignores modifiers to other fields', () => {
    const sheet = sheetOf(
      build(
        wagon({
          infoLinks: [
            {
              id: 'il-1',
              name: 'Plain Rule',
              targetId: 'r-1',
              type: 'rule',
              modifiers: [{ type: 'set', field: 'hidden', value: true }],
            },
          ],
        }),
        [rule('r-1', 'Plain Rule')],
      ),
    )
    expect(sheet.abilities.map((a) => a.name)).toContain('Plain Rule')
  })

  it('skips a conditional rename — what a roster settles is not a datasheet fact', () => {
    const sheet = sheetOf(
      build(
        wagon({
          infoLinks: [
            {
              id: 'il-1',
              name: 'Plain Rule',
              targetId: 'r-1',
              type: 'rule',
              modifiers: [
                {
                  type: 'append',
                  field: 'name',
                  value: 'Later',
                  conditions: [
                    {
                      type: 'atLeast',
                      field: 'selections',
                      value: 1,
                      scope: 'roster',
                      childId: 'e-wagon',
                      shared: true,
                    },
                  ],
                },
              ],
            },
          ],
        }),
        [rule('r-1', 'Plain Rule')],
      ),
    )
    expect(sheet.abilities.map((a) => a.name)).toContain('Plain Rule')
  })
})

describe('transport capacity', () => {
  // "How many fit?" is asked at the table, where the unit sheet lists
  // abilities. The capacity is printed on the real datasheet like any other
  // rule, so it is listed as one — and still kept on its own field for the
  // embark control.
  it('is listed as an ability under the source\'s own heading', () => {
    const sheet = sheetOf(build(wagon({ profiles: [statsProfile, transportProfile] }), []))
    const transport = sheet.abilities.find((a) => a.name === 'Transport')
    expect(transport?.text).toContain('transport capacity of 12 models')
    expect(sheet.transportCapacity).toContain('12')
  })

  it('is absent from a unit that carries no transport profile', () => {
    const sheet = sheetOf(build(wagon({}), []))
    expect(sheet.abilities.map((a) => a.name)).not.toContain('Transport')
    expect(sheet.transportCapacity).toBeUndefined()
  })
})
