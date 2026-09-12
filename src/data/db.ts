import Dexie, { type EntityTable } from 'dexie'

/**
 * All app state lives in IndexedDB — localStorage is never used for primary
 * data. Stores are added per phase; each addition gets its own Dexie version
 * so existing rosters survive an app update.
 */
export type SettingRecord = {
  key: string
  value: unknown
}

const db = new Dexie('wh40k-helper') as Dexie & {
  settings: EntityTable<SettingRecord, 'key'>
}

db.version(1).stores({
  settings: 'key',
})

export { db }

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
