import { describe, expect, it } from 'vitest'
import { emptyContents, makeBackupJson, parseBackupEnvelope, planRestore, type BackupContents } from './backup'
import type { Roster } from '@/roster/types'
import type { Game } from '@/play/types'
import type { MissionDeck } from '@/missions/types'

const roster = (id: string, updatedAt: number): Roster => ({
  id,
  name: `List ${id}`,
  catalogueId: 'cat',
  pointsLimit: 2000,
  configuration: [],
  selections: [],
  createdAt: 1,
  updatedAt,
  builtWith: { bsdataRevision: 1 },
})

const game = (id: string, updatedAt: number) => ({ id, updatedAt }) as unknown as Game

const deck = (importedAt: number, editedAt?: number) =>
  ({ id: 'deck', importedAt, ...(editedAt ? { editedAt } : {}) }) as unknown as MissionDeck

const contents = (part: Partial<BackupContents>): BackupContents => ({ ...emptyContents(), ...part })

describe('backup', () => {
  it('round-trips everything the owner made through one JSON file', () => {
    const original = contents({
      rosters: [roster('r1', 5)],
      games: [game('g1', 6)],
      settings: [{ key: 'theme', value: 'dark' }],
      overrides: [{ key: 'k', value: 'v', decidedAt: 3 }],
      reminderOverrides: [{ id: 'rule', enabled: false, updatedAt: 4 }],
    })
    const envelope = parseBackupEnvelope(makeBackupJson(original, 100))
    expect(envelope.kind).toBe('backup')
    expect(envelope.exportedAt).toBe(100)
    expect(envelope.contents).toEqual(original)
  })

  it('rejects files that are not backups, with a readable message', () => {
    expect(() => parseBackupEnvelope('hello')).toThrow(/not JSON/)
    expect(() => parseBackupEnvelope('{"app":"other"}')).toThrow(/not a backup/)
    expect(() =>
      parseBackupEnvelope(JSON.stringify({ app: 'wh40k-helper', kind: 'roster', version: 1, roster: {} })),
    ).toThrow(/single roster/)
    expect(() =>
      parseBackupEnvelope(JSON.stringify({ app: 'wh40k-helper', kind: 'backup', version: 99, contents: {} })),
    ).toThrow(/newer version/)
    expect(() =>
      parseBackupEnvelope(JSON.stringify({ app: 'wh40k-helper', kind: 'backup', version: 1, contents: { rosters: 3 } })),
    ).toThrow(/incomplete/)
  })

  it('accepts a backup that lacks a collection a later version added', () => {
    const text = JSON.stringify({ app: 'wh40k-helper', kind: 'backup', version: 1, exportedAt: 1, contents: { rosters: [roster('r1', 1)] } })
    expect(parseBackupEnvelope(text).contents.games).toEqual([])
  })

  it('restores what is missing and never overwrites a newer copy on the device', () => {
    const backup = contents({
      rosters: [roster('gone', 5), roster('older', 5), roster('newer', 9)],
      games: [game('g', 2)],
    })
    const local = contents({ rosters: [roster('older', 7), roster('newer', 3)], games: [game('g', 2)] })
    const plan = planRestore(backup, local)
    expect(plan.write.rosters.map((r) => r.id)).toEqual(['gone', 'newer'])
    expect(plan.write.games).toEqual([])
    expect(plan.counts).toEqual({ added: 1, updated: 1, kept: 2 })
  })

  it('keeps the settings already chosen on this device', () => {
    const backup = contents({ settings: [{ key: 'theme', value: 'light' }, { key: 'sync.url', value: 'x' }] })
    const local = contents({ settings: [{ key: 'theme', value: 'dark' }] })
    expect(planRestore(backup, local).write.settings).toEqual([{ key: 'sync.url', value: 'x' }])
  })

  it('restores an edited mission deck only when it is newer than the one here', () => {
    const edited = contents({ missions: [deck(1, 50)] })
    expect(planRestore(edited, contents({ missions: [deck(10)] })).write.missions).toHaveLength(1)
    expect(planRestore(edited, contents({ missions: [deck(60)] })).write.missions).toHaveLength(0)
  })
})
