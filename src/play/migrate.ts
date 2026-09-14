/**
 * Storage migrations for games in progress, kept as plain functions over the
 * stored row so they can be tested without an IndexedDB. `src/data/db.ts` wires
 * them into the Dexie version they belong to.
 */

/**
 * v9: `detachmentName?: string` became `detachmentNames: string[]`, because an
 * 11th-edition army takes as many detachments as its Detachment Points budget
 * allows. A game recorded before this keeps its one detachment, as a list of one.
 */
export function migrateGameToManyDetachments(game: Record<string, unknown>): void {
  const existing = game['detachmentNames']
  if (!Array.isArray(existing)) {
    const old = game['detachmentName']
    game['detachmentNames'] = typeof old === 'string' && old.length > 0 ? [old] : []
  }
  delete game['detachmentName']
}
