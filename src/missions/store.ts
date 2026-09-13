/**
 * Mission deck persistence and import (spec §6.1). One deck record on the
 * device; the owner imports it from a saved copy of the page or fetches the
 * page through their own endpoint, which adds the CORS headers Wahapedia lacks.
 */

import { db } from '@/data/db'
import { getSyncConfig } from '@/sync/client'
import { DECK_SOURCE_URL, parseMissionDeckHtml } from './parseDeck'
import { DECK_ID, type MissionDeck } from './types'

export const getMissionDeck = (): Promise<MissionDeck | undefined> => db.missions.get(DECK_ID)

export async function saveMissionDeck(deck: MissionDeck): Promise<void> {
  await db.missions.put(deck)
}

export async function importMissionDeckHtml(html: string, sourceUrl = DECK_SOURCE_URL): Promise<MissionDeck> {
  const deck = parseMissionDeckHtml(html, sourceUrl)
  await saveMissionDeck(deck)
  return deck
}

/** Fetches the published page through the owner's endpoint and imports it. */
export async function fetchMissionDeckViaEndpoint(): Promise<MissionDeck> {
  const { url, passphrase } = await getSyncConfig()
  if (!url || !passphrase) throw new Error('Set the endpoint URL and passphrase under Settings → Sync first.')
  let response: Response
  try {
    response = await fetch(`${url}/proxy?url=${encodeURIComponent(DECK_SOURCE_URL)}`, {
      headers: { authorization: `Bearer ${passphrase}` },
    })
  } catch {
    throw new Error('Could not reach the endpoint — offline, or the URL is wrong.')
  }
  if (response.status === 401) throw new Error('The endpoint rejected the passphrase.')
  if (!response.ok) throw new Error(`The endpoint answered ${response.status}.`)
  return importMissionDeckHtml(await response.text())
}
