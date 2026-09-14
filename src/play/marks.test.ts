/**
 * Marks: states a faction's own rules name, grant and then refer back to.
 *
 * The core rules' statuses (Battle-shock, Advanced, …) are a fixed list the app
 * knows. A codex invents its own — "a unit is **worked up** until the start of
 * your next turn", and then a dozen datasheets say "while this unit is worked
 * up, …". Nothing about that is faction-specific *as a mechanism*, so the marks
 * are discovered from the installed data rather than listed in code.
 *
 * The data's own discriminator does the work: it bolds unit keywords in CAPITALS
 * and states like this in lower case.
 *
 * Invented rules throughout — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { discoverMarks, grantedMarks, invulnerableFrom, rulesAboutMark } from './marks'
import type { Ability, ParsedCatalogue } from '@/data/model'

const ability = (id: string, name: string, text: string): Ability => ({
  id,
  name,
  kind: 'datasheet',
  text,
})

const catalogue = (abilities: Ability[], armyRules: Ability[] = []): ParsedCatalogue =>
  ({
    id: 'cat',
    name: 'Faction',
    revision: 1,
    gameSystemId: 'gs',
    rules: armyRules,
    unsupported: [],
    enhancements: [],
    detachments: [],
    datasheets: [
      {
        id: 'ds',
        name: 'Mob',
        keywords: ['INFANTRY'],
        factionKeywords: ['GREENSKINS'],
        type: 'unit',
        stats: [],
        weapons: [],
        abilities,
        models: [],
        associations: [],
        constraints: [],
        sources: ['bsdata'],
      },
    ],
  }) as unknown as ParsedCatalogue

describe('discoverMarks', () => {
  it('finds a state that something sets and something reads', () => {
    const marks = discoverMarks(
      catalogue([
        ability('a1', 'Get Going', 'In your Movement phase, this unit is **worked up** until the start of your next turn.'),
        ability('a2', 'Frenzy', 'While this unit is **worked up**, its ranged attacks have [ASSAULT].'),
      ]),
    )
    expect(marks.map((m) => m.label)).toEqual(['worked up'])
  })

  it('ignores a phrase nothing can put a unit into', () => {
    // Read but never set: "while this unit is damaged" describes a condition
    // of the model, not a state the player applies.
    const marks = discoverMarks(
      catalogue([ability('a1', 'Limping', 'While this unit is **badly dented**, it has -1 to hit rolls.')]),
    )
    expect(marks).toEqual([])
  })

  it('ignores a phrase nothing ever reacts to', () => {
    // Set but never read — a turn of phrase, with no rule behind it.
    const marks = discoverMarks(
      catalogue([ability('a1', 'Boom', 'On a 6, that model is **utterly ruined**.')]),
    )
    expect(marks).toEqual([])
  })

  it('ignores a moment mistaken for a state', () => {
    const marks = discoverMarks(
      catalogue([
        ability('a1', 'Aim', 'Each time this unit is **selected to shoot**, it may not move.'),
        ability('a2', 'React', 'If this unit is **selected to shoot**, add 1 to hit rolls.'),
      ]),
    )
    expect(marks).toEqual([])
  })

  it('never mistakes a unit keyword for a state', () => {
    // The data bolds keywords in capitals; a state is written in prose.
    const marks = discoverMarks(
      catalogue([
        ability('a1', 'Shouty', 'Friendly **GREENSKINS INFANTRY** units can re-roll advance rolls.'),
        ability('a2', 'Louder', 'While a unit is **GREENSKINS**, nothing at all happens.'),
      ]),
    )
    expect(marks).toEqual([])
  })

  it('leaves the core rules’ own statuses alone — the app already models those', () => {
    const marks = discoverMarks(
      catalogue([
        ability('a1', 'Rally', 'That unit is **battle-shocked** until the end of the turn.'),
        ability('a2', 'Panic', 'While this unit is **battle-shocked**, it cannot hold objectives.'),
      ]),
    )
    expect(marks).toEqual([])
  })

  it('reports each state once, however many rules mention it', () => {
    const marks = discoverMarks(
      catalogue([
        ability('a1', 'One', 'This unit is **worked up** until the start of your next turn.'),
        ability('a2', 'Two', 'While this unit is **worked up**, it has a 5+ invulnerable save.'),
        ability('a3', 'Three', 'If this unit is **worked up**, its attacks have [SUSTAINED HITS 1].'),
      ]),
    )
    expect(marks).toHaveLength(1)
    expect(marks[0]?.key).toBe('worked up')
  })
})

describe('grantedMarks', () => {
  const marks = [{ key: 'worked up', label: 'worked up' }]

  it('spots an ability that puts the state on this very unit', () => {
    const granted = grantedMarks('In your Movement phase, this unit is **worked up** until the start of your next turn.', marks)
    expect(granted.map((g) => g.mark.key)).toEqual(['worked up'])
    expect(granted[0]?.scope).toBe('self')
  })

  it('spots one that lets you choose another unit', () => {
    const granted = grantedMarks(
      'You can select one friendly **GREENSKINS** unit within 6". That unit is **worked up** until the start of your next turn.',
      marks,
    )
    expect(granted[0]?.scope).toBe('chosen')
  })

  it('spots one that sweeps the whole army', () => {
    const granted = grantedMarks(
      'At the start of the Command phase, friendly **GREENSKINS** units with this ability are **worked up** until the end of the next turn.',
      marks,
    )
    expect(granted[0]?.scope).toBe('army')
  })

  it('ignores a rule that only reads the state', () => {
    expect(grantedMarks('While this unit is **worked up**, it fights first.', marks)).toEqual([])
  })

  it('carries how long it lasts, in the rules’ own words', () => {
    const granted = grantedMarks('This unit is **worked up** until the start of your next turn.', marks)
    expect(granted[0]?.until).toBe('until the start of your next turn')
  })
})

describe('rulesAboutMark', () => {
  it('collects the rules that speak about the state and reach this unit', () => {
    const cat = catalogue(
      [ability('a1', 'Frenzy', 'While this unit is **worked up**, its ranged attacks have [ASSAULT].')],
      [ability('army1', 'Waaagh', 'While a unit is **worked up**, that unit has 5+ invulnerable save.')],
    )
    const found = rulesAboutMark(cat, { key: 'worked up', label: 'worked up' }, ['INFANTRY', 'GREENSKINS'], 'ds')
    expect(found.map((r) => r.name).sort()).toEqual(['Frenzy', 'Waaagh'])
  })

  it('leaves out a rule that names keywords this unit does not have', () => {
    const cat = catalogue(
      [],
      [ability('army1', 'Flyboyz', 'While a friendly **AIRCRAFT** unit is **worked up**, it may re-roll hits.')],
    )
    const found = rulesAboutMark(cat, { key: 'worked up', label: 'worked up' }, ['INFANTRY'], 'ds')
    expect(found).toEqual([])
  })

  it('leaves out the rule that merely grants it', () => {
    const cat = catalogue([ability('a1', 'Get Going', 'This unit is **worked up** until the start of your next turn.')])
    expect(rulesAboutMark(cat, { key: 'worked up', label: 'worked up' }, ['INFANTRY'], 'ds')).toEqual([])
  })

  it('leaves out an army-wide rule that only grants it, however long its text', () => {
    // A rule can grant the state and mention other conditions in passing; only
    // a rule that says what *being* in the state does is an effect.
    const cat = catalogue(
      [],
      [
        ability(
          'army1',
          'War Cry',
          'At the start of the Command phase, if this unit is on the battlefield, friendly **GREENSKINS** units are **worked up** until the end of the next turn.',
        ),
      ],
    )
    expect(rulesAboutMark(cat, { key: 'worked up', label: 'worked up' }, ['GREENSKINS'], 'ds')).toEqual([])
  })
})

describe('invulnerableFrom', () => {
  it('reads an invulnerable save a state grants', () => {
    expect(invulnerableFrom('That unit has 5+ **InSv**.')).toBe(5)
    expect(invulnerableFrom('This unit has a 4+ invulnerable save.')).toBe(4)
  })

  it('reports nothing when the text grants no save', () => {
    expect(invulnerableFrom('Its ranged attacks have [ASSAULT].')).toBeUndefined()
  })

  it('does not read a normal save as an invulnerable one', () => {
    expect(invulnerableFrom('This unit has a 3+ Save characteristic.')).toBeUndefined()
  })
})
