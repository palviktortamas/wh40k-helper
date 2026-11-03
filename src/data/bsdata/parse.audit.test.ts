/**
 * Synthetic catalogues for the parser findings of the 2026-11-03 audit: an
 * ability that depends on an attached character, enhancements nested in a unit,
 * rule links on a model entry, duplicate weapon profiles, relic weapons. Shaped
 * like the sources, carrying no game data.
 */

import { describe, expect, it } from 'vitest'
import { parseCatalogue } from './parse'
import { COST_TYPE } from './schema'
import type { Catalogue, GameSystem, Profile, Rule, SelectionEntry } from './schema'

const gameSystem: GameSystem = { id: 'gs', name: 'Test System', revision: 1, battleScribeVersion: '2.03' }

const rule = (id: string, name: string): Rule => ({ id, name, description: 'Some rules text.' })
const abilityProfile = (id: string, name: string, text = 'Something happens.'): Profile => ({
  id,
  name,
  typeId: 't-abilities',
  typeName: 'Abilities',
  characteristics: [{ name: 'Description', typeId: 'c-desc', $text: text }],
})
const weaponProfile = (id: string, name: string, keywords = '-'): Profile => ({
  id,
  name,
  typeId: 't-ranged',
  typeName: 'Ranged Weapons',
  characteristics: [
    { name: 'Range', typeId: 'c-r', $text: '24"' },
    { name: 'A', typeId: 'c-a', $text: '2' },
    { name: 'BS', typeId: 'c-bs', $text: '4+' },
    { name: 'S', typeId: 'c-s', $text: '4' },
    { name: 'AP', typeId: 'c-ap', $text: '0' },
    { name: 'D', typeId: 'c-d', $text: '1' },
    { name: 'Keywords', typeId: 'c-k', $text: keywords },
  ],
})
const stats: Profile = {
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

const build = (entry: SelectionEntry, extra: Partial<Catalogue> = {}): Catalogue => ({
  id: 'cat',
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  categoryEntries: [{ id: 'cat-role', name: 'Vehicle' }],
  sharedSelectionEntries: [entry],
  entryLinks: [{ id: 'root-link', name: entry.name, targetId: entry.id, type: 'selectionEntry' }],
  ...extra,
})

const wagon = (extra: Partial<SelectionEntry>): SelectionEntry => ({
  id: 'e-wagon',
  name: 'Wagon',
  type: 'unit',
  categoryLinks: [{ id: 'cl', name: 'Vehicle', targetId: 'cat-role', primary: true }],
  profiles: [stats],
  ...extra,
})

const sheetOf = (cat: Catalogue) => {
  const sheet = parseCatalogue(gameSystem, cat).datasheets[0]
  if (!sheet) throw new Error('no datasheet parsed')
  return sheet
}

describe('an ability the data hides unless a character is attached', () => {
  const hiddenWithoutAttached = (childId: string, childName?: string, scope = 'self') => [
    {
      type: 'set' as const,
      field: 'hidden',
      value: true,
      conditions: [
        { type: 'lessThan' as const, field: 'associations', value: 1, scope, childId, ...(childName ? { childName } : {}), shared: true },
      ],
    },
  ]
  const hero: SelectionEntry = { id: 'e-hero', name: 'Some Hero', type: 'model' }

  it('names the character on a linked rule', () => {
    const cat = build(
      wagon({ infoLinks: [{ id: 'il', name: 'Tough', targetId: 'r-1', type: 'rule', modifiers: hiddenWithoutAttached('e-hero') }] }),
      { sharedRules: [rule('r-1', 'Tough')], sharedSelectionEntries: [wagon({ infoLinks: [{ id: 'il', name: 'Tough', targetId: 'r-1', type: 'rule', modifiers: hiddenWithoutAttached('e-hero') }] }), hero] },
    )
    expect(sheetOf(cat).abilities.find((a) => a.name === 'Tough')?.onlyWithAttached).toEqual(['Some Hero'])
  })

  it('means any attached character when the condition names none in particular', () => {
    const cat = build(
      wagon({ infoLinks: [{ id: 'il', name: 'Tough', targetId: 'r-1', type: 'rule', modifiers: hiddenWithoutAttached('any', undefined, 'root-entry') }] }),
      { sharedRules: [rule('r-1', 'Tough')] },
    )
    expect(sheetOf(cat).abilities.find((a) => a.name === 'Tough')?.onlyWithAttached).toEqual([])
  })

  it('applies to a linked profile too', () => {
    const cat = build(
      wagon({ infoLinks: [{ id: 'il', name: 'Power', targetId: 'p-power', type: 'profile', modifiers: hiddenWithoutAttached('e-gone', 'Recorded Hero') }] }),
      { sharedProfiles: [abilityProfile('p-power', 'Power')] },
    )
    expect(sheetOf(cat).abilities.find((a) => a.name === 'Power')?.onlyWithAttached).toEqual(['Recorded Hero'])
  })
})

describe('an enhancement nested in a unit is not the unit\'s own ability', () => {
  it('leaves the enhancement\'s profile out of the datasheet abilities', () => {
    const enhancement: SelectionEntry = {
      id: 'e-enh',
      name: 'Shiny Thing',
      type: 'upgrade',
      costs: [{ name: 'Enhancements', typeId: COST_TYPE.enhancements, value: 20 }],
      profiles: [abilityProfile('p-enh', 'Shiny Effect')],
    }
    const cat = build(
      wagon({
        profiles: [stats, abilityProfile('p-own', 'Own Rule')],
        selectionEntryGroups: [{ id: 'g-enh', name: 'Enhancements', selectionEntries: [enhancement] }],
      }),
    )
    const sheet = sheetOf(cat)
    expect(sheet.abilities.map((a) => a.name)).toEqual(['Own Rule'])
    // …but the enhancement is still known, with its text.
    expect(parseCatalogue(gameSystem, cat).enhancements?.find((e) => e.id === 'e-enh')?.text).toContain('Something happens')
  })
})

describe('a rule linked on a nested model entry', () => {
  it('is an ability of the unit, with the name the link gives it', () => {
    const model: SelectionEntry = {
      id: 'e-model',
      name: 'The Model',
      type: 'model',
      infoLinks: [
        {
          id: 'il',
          name: 'Blast',
          targetId: 'r-1',
          type: 'rule',
          modifiers: [{ type: 'append', field: 'name', value: '6' }],
        },
      ],
    }
    const cat = build(wagon({ selectionEntries: [model] }), { sharedRules: [rule('r-1', 'Blast')] })
    expect(sheetOf(cat).abilities.find((a) => a.id === 'r-1')?.name).toBe('Blast 6')
  })

  it('is listed once when the unit links it as well', () => {
    const model: SelectionEntry = {
      id: 'e-model',
      name: 'The Model',
      type: 'model',
      infoLinks: [{ id: 'il2', name: 'Blast', targetId: 'r-1', type: 'rule' }],
    }
    const cat = build(
      wagon({ selectionEntries: [model], infoLinks: [{ id: 'il1', name: 'Blast', targetId: 'r-1', type: 'rule' }] }),
      { sharedRules: [rule('r-1', 'Blast')] },
    )
    expect(sheetOf(cat).abilities.filter((a) => a.id === 'r-1')).toHaveLength(1)
  })
})

describe('identical weapon profiles on one unit', () => {
  const twoOf = (a: Profile, b: Profile) =>
    sheetOf(
      build(
        wagon({
          selectionEntries: [
            { id: 'e-m1', name: 'Mob', type: 'model', profiles: [a] },
            { id: 'e-m2', name: 'Boss', type: 'model', profiles: [b] },
          ],
        }),
      ),
    ).weapons

  it('are one weapon row', () => {
    expect(twoOf(weaponProfile('w1', 'Gun'), weaponProfile('w2', 'Gun'))).toHaveLength(1)
  })

  it('keep the richer keywords when only the keywords differ', () => {
    const weapons = twoOf(weaponProfile('w1', 'Gun'), weaponProfile('w2', 'Gun', 'Assault'))
    expect(weapons).toHaveLength(1)
    expect(weapons[0]?.keywords).toEqual(['Assault'])
  })

  it('keep two profiles that really differ', () => {
    const other = weaponProfile('w2', 'Gun')
    other.characteristics = other.characteristics!.map((c) => (c.name === 'A' ? { ...c, $text: '3' } : c))
    expect(twoOf(weaponProfile('w1', 'Gun'), other)).toHaveLength(2)
  })
})

describe('a relic weapon that carries an Enhancement cost', () => {
  it('is an enhancement whose text is its profile, not an empty string', () => {
    const relic: SelectionEntry = {
      id: 'e-relic',
      name: 'Relic Gun',
      type: 'upgrade',
      costs: [{ name: 'Enhancements', typeId: COST_TYPE.enhancements, value: 10 }],
      profiles: [weaponProfile('w-relic', 'Relic Gun', 'Assault, Heavy')],
    }
    const parsed = parseCatalogue(gameSystem, build(wagon({ selectionEntries: [relic] })))
    const text = parsed.enhancements?.find((e) => e.id === 'e-relic')?.text ?? ''
    expect(text).toContain('Relic Gun')
    expect(text).toContain('24"')
    expect(text).toContain('Assault, Heavy')
  })
})
