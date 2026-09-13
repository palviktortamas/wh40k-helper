/**
 * Stratagem persistence and import. One record on the device holding every
 * faction's stratagems from Wahapedia's export, filtered per game. Wahapedia
 * sends no CORS headers, so the file arrives through the owner's endpoint or
 * as a file the owner saved from the browser (spec §4.2).
 */

import { db } from '@/data/db'
import { getSyncConfig } from '@/sync/client'
import { parseStratagems } from './parseCsv'
import { STRATAGEM_SET_ID, type StratagemSet } from './types'

/** Where the export lives; the app never fetches it directly (no CORS). */
export const STRATAGEMS_SOURCE_URL = 'https://wahapedia.ru/wh40k11ed/Stratagems.csv'

export const getStratagemSet = (): Promise<StratagemSet | undefined> => db.stratagems.get(STRATAGEM_SET_ID)

export async function importStratagemsCsv(csv: string): Promise<StratagemSet> {
  const stratagems = parseStratagems(csv)
  if (stratagems.length === 0) throw new Error('That file holds no stratagems — pick Stratagems.csv from the Wahapedia export.')
  const set: StratagemSet = { id: STRATAGEM_SET_ID, importedAt: Date.now(), stratagems }
  await db.stratagems.put(set)
  return set
}

/** Fetches the export through the owner's endpoint and imports it. */
export async function fetchStratagemsViaEndpoint(): Promise<StratagemSet> {
  const { url, passphrase } = await getSyncConfig()
  if (!url || !passphrase) throw new Error('Set the endpoint URL and passphrase under Settings → Sync first.')
  let response: Response
  try {
    response = await fetch(`${url}/proxy?url=${encodeURIComponent(STRATAGEMS_SOURCE_URL)}`, {
      headers: { authorization: `Bearer ${passphrase}` },
    })
  } catch {
    throw new Error('Could not reach the endpoint — offline, or the URL is wrong.')
  }
  if (response.status === 401) throw new Error('The endpoint rejected the passphrase.')
  if (!response.ok) throw new Error(`The endpoint answered ${response.status}.`)
  return importStratagemsCsv(await response.text())
}

export const removeStratagems = (): Promise<void> => db.stratagems.delete(STRATAGEM_SET_ID)

/** Where the build puts the export it fetched from Wahapedia (scripts/fetch-mission-deck.mjs). */
export const BUNDLED_STRATAGEMS_PATH = `${import.meta.env.BASE_URL}stratagems-wahapedia.csv`

/**
 * Imports the stratagems the build shipped, if this build has them (owner's
 * decision 2026-09-13). A same-origin fetch the service worker precaches, so it
 * works offline. Returns undefined when the build carries none (a dev server,
 * or a deploy where the fetch failed) — the manual import is still there.
 */
export async function importBundledStratagems(): Promise<StratagemSet | undefined> {
  let response: Response
  try {
    response = await fetch(BUNDLED_STRATAGEMS_PATH, { headers: { accept: 'text/csv' } })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  const text = await response.text()
  // A single-page app answers every path with index.html; only the export has the header.
  if (!text.replace(/^﻿/, '').startsWith('faction_id|')) return undefined
  return importStratagemsCsv(text)
}

/** Fired on `window` when the set changes behind a screen's back (the first-start import). */
export const STRATAGEMS_CHANGED = 'wh40k:stratagems-changed'

/** On start: bring in the shipped stratagems when the device has none yet. */
export async function ensureStratagems(): Promise<void> {
  if (await getStratagemSet()) return
  try {
    if (await importBundledStratagems()) window.dispatchEvent(new Event(STRATAGEMS_CHANGED))
  } catch (error) {
    console.warn('Bundled stratagems could not be imported:', error)
  }
}
