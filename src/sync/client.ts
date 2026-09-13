/**
 * Sync with the owner's own endpoint (spec §4.4). One request per collection:
 * the client sends everything it has (records and tombstones), the Worker
 * merges by `updatedAt` and returns the merged set, and the client applies
 * whatever is newer than its own copy. Nothing runs in the background.
 */

import { db, getSetting, setSetting } from '@/data/db'
import type { Roster } from '@/roster/types'
import type { Game } from '@/play/types'

export const SYNC_URL_KEY = 'sync.url'
export const SYNC_PASSPHRASE_KEY = 'sync.passphrase'
export const SYNC_LAST_KEY = 'sync.last'
const TOMBSTONES_KEY = 'sync.tombstones'

export type SyncItem<T> = {
  id: string
  updatedAt: number
  /** A deletion: the record is gone and `updatedAt` is when it went. */
  deleted?: boolean
  data?: T
}

export type Tombstone = { collection: 'rosters' | 'games'; id: string; deletedAt: number }

export type SyncSummary = {
  at: number
  /** Records sent up (the endpoint keeps whichever copy is newer). */
  pushed: number
  /** Records that arrived here because the other device's copy was newer. */
  pulled: number
  /** Records deleted here because the other device deleted them. */
  removed: number
}

export type SyncConfig = { url: string; passphrase: string }

export async function getSyncConfig(): Promise<SyncConfig> {
  return {
    url: (await getSetting<string>(SYNC_URL_KEY, '')).trim().replace(/\/+$/, ''),
    passphrase: await getSetting<string>(SYNC_PASSPHRASE_KEY, ''),
  }
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await setSetting(SYNC_URL_KEY, config.url.trim().replace(/\/+$/, ''))
  await setSetting(SYNC_PASSPHRASE_KEY, config.passphrase)
}

/** Records a local deletion so the other device deletes too. */
export async function recordDeletion(collection: Tombstone['collection'], id: string): Promise<void> {
  const list = await getSetting<Tombstone[]>(TOMBSTONES_KEY, [])
  await setSetting(TOMBSTONES_KEY, [...list.filter((t) => t.id !== id), { collection, id, deletedAt: Date.now() }])
}

async function exchange<T>(config: SyncConfig, collection: string, items: SyncItem<T>[]): Promise<SyncItem<T>[]> {
  let response: Response
  try {
    response = await fetch(`${config.url}/sync/${collection}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.passphrase}`,
      },
      body: JSON.stringify({ items }),
    })
  } catch {
    throw new Error('Could not reach the endpoint — offline, or the URL is wrong.')
  }
  if (response.status === 401) throw new Error('The endpoint rejected the passphrase.')
  if (!response.ok) throw new Error(`The endpoint answered ${response.status}.`)
  const body = (await response.json()) as { items?: SyncItem<T>[] }
  if (!Array.isArray(body.items)) throw new Error('The endpoint sent an unexpected reply.')
  return body.items
}

type Stamped = { id: string; updatedAt: number }

/**
 * Merges one collection. Returns how many local records went up, came down,
 * and were removed because the other device deleted them.
 */
async function syncCollection<T extends Stamped>(
  config: SyncConfig,
  collection: Tombstone['collection'],
  local: T[],
  put: (record: T) => Promise<unknown>,
  remove: (id: string) => Promise<unknown>,
): Promise<Omit<SyncSummary, 'at'>> {
  const tombstones = (await getSetting<Tombstone[]>(TOMBSTONES_KEY, [])).filter(
    (t) => t.collection === collection,
  )
  const items: SyncItem<T>[] = [
    ...local.map((record) => ({ id: record.id, updatedAt: record.updatedAt, data: record })),
    ...tombstones.map((t) => ({ id: t.id, updatedAt: t.deletedAt, deleted: true })),
  ]
  const merged = await exchange(config, collection, items)

  const byId = new Map(local.map((r) => [r.id, r]))
  let pulled = 0
  let removed = 0
  for (const item of merged) {
    const mine = byId.get(item.id)
    if (item.deleted) {
      if (mine && item.updatedAt > mine.updatedAt) {
        await remove(item.id)
        removed++
      }
      continue
    }
    if (!item.data) continue
    if (!mine) {
      await put(item.data)
      pulled++
    } else if (item.updatedAt > mine.updatedAt) {
      await put(item.data)
      pulled++
    }
  }
  return { pushed: local.length, pulled, removed }
}

/** Uploads what is newer here, downloads what is newer there. */
export async function syncAll(config: SyncConfig): Promise<SyncSummary> {
  if (!config.url || !config.passphrase) throw new Error('Set the endpoint URL and passphrase first.')
  const rosters = await syncCollection<Roster>(
    config,
    'rosters',
    await db.rosters.toArray(),
    (r) => db.rosters.put(r),
    (id) => db.rosters.delete(id),
  )
  const games = await syncCollection<Game>(
    config,
    'games',
    await db.games.toArray(),
    (g) => db.games.put(g),
    (id) => db.games.delete(id),
  )
  const summary: SyncSummary = {
    at: Date.now(),
    pushed: rosters.pushed + games.pushed,
    pulled: rosters.pulled + games.pulled,
    removed: rosters.removed + games.removed,
  }
  await setSetting(SYNC_LAST_KEY, summary)
  return summary
}
