/**
 * Sync settings and deletion records (spec §4.4).
 *
 * The owner's own endpoint (URL + passphrase) is kept for what it still does:
 * fetching the mission deck and stratagems through it (Data screen). Syncing
 * between devices goes through the owner's GitHub instead (see gist.ts) —
 * nothing to host. Deletions are recorded here so the other devices delete too.
 */

import { getSetting, setSetting } from '@/data/db'
import type { Tombstone, TombstoneCollection } from './merge'

export const SYNC_URL_KEY = 'sync.url'
export const SYNC_PASSPHRASE_KEY = 'sync.passphrase'
export const TOMBSTONES_KEY = 'sync.tombstones'

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

export const getTombstones = (): Promise<Tombstone[]> => getSetting<Tombstone[]>(TOMBSTONES_KEY, [])

export const saveTombstones = (list: Tombstone[]): Promise<void> => setSetting(TOMBSTONES_KEY, list)

/** Records a local deletion so the other devices delete it too. */
export async function recordDeletion(collection: TombstoneCollection, id: string): Promise<void> {
  const list = await getTombstones()
  await saveTombstones([...list.filter((t) => !(t.collection === collection && t.id === id)), { collection, id, deletedAt: Date.now() }])
}
