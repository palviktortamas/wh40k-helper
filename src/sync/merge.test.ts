import { describe, expect, it } from 'vitest'
import { emptyContents, type BackupContents } from '@/data/backup'
import { mergeForSync, syncableContents, type SyncDoc } from './merge'
import type { Roster } from '@/roster/types'
import type { CollectionEntry } from '@/collection/types'

// Invented records only — no game data.
const roster = (id: string, updatedAt: number) => ({ id, name: id, updatedAt }) as unknown as Roster
const shelf = (id: string, updatedAt: number) => ({ id, entryId: id, bought: 1, updatedAt }) as unknown as CollectionEntry
const contents = (part: Partial<BackupContents>): BackupContents => ({ ...emptyContents(), ...part })
const doc = (part: Partial<BackupContents>, tombstones: SyncDoc['tombstones'] = []): SyncDoc => ({
  contents: contents(part),
  tombstones,
})

describe('merging this device with the copy in the cloud', () => {
  it('takes the newer copy of each record, from either side', () => {
    const here = doc({ rosters: [roster('a', 5), roster('b', 1)] })
    const there = doc({ rosters: [roster('a', 3), roster('b', 9), roster('c', 2)] })
    const { merged, local, counts } = mergeForSync(here, there)
    expect(merged.contents.rosters.map((r) => [r.id, r.updatedAt])).toEqual([
      ['a', 5],
      ['b', 9],
      ['c', 2],
    ])
    // What this device has to write: b (newer there) and c (only there).
    expect(local.put.rosters.map((r) => r.id)).toEqual(['b', 'c'])
    expect(counts).toEqual({ received: 2, sent: 1, removed: 0 })
  })

  it('starts the cloud copy from this device when there is none yet', () => {
    const { merged, local, counts } = mergeForSync(doc({ collection: [shelf('x', 1)] }), undefined)
    expect(merged.contents.collection.map((e) => e.id)).toEqual(['x'])
    expect(local.put.collection).toEqual([])
    expect(counts.sent).toBe(1)
  })

  // A unit removed on the PC must not come back from the phone's older copy.
  it('honours a deletion made after the record was last changed', () => {
    const here = doc({ rosters: [roster('a', 5)] })
    const there = doc({}, [{ collection: 'rosters', id: 'a', deletedAt: 8 }])
    const { merged, local, counts } = mergeForSync(here, there)
    expect(merged.contents.rosters).toEqual([])
    expect(local.remove.rosters).toEqual(['a'])
    expect(merged.tombstones).toEqual([{ collection: 'rosters', id: 'a', deletedAt: 8 }])
    expect(counts.removed).toBe(1)
  })

  it('counts a deletion made here as sent', () => {
    const here = doc({}, [{ collection: 'collection', id: 'x', deletedAt: 4 }])
    const there = doc({ collection: [shelf('x', 1)] })
    expect(mergeForSync(here, there).counts).toEqual({ received: 0, sent: 1, removed: 0 })
    // Once the cloud has it, it is not news any more.
    expect(mergeForSync(here, doc({}, here.tombstones)).counts.sent).toBe(0)
  })

  it('keeps a record edited after it was deleted elsewhere', () => {
    const here = doc({ collection: [shelf('x', 9)] })
    const there = doc({}, [{ collection: 'collection', id: 'x', deletedAt: 4 }])
    const { merged, local } = mergeForSync(here, there)
    expect(merged.contents.collection.map((e) => e.id)).toEqual(['x'])
    expect(local.remove.collection).toEqual([])
  })

  it('adds settings this device lacks and keeps the ones chosen here', () => {
    const here = doc({ settings: [{ key: 'theme', value: 'dark' }] })
    const there = doc({ settings: [{ key: 'theme', value: 'light' }, { key: 'reminders.x', value: 1 }] })
    const { merged, local } = mergeForSync(here, there)
    expect(local.put.settings).toEqual([{ key: 'reminders.x', value: 1 }])
    expect(merged.contents.settings).toEqual([
      { key: 'theme', value: 'dark' },
      { key: 'reminders.x', value: 1 },
    ])
  })
})

describe('what leaves the device', () => {
  // The token that opens the owner's gist must never be written into the gist.
  it('leaves out the sync credentials and bookkeeping, and unedited mission decks', () => {
    const out = syncableContents(
      contents({
        settings: [
          { key: 'sync.githubToken', value: 'secret' },
          { key: 'sync.tombstones', value: [] },
          { key: 'backup.last', value: 1 },
          { key: 'theme', value: 'dark' },
        ],
        missions: [
          { id: 'plain', importedAt: 1 } as never,
          { id: 'edited', importedAt: 1, editedAt: 2 } as never,
        ],
      }),
    )
    expect(out.settings).toEqual([{ key: 'theme', value: 'dark' }])
    expect(out.missions.map((d) => d.id)).toEqual(['edited'])
  })
})
