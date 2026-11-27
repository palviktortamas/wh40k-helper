/**
 * Automatic saving to the owner's server (spec §4.4, owner's decision
 * 2026-11-27: "easier to save"). Every change to what a person made — a list,
 * a game, a collection row, a setting — is sent a moment after it happens,
 * whatever changed elsewhere comes back, and nothing is lost offline: changes
 * wait on the device and go up when the connection returns.
 */

import { db, getSetting, setSetting } from '@/data/db'
import { readLocalContents } from '@/data/backup'
import { getTombstones, saveTombstones } from './client'
import { localChanges, planApply, deviceOnly, type WireItem } from './records'
import { api, endSession, getSession, LAST_USER_KEY, OfflineError, ServerError, SESSION_CHANGED } from './server'

const CURSOR_KEY = 'sync.cursor'
const PUSHED_KEY = 'sync.pushedAt'
const BATCH = 500
const DELAY_MS = 2000

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error' | 'loggedOut'

/** Fired on `window` when records arrived from elsewhere, so open screens reload. */
export const SYNCED = 'wh40k:synced'
/** Fired on `window` with every change of save state (see `saveState`). */
export const SAVE_STATE = 'wh40k:save-state'

let state: SaveState = 'idle'
let lastError = ''
export const saveState = (): { state: SaveState; error: string } => ({ state, error: lastError })
function setState(next: SaveState, error = '') {
  state = next
  lastError = error
  window.dispatchEvent(new Event(SAVE_STATE))
}

/** True while records from the server are being written, so those writes do not echo back. */
let applying = false
let running: Promise<void> | null = null
let rerun = false
let timer: ReturnType<typeof setTimeout> | undefined

type Page = { items: WireItem[]; cursor: number; more: boolean }

async function apply(items: WireItem[]): Promise<number> {
  if (items.length === 0) return 0
  const plan = planApply(items, await readLocalContents())
  if (plan.count === 0) return 0
  applying = true
  try {
    await db.transaction(
      'rw',
      [db.rosters, db.games, db.settings, db.overrides, db.reminderOverrides, db.missions, db.collection],
      async () => {
        await db.rosters.bulkPut(plan.put.rosters)
        await db.games.bulkPut(plan.put.games)
        await db.settings.bulkPut(plan.put.settings)
        await db.overrides.bulkPut(plan.put.overrides)
        await db.reminderOverrides.bulkPut(plan.put.reminderOverrides)
        await db.missions.bulkPut(plan.put.missions)
        await db.collection.bulkPut(plan.put.collection)
        await db.rosters.bulkDelete(plan.remove.rosters)
        await db.games.bulkDelete(plan.remove.games)
        await db.collection.bulkDelete(plan.remove.collection)
        await db.reminderOverrides.bulkDelete(plan.remove.reminderOverrides)
      },
    )
  } finally {
    applying = false
  }
  return plan.count
}

async function runOnce(): Promise<void> {
  const session = await getSession()
  if (!session) return setState('loggedOut')
  setState('saving')
  // Anything changed after this moment goes up next time.
  const startedAt = Date.now()
  const since = await getSetting<number>(PUSHED_KEY, -1)
  let cursor = await getSetting<number>(CURSOR_KEY, 0)
  const tombstones = await getTombstones()
  const outgoing = localChanges(await readLocalContents(), tombstones, since)

  let received = 0
  let sent = 0
  let more = true
  while (sent < outgoing.length || more) {
    const items = outgoing.slice(sent, sent + BATCH)
    sent += items.length
    const page = await api<Page>('/sync', { json: { cursor, items }, token: session.token })
    received += await apply(page.items)
    cursor = page.cursor
    more = page.more
  }
  await setSetting(CURSOR_KEY, cursor)
  await setSetting(PUSHED_KEY, startedAt)
  // The server has every deletion made before this run; the device need not keep them.
  await saveTombstones((await getTombstones()).filter((t) => t.deletedAt >= startedAt))
  if (received > 0) window.dispatchEvent(new Event(SYNCED))
  setState('saved')
}

/** Saves now (or right after the run in progress). Resolves when this device is up to date or cannot be. */
export function saveNow(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    try {
      do {
        rerun = false
        await runOnce()
      } while (rerun)
    } catch (e) {
      if (e instanceof OfflineError) setState('offline')
      else if (e instanceof ServerError && e.status === 401) {
        await endSession()
        setState('loggedOut')
      } else setState('error', e instanceof Error ? e.message : String(e))
    } finally {
      running = null
    }
  })()
  return running
}

/** A change was made here: save shortly, once the burst of writes is over. */
export function scheduleSave(): void {
  if (applying) return
  clearTimeout(timer)
  timer = setTimeout(() => void saveNow(), DELAY_MS)
}

let started = false

/** Watches every table that holds what people make, and saves on start and when back online. */
export function startAutoSave(): void {
  if (started) return
  started = true
  for (const table of [db.rosters, db.games, db.overrides, db.reminderOverrides, db.missions, db.collection]) {
    table.hook('creating', () => scheduleSave())
    table.hook('updating', () => scheduleSave())
    table.hook('deleting', () => scheduleSave())
  }
  // The sync's own bookkeeping lives in settings too; only real settings count as changes.
  const setting = (key: unknown) => {
    if (typeof key === 'string' && !deviceOnly(key)) scheduleSave()
  }
  db.settings.hook('creating', (key) => setting(key))
  db.settings.hook('updating', (_mods, key) => setting(key))
  db.settings.hook('deleting', (key) => setting(key))
  window.addEventListener('online', () => void saveNow())
  window.addEventListener(SESSION_CHANGED, () => void saveNow())
  void saveNow()
}

const USER_TABLES = [db.rosters, db.games, db.collection, db.overrides, db.reminderOverrides] as const

/** Clears what one person made from this device (their copy is on the server). */
async function clearPersonalData(): Promise<void> {
  applying = true
  try {
    await db.transaction('rw', [...USER_TABLES, db.missions, db.settings], async () => {
      for (const table of USER_TABLES) await table.clear()
      await db.missions.filter((d) => d.editedAt !== undefined).delete()
      await db.settings.filter((s) => !deviceOnly(s.key) || s.key.startsWith('sync.')).delete()
    })
  } finally {
    applying = false
  }
}

/**
 * Called after a log-in: a device that last held someone else's things starts
 * clean, so one account's lists never end up in another's.
 */
export async function adoptAccount(username: string): Promise<void> {
  const last = await getSetting<string | null>(LAST_USER_KEY, null)
  if (last !== null && last.toLowerCase() !== username.toLowerCase()) await clearPersonalData()
  await setSetting(LAST_USER_KEY, username)
}

/** Logs out after a final save, so nothing made here is lost; then clears the device. */
export async function logOut(): Promise<void> {
  await saveNow()
  if (state !== 'saved') throw new Error('Could not save to the server, so you stay logged in. Try again when online.')
  await endSession()
  await clearPersonalData()
  await setSetting(LAST_USER_KEY, null)
  window.dispatchEvent(new Event(SYNCED))
}
