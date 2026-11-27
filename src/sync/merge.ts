/**
 * Merging this device with the copy kept in the cloud (spec §4.4). One person,
 * several devices: each record keeps whichever copy was changed last, a
 * deletion wins over any copy older than it, and settings already chosen on a
 * device stay as they are there. Pure, so it is tested without a network.
 */

import type { BackupContents } from '@/data/backup'
import { emptyContents } from '@/data/backup'
import type { SettingRecord } from '@/data/db'

/** Which records a deletion can name; the others are never deleted one by one. */
export type TombstoneCollection = 'rosters' | 'games' | 'collection'

export type Tombstone = { collection: TombstoneCollection; id: string; deletedAt: number }

/** What the cloud holds: everything the backup holds, and the deletions. */
export type SyncDoc = { contents: BackupContents; tombstones: Tombstone[] }

type Stamped = Exclude<keyof BackupContents, 'settings'>

/** How each kind of record is told apart and dated. */
const STAMPED: { [K in Stamped]: { key: (r: BackupContents[K][number]) => string; at: (r: BackupContents[K][number]) => number } } = {
  rosters: { key: (r) => r.id, at: (r) => r.updatedAt },
  games: { key: (g) => g.id, at: (g) => g.updatedAt },
  collection: { key: (e) => e.id, at: (e) => e.updatedAt },
  reminderOverrides: { key: (o) => o.id, at: (o) => o.updatedAt },
  overrides: { key: (o) => o.key, at: (o) => o.decidedAt },
  missions: { key: (d) => d.id, at: (d) => d.editedAt ?? d.importedAt },
}

/** Settings that belong to one device: the sync credentials and bookkeeping, the last backup date. */
const deviceOnly = (s: SettingRecord) => s.key.startsWith('sync.') || s.key === 'backup.last'

/** What may leave the device: never the token, and a mission deck only when its cards were edited. */
export function syncableContents(contents: BackupContents): BackupContents {
  return {
    ...contents,
    settings: contents.settings.filter((s) => !deviceOnly(s)),
    missions: contents.missions.filter((d) => d.editedAt !== undefined),
  }
}

export type LocalChanges = {
  put: BackupContents
  remove: { [K in TombstoneCollection]: string[] }
}

export type SyncCounts = {
  /** Records written here because the other copy was newer or new. */
  received: number
  /** Records the cloud gets from here because this copy was newer or new. */
  sent: number
  /** Records deleted here because another device deleted them. */
  removed: number
}

export function mergeForSync(
  here: SyncDoc,
  there: SyncDoc | undefined,
): { merged: SyncDoc; local: LocalChanges; counts: SyncCounts } {
  const remote = there ?? { contents: emptyContents(), tombstones: [] }
  const counts: SyncCounts = { received: 0, sent: 0, removed: 0 }

  // Deletions from both sides; the latest one for a record stands.
  const tombs = new Map<string, Tombstone>()
  for (const t of [...here.tombstones, ...remote.tombstones]) {
    const k = `${t.collection}:${t.id}`
    const seen = tombs.get(k)
    if (!seen || t.deletedAt > seen.deletedAt) tombs.set(k, t)
  }
  const deletedAt = (collection: string, id: string) => tombs.get(`${collection}:${id}`)?.deletedAt
  // A deletion made here that the cloud has not heard of yet is news it gets from here.
  const known = new Map(remote.tombstones.map((t) => [`${t.collection}:${t.id}`, t.deletedAt]))
  counts.sent += here.tombstones.filter((t) => (known.get(`${t.collection}:${t.id}`) ?? -1) < t.deletedAt).length

  const merged = emptyContents()
  const put = emptyContents()
  const remove: LocalChanges['remove'] = { rosters: [], games: [], collection: [] }

  for (const name of Object.keys(STAMPED) as Stamped[]) {
    const { key, at } = STAMPED[name] as { key: (r: unknown) => string; at: (r: unknown) => number }
    const mine = new Map((here.contents[name] as unknown[]).map((r) => [key(r), r]))
    const theirs = new Map((remote.contents[name] as unknown[]).map((r) => [key(r), r]))
    const out: unknown[] = []
    for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
      const a = mine.get(id)
      const b = theirs.get(id)
      const newest = a === undefined ? b! : b === undefined ? a : at(b) > at(a) ? b : a
      const gone = deletedAt(name, id)
      if (gone !== undefined && gone >= at(newest)) {
        if (a !== undefined && name in remove) {
          remove[name as TombstoneCollection].push(id)
          counts.removed++
        }
        continue
      }
      out.push(newest)
      if (newest !== a) {
        ;(put[name] as unknown[]).push(newest)
        counts.received++
      } else if (b === undefined || at(a!) > at(b)) counts.sent++
    }
    ;(merged[name] as unknown[]) = out
  }

  // Settings carry no date: the device's own choice stands, missing ones arrive.
  const mySettings = new Set(here.contents.settings.map((s) => s.key))
  const arriving = remote.contents.settings.filter((s) => !mySettings.has(s.key) && !deviceOnly(s))
  put.settings = arriving
  counts.received += arriving.length
  merged.settings = [...here.contents.settings.filter((s) => !deviceOnly(s)), ...arriving]

  return { merged: { contents: merged, tombstones: [...tombs.values()] }, local: { put, remove }, counts }
}
