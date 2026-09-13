/**
 * Mission deck persistence and import (spec §6.1). One deck record on the
 * device; the owner imports it from a saved copy of the page or fetches the
 * page through their own endpoint, which adds the CORS headers Wahapedia lacks.
 */

import { db } from '@/data/db'
import { getSyncConfig } from '@/sync/client'
import { DECK_SOURCE_URL, parseMissionDeckHtml } from './parseDeck'
import { DECK_ID, type MissionCard, type MissionDeck } from './types'

export const getMissionDeck = (): Promise<MissionDeck | undefined> => db.missions.get(DECK_ID)

export async function saveMissionDeck(deck: MissionDeck): Promise<void> {
  await db.missions.put(deck)
}

/**
 * The in-app editor (spec §6.1): replaces one card, matched by id in whichever
 * deck it sits in, and saves. Card ids are stable across re-imports (they are
 * slugs of the printed name), so a game in progress keeps pointing at the card.
 */
export async function updateMissionCard(deck: MissionDeck, card: MissionCard): Promise<MissionDeck> {
  const swap = <T extends MissionCard>(cards: T[]): T[] =>
    cards.map((c) => (c.id === card.id ? ({ ...c, ...card } as T) : c))
  const next: MissionDeck = {
    ...deck,
    editedAt: Date.now(),
    primaries: swap(deck.primaries),
    secondaries: swap(deck.secondaries),
    twists: swap(deck.twists),
  }
  await saveMissionDeck(next)
  return next
}

export async function importMissionDeckHtml(html: string, sourceUrl = DECK_SOURCE_URL): Promise<MissionDeck> {
  const deck = parseMissionDeckHtml(html, sourceUrl)
  await saveMissionDeck(deck)
  return deck
}

/** Where the build puts the deck page it fetched from Wahapedia (scripts/fetch-mission-deck.mjs). */
export const BUNDLED_DECK_PATH = `${import.meta.env.BASE_URL}missions-ca-2026-27.html`

/**
 * Imports the deck the build shipped with the app, if this build has one. A
 * same-origin fetch, so it works offline once the service worker has cached
 * the page. Returns undefined when the build carries no deck (a dev server, or
 * a deploy where the fetch failed) — the manual import is still there.
 */
export async function importBundledMissionDeck(): Promise<MissionDeck | undefined> {
  let response: Response
  try {
    response = await fetch(BUNDLED_DECK_PATH, { headers: { accept: 'text/html' } })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  const html = await response.text()
  // A single-page app answers every path with index.html; only the deck page has cards.
  if (!html.includes('cgCardCA7')) return undefined
  return importMissionDeckHtml(html)
}

/** On start: bring in the shipped deck when the device has none yet. */
export async function ensureMissionDeck(): Promise<void> {
  if (await getMissionDeck()) return
  try {
    await importBundledMissionDeck()
  } catch (error) {
    console.warn('Bundled mission deck could not be imported:', error)
  }
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
