import { describe, expect, it } from 'vitest'
import { adoptRoster, exportRosterJson, parseRosterEnvelope } from './transfer'
import type { Roster } from './types'

const roster: Roster = {
  id: 'r1',
  name: 'Test',
  catalogueId: 'cat',
  pointsLimit: 2000,
  configuration: [],
  selections: [{ id: 's1', entryId: 'e1', name: 'Unit', type: 'unit', count: 1, selections: [] }],
  createdAt: 1,
  updatedAt: 2,
  builtWith: { bsdataRevision: 3 },
}

describe('roster transfer', () => {
  it('round-trips a roster through the envelope', () => {
    const text = exportRosterJson(roster, 'Faction')
    const envelope = parseRosterEnvelope(text)
    expect(envelope.catalogueName).toBe('Faction')
    expect(envelope.roster).toEqual(roster)
  })

  it('rejects things that are not rosters, with a readable message', () => {
    expect(() => parseRosterEnvelope('hello')).toThrow(/not JSON/)
    expect(() => parseRosterEnvelope('{"app":"other"}')).toThrow(/not a roster/)
    expect(() => parseRosterEnvelope(JSON.stringify({ app: 'wh40k-helper', kind: 'roster', version: 99, roster }))).toThrow(/newer version/)
    expect(() => parseRosterEnvelope(JSON.stringify({ app: 'wh40k-helper', kind: 'roster', version: 1, roster: { id: 'x' } }))).toThrow(/incomplete/)
  })

  it('adopts an imported roster with a fresh id and a non-colliding name', () => {
    const adopted = adoptRoster(roster, ['Test', 'Test (2)'])
    expect(adopted.id).not.toBe(roster.id)
    expect(adopted.name).toBe('Test (3)')
    expect(adopted.catalogueId).toBe('cat')
    expect(adopted.selections).toEqual(roster.selections)
  })
})
