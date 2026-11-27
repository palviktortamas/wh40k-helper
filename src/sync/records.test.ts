import { describe, expect, it } from 'vitest'
import { emptyContents, type BackupContents } from '@/data/backup'
import { localChanges, planApply } from './records'
import type { Roster } from '@/roster/types'

// Invented records only — no game data.
const roster = (id: string, updatedAt: number) => ({ id, name: id, updatedAt }) as unknown as Roster
const contents = (part: Partial<BackupContents>): BackupContents => ({ ...emptyContents(), ...part })

describe('what this device sends', () => {
  it('sends what changed since the last save, and deletions made since', () => {
    const local = contents({
      rosters: [roster('old', 5), roster('new', 20)],
      settings: [{ key: 'theme', value: 'dark', updatedAt: 30 }],
    })
    const items = localChanges(local, [{ collection: 'rosters', id: 'gone', deletedAt: 25 }], 10)
    expect(items).toEqual([
      { collection: 'rosters', id: 'new', updatedAt: 20, data: local.rosters[1] },
      { collection: 'settings', id: 'theme', updatedAt: 30, data: { key: 'theme', value: 'dark', updatedAt: 30 } },
      { collection: 'rosters', id: 'gone', updatedAt: 25, deleted: true },
    ])
  })

  it('sends everything the first time, settings saved before they were dated included', () => {
    const items = localChanges(contents({ settings: [{ key: 'theme', value: 'dark' }] }), [], -1)
    expect(items.map((i) => i.id)).toEqual(['theme'])
  })

  // The session must never leave the device, nor this device's sync bookkeeping.
  it('never sends the session, the sync state or an unedited mission deck', () => {
    const items = localChanges(
      contents({
        settings: [
          { key: 'auth.session', value: { token: 't' } },
          { key: 'sync.cursor', value: 3 },
          { key: 'backup.last', value: 1 },
        ],
        missions: [{ id: 'deck', importedAt: 5 } as never],
      }),
      [],
      -1,
    )
    expect(items).toEqual([])
  })
})

describe('what arrives from the server', () => {
  it('writes a newer or new copy and leaves a newer local one alone', () => {
    const local = contents({ rosters: [roster('a', 10), roster('b', 10)] })
    const plan = planApply(
      [
        { collection: 'rosters', id: 'a', updatedAt: 20, data: roster('a', 20) },
        { collection: 'rosters', id: 'b', updatedAt: 5, data: roster('b', 5) },
        { collection: 'rosters', id: 'c', updatedAt: 1, data: roster('c', 1) },
      ],
      local,
    )
    expect(plan.put.rosters.map((r) => r.id)).toEqual(['a', 'c'])
    expect(plan.count).toBe(2)
  })

  it('deletes what was deleted elsewhere after this copy was last changed', () => {
    const local = contents({ rosters: [roster('a', 10), roster('b', 30)] })
    const plan = planApply(
      [
        { collection: 'rosters', id: 'a', updatedAt: 20, deleted: true },
        { collection: 'rosters', id: 'b', updatedAt: 20, deleted: true },
        { collection: 'rosters', id: 'z', updatedAt: 20, deleted: true },
      ],
      local,
    )
    expect(plan.remove.rosters).toEqual(['a'])
  })

  it('ignores kinds it does not know and device-only settings', () => {
    const plan = planApply(
      [
        { collection: 'nonsense' as never, id: 'x', updatedAt: 1, data: {} },
        { collection: 'settings', id: 'auth.session', updatedAt: 1, data: { key: 'auth.session', value: 'x' } },
      ],
      contents({}),
    )
    expect(plan.count).toBe(0)
  })
})
