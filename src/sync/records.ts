/**
 * Records as they travel to and from the owner's server (spec §4.4). Each kind
 * of record is told apart by its own key and dated by its own stamp; the newer
 * copy wins and a deletion wins over any copy older than it. Pure, so it is
 * tested without a network or a database.
 */

import { emptyContents, type BackupContents } from '@/data/backup'
import { isDeviceSetting, type SettingRecord } from '@/data/db'

export type SyncCollection = keyof BackupContents

/** Kinds a deletion can name. Settings, overrides and mission decks are only ever replaced. */
export type TombstoneCollection = 'rosters' | 'games' | 'collection' | 'reminderOverrides'

export type Tombstone = { collection: TombstoneCollection; id: string; deletedAt: number }

export type WireItem = { collection: SyncCollection; id: string; updatedAt: number; deleted?: true; data?: unknown }

type Recordish = Record<string, unknown>

const KINDS: { [K in SyncCollection]: { key: (r: Recordish) => string; at: (r: Recordish) => number } } = {
  rosters: { key: (r) => String(r['id']), at: (r) => Number(r['updatedAt'] ?? 0) },
  games: { key: (r) => String(r['id']), at: (r) => Number(r['updatedAt'] ?? 0) },
  collection: { key: (r) => String(r['id']), at: (r) => Number(r['updatedAt'] ?? 0) },
  reminderOverrides: { key: (r) => String(r['id']), at: (r) => Number(r['updatedAt'] ?? 0) },
  overrides: { key: (r) => String(r['key']), at: (r) => Number(r['decidedAt'] ?? 0) },
  missions: { key: (r) => String(r['id']), at: (r) => Number(r['editedAt'] ?? r['importedAt'] ?? 0) },
  // Settings saved before they were dated count as oldest.
  settings: { key: (r) => String(r['key']), at: (r) => Number(r['updatedAt'] ?? 0) },
}

const isKind = (name: string): name is SyncCollection => name in KINDS

/** Settings that belong to this device alone (see `isDeviceSetting`). */
export const deviceOnly = isDeviceSetting

/** Whether a record may leave the device at all. */
function travels(name: SyncCollection, record: Recordish): boolean {
  if (name === 'settings') return !deviceOnly(String((record as SettingRecord).key))
  // An unedited mission deck is the shipped one; every device has it already.
  if (name === 'missions') return record['editedAt'] !== undefined
  return true
}

/** Everything changed on this device after `since` (its clock), deletions included. */
export function localChanges(local: BackupContents, tombstones: readonly Tombstone[], since: number): WireItem[] {
  const out: WireItem[] = []
  for (const name of Object.keys(KINDS) as SyncCollection[]) {
    const { key, at } = KINDS[name]
    for (const record of local[name] as unknown as Recordish[]) {
      if (!travels(name, record) || at(record) <= since) continue
      out.push({ collection: name, id: key(record), updatedAt: at(record), data: record })
    }
  }
  for (const t of tombstones)
    if (t.deletedAt > since) out.push({ collection: t.collection, id: t.id, updatedAt: t.deletedAt, deleted: true })
  return out
}

export type ApplyPlan = {
  put: BackupContents
  remove: { [K in SyncCollection]: string[] }
  /** How many records this device takes in. */
  count: number
}

/** What to write and delete here for what the server sent: only what is newer than this device's copy. */
export function planApply(items: readonly WireItem[], local: BackupContents): ApplyPlan {
  const put = emptyContents()
  const remove = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []])) as unknown as ApplyPlan['remove']
  const here = new Map<string, number>()
  for (const name of Object.keys(KINDS) as SyncCollection[])
    for (const r of local[name] as unknown as Recordish[]) here.set(`${name}:${KINDS[name].key(r)}`, KINDS[name].at(r))
  let count = 0
  for (const item of items) {
    if (!isKind(item.collection)) continue
    if (item.collection === 'settings' && deviceOnly(item.id)) continue
    const mine = here.get(`${item.collection}:${item.id}`)
    if (item.deleted) {
      if (mine !== undefined && mine <= item.updatedAt) {
        remove[item.collection].push(item.id)
        count++
      }
      continue
    }
    if (mine !== undefined && mine >= item.updatedAt) continue
    ;(put[item.collection] as unknown[]).push(item.data)
    count++
  }
  return { put, remove, count }
}
