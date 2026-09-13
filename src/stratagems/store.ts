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
