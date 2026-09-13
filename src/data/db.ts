import Dexie, { type EntityTable } from 'dexie'
import type { ParsedCatalogue } from './model'
import type { Discrepancy, Unmatched } from './link/merge'
import type { Roster } from '@/roster/types'

/**
 * All app state lives in IndexedDB — localStorage is never used for primary
 * data. Stores are added per phase; each addition gets its own Dexie version so
 * existing rosters survive an app update.
 */

export type SettingRecord = {
  key: string
  value: unknown
}

/**
 * An installed faction. The parsed model is what the UI reads; the raw payloads
 * are kept so a later app version can re-parse without going back to the
 * network (spec §4.2) — and so the app stays usable offline after an upgrade.
 */
export type CatalogueRecord = {
  id: string
  name: string
  slug?: string
  revision: number
  installedAt: number
  parsed: ParsedCatalogue
  /** Source file text, kept verbatim for re-parsing. */
  raw: { catalogue: string; gameSystem: string; mfm?: string }
  versions: { bsdataRevision: number; mfmVersion?: string }
}

/** Cross-source check results, per spec §4.1's Data Health screen. */
export type HealthRecord = {
  catalogueId: string
  checkedAt: number
  discrepancies: Discrepancy[]
  unmatched: Unmatched[]
  matchedDatasheets: number
  matchedDetachments: number
}

/**
 * A user's decision about one discrepancy. Keyed by the discrepancy key so it
 * survives data updates, and included in the backup export.
 */
export type OverrideRecord = {
  key: string
  value: string
  note?: string
  decidedAt: number
}

const db = new Dexie('wh40k-helper') as Dexie & {
  settings: EntityTable<SettingRecord, 'key'>
  catalogues: EntityTable<CatalogueRecord, 'id'>
  health: EntityTable<HealthRecord, 'catalogueId'>
  overrides: EntityTable<OverrideRecord, 'key'>
  rosters: EntityTable<Roster, 'id'>
}

db.version(1).stores({
  settings: 'key',
})

db.version(2).stores({
  settings: 'key',
  catalogues: 'id, name',
  health: 'catalogueId',
  overrides: 'key',
})

db.version(3).stores({
  settings: 'key',
  catalogues: 'id, name',
  health: 'catalogueId',
  overrides: 'key',
  rosters: 'id, catalogueId, updatedAt',
})

/**
 * v4: roster configuration (battle size, detachment, force disposition) became
 * real selections, and the Warlord became the data's own upgrade selection.
 * The old `detachmentId` / `warlordSelectionId` fields are parked as `pending*`
 * so `normaliseRoster` can convert them once it has the catalogue graph, which
 * a storage migration does not.
 */
db.version(4)
  .stores({
    settings: 'key',
    catalogues: 'id, name',
    health: 'catalogueId',
    overrides: 'key',
    rosters: 'id, catalogueId, updatedAt',
  })
  .upgrade((tx) =>
    tx
      .table('rosters')
      .toCollection()
      .modify((roster: Record<string, unknown>) => {
        if (!Array.isArray(roster['configuration'])) roster['configuration'] = []
        if (typeof roster['detachmentId'] === 'string') {
          roster['pendingDetachmentId'] = roster['detachmentId']
        }
        if (typeof roster['warlordSelectionId'] === 'string') {
          roster['pendingWarlordSelectionId'] = roster['warlordSelectionId']
        }
        delete roster['detachmentId']
        delete roster['warlordSelectionId']
      }),
  )

export { db }

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
