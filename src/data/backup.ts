/**
 * The full backup (spec §3): everything the owner made on this device in one
 * JSON file — rosters, games, settings, Data Health and reminder overrides,
 * and the mission deck when its cards were edited. Downloaded game data is
 * left out; it comes back from the Data screen.
 *
 * A browser may clear a site's storage when the site is not used for a while,
 * which is how lists were lost once (2026-10). This file is the copy that
 * lives outside the browser.
 */

import { db, getSetting, setSetting, type OverrideRecord, type SettingRecord } from './db'
import { APP_ID } from '@/roster/transfer'
import type { Roster } from '@/roster/types'
import type { Game } from '@/play/types'
import type { MissionDeck } from '@/missions/types'
import type { ReminderOverride } from '@/reminders/types'

export const BACKUP_ENVELOPE_VERSION = 1
export const BACKUP_LAST_KEY = 'backup.last'

export type BackupContents = {
  rosters: Roster[]
  games: Game[]
  settings: SettingRecord[]
  overrides: OverrideRecord[]
  reminderOverrides: ReminderOverride[]
  missions: MissionDeck[]
}

export type BackupEnvelope = {
  app: typeof APP_ID
  kind: 'backup'
  version: number
  exportedAt: number
  contents: BackupContents
}

const COLLECTIONS = ['rosters', 'games', 'settings', 'overrides', 'reminderOverrides', 'missions'] as const

export const emptyContents = (): BackupContents => ({
  rosters: [],
  games: [],
  settings: [],
  overrides: [],
  reminderOverrides: [],
  missions: [],
})

export function makeBackupJson(contents: BackupContents, exportedAt: number): string {
  const envelope: BackupEnvelope = {
    app: APP_ID,
    kind: 'backup',
    version: BACKUP_ENVELOPE_VERSION,
    exportedAt,
    contents,
  }
  return JSON.stringify(envelope)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Parses a backup file; throws with a message fit for the screen when it is not one. */
export function parseBackupEnvelope(text: string): BackupEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    throw new Error('That file is not JSON. Pick a backup saved by this app.')
  }
  if (!isRecord(parsed) || parsed['app'] !== APP_ID)
    throw new Error('That file is not a backup made by this app.')
  if (parsed['kind'] === 'roster')
    throw new Error('That is a single roster. Import it on the Rosters screen.')
  if (parsed['kind'] !== 'backup') throw new Error('That file is not a backup made by this app.')
  if (typeof parsed['version'] !== 'number' || parsed['version'] > BACKUP_ENVELOPE_VERSION)
    throw new Error('That backup was made by a newer version of the app. Update first.')
  const raw = parsed['contents']
  if (!isRecord(raw)) throw new Error('The backup is incomplete.')
  const contents = emptyContents()
  for (const name of COLLECTIONS) {
    const list = raw[name]
    if (list === undefined) continue
    if (!Array.isArray(list) || !list.every(isRecord)) throw new Error('The backup is incomplete.')
    ;(contents as Record<string, unknown[]>)[name] = list
  }
  return {
    app: APP_ID,
    kind: 'backup',
    version: parsed['version'],
    exportedAt: typeof parsed['exportedAt'] === 'number' ? parsed['exportedAt'] : 0,
    contents,
  }
}

export type RestorePlan = {
  write: BackupContents
  /** Rosters and games: new here, newer than the copy here, or left alone. */
  counts: { added: number; updated: number; kept: number }
}

/**
 * What a restore writes. A record comes back when the device lacks it or holds
 * an older copy; nothing newer on the device is overwritten, and settings
 * already chosen here stay as they are.
 */
export function planRestore(backup: BackupContents, local: BackupContents): RestorePlan {
  const counts = { added: 0, updated: 0, kept: 0 }
  const newer = <T>(items: T[], here: T[], key: (t: T) => string, stamp: (t: T) => number, count = false): T[] => {
    const byKey = new Map(here.map((t) => [key(t), t]))
    return items.filter((item) => {
      const current = byKey.get(key(item))
      const take = current === undefined || stamp(item) > stamp(current)
      if (count) counts[current === undefined ? 'added' : take ? 'updated' : 'kept']++
      return take
    })
  }
  const deckStamp = (d: MissionDeck) => d.editedAt ?? d.importedAt
  return {
    write: {
      rosters: newer(backup.rosters, local.rosters, (r) => r.id, (r) => r.updatedAt, true),
      games: newer(backup.games, local.games, (g) => g.id, (g) => g.updatedAt, true),
      settings: newer(backup.settings, local.settings, (s) => s.key, () => 0).filter(
        (s) => s.key !== BACKUP_LAST_KEY,
      ),
      overrides: newer(backup.overrides, local.overrides, (o) => o.key, (o) => o.decidedAt),
      reminderOverrides: newer(backup.reminderOverrides, local.reminderOverrides, (o) => o.id, (o) => o.updatedAt),
      missions: newer(backup.missions, local.missions, (d) => d.id, deckStamp),
    },
    counts,
  }
}

async function readLocal(): Promise<BackupContents> {
  return {
    rosters: await db.rosters.toArray(),
    games: await db.games.toArray(),
    settings: await db.settings.toArray(),
    overrides: await db.overrides.toArray(),
    reminderOverrides: await db.reminderOverrides.toArray(),
    missions: await db.missions.toArray(),
  }
}

export const backupFileName = (at: number) => `wh40k-helper-backup-${new Date(at).toISOString().slice(0, 10)}.json`

/** The backup file's text, and a note that one was made. */
export async function exportBackup(): Promise<{ text: string; at: number; rosters: number }> {
  const local = await readLocal()
  const contents: BackupContents = {
    ...local,
    // An unedited deck is re-imported from the build; only edits are worth keeping.
    missions: local.missions.filter((d) => d.editedAt !== undefined),
  }
  const at = Date.now()
  const text = makeBackupJson(contents, at)
  await setSetting(BACKUP_LAST_KEY, at)
  return { text, at, rosters: contents.rosters.length }
}

export const lastBackupAt = (): Promise<number | null> => getSetting<number | null>(BACKUP_LAST_KEY, null)

export async function restoreBackup(text: string): Promise<RestorePlan['counts']> {
  const envelope = parseBackupEnvelope(text)
  const plan = planRestore(envelope.contents, await readLocal())
  const { write } = plan
  await db.transaction(
    'rw',
    [db.rosters, db.games, db.settings, db.overrides, db.reminderOverrides, db.missions],
    async () => {
      await db.rosters.bulkPut(write.rosters)
      await db.games.bulkPut(write.games)
      await db.settings.bulkPut(write.settings)
      await db.overrides.bulkPut(write.overrides)
      await db.reminderOverrides.bulkPut(write.reminderOverrides)
      await db.missions.bulkPut(write.missions)
    },
  )
  return plan.counts
}
