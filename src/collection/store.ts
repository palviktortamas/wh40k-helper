/** The collection on the device (IndexedDB, one record per datasheet per faction). */

import { db } from '@/data/db'
import { recordDeletion } from '@/sync/client'
import { collectionId, type CollectionEntry } from './types'

export const getCollection = (catalogueId: string): Promise<CollectionEntry[]> =>
  db.collection.where('catalogueId').equals(catalogueId).toArray()

export function newEntry(
  catalogueId: string,
  entryId: string,
  name: string,
  counts: { bought?: number; planned?: number },
): CollectionEntry {
  return {
    id: collectionId(catalogueId, entryId),
    catalogueId,
    entryId,
    name,
    bought: counts.bought ?? 0,
    assembled: 0,
    painted: 0,
    planned: counts.planned ?? 0,
    updatedAt: Date.now(),
  }
}

/** Saves a row; a row with nothing bought or planned is no longer part of the collection. */
export async function saveEntry(entry: CollectionEntry): Promise<void> {
  if (entry.bought <= 0 && (entry.planned ?? 0) <= 0) {
    await db.collection.delete(entry.id)
    // So a synced device removes the row too (spec §4.4).
    await recordDeletion('collection', entry.id)
  } else await db.collection.put({ ...entry, updatedAt: Date.now() })
}
