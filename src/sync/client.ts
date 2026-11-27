/**
 * Deletion records (spec §4.4). A record deleted here is remembered until the
 * next save tells the server, so the person's other devices delete it too.
 */

import { getSetting, setSetting } from '@/data/db'
import type { Tombstone, TombstoneCollection } from './records'

export const TOMBSTONES_KEY = 'sync.tombstones'

export const getTombstones = (): Promise<Tombstone[]> => getSetting<Tombstone[]>(TOMBSTONES_KEY, [])

export const saveTombstones = (list: Tombstone[]): Promise<void> => setSetting(TOMBSTONES_KEY, list)

/** Records a local deletion so the other devices delete it too. */
export async function recordDeletion(collection: TombstoneCollection, id: string): Promise<void> {
  const list = await getTombstones()
  await saveTombstones([...list.filter((t) => !(t.collection === collection && t.id === id)), { collection, id, deletedAt: Date.now() }])
}
