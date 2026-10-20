/**
 * Persistent storage. Without it a browser treats the site's IndexedDB as
 * "best effort" and may clear it — lists and downloaded data alike — when the
 * site has not been opened for a while or the device runs short of space.
 * Asking once at start is enough: Chrome grants it silently to an installed or
 * often-used app, Firefox asks, Safari decides by its own heuristics.
 */

export type StorageState = {
  /** null when the browser has no Storage API (nothing to ask for). */
  persisted: boolean | null
  usage?: number
  quota?: number
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage?.persist || !storage.persisted) return null
  try {
    if (await storage.persisted()) return true
    return await storage.persist()
  } catch {
    return false
  }
}

export async function storageState(): Promise<StorageState> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage?.persisted) return { persisted: null }
  try {
    const persisted = await storage.persisted()
    const estimate = storage.estimate ? await storage.estimate() : {}
    return {
      persisted,
      ...(estimate.usage !== undefined ? { usage: estimate.usage } : {}),
      ...(estimate.quota !== undefined ? { quota: estimate.quota } : {}),
    }
  } catch {
    return { persisted: null }
  }
}
