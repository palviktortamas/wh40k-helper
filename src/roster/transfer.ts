/**
 * Moving a roster between devices without infrastructure (spec §4.4): one
 * JSON document, pasted or shared. The game data is never inside it — the
 * receiving device validates against whatever it has installed.
 */

import type { Roster } from './types'

export const APP_ID = 'wh40k-helper'
export const ROSTER_ENVELOPE_VERSION = 1

export type RosterEnvelope = {
  app: typeof APP_ID
  kind: 'roster'
  version: number
  exportedAt: number
  catalogueName: string
  roster: Roster
}

export function exportRosterJson(roster: Roster, catalogueName: string): string {
  const envelope: RosterEnvelope = {
    app: APP_ID,
    kind: 'roster',
    version: ROSTER_ENVELOPE_VERSION,
    exportedAt: Date.now(),
    catalogueName,
    roster,
  }
  return JSON.stringify(envelope, null, 2)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Parses pasted text; throws with a message fit for the screen when it is not a roster. */
export function parseRosterEnvelope(text: string): RosterEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    throw new Error('That is not JSON. Paste the whole exported roster.')
  }
  if (!isRecord(parsed) || parsed['app'] !== APP_ID || parsed['kind'] !== 'roster')
    throw new Error('That JSON is not a roster exported by this app.')
  if (typeof parsed['version'] !== 'number' || parsed['version'] > ROSTER_ENVELOPE_VERSION)
    throw new Error('That roster was exported by a newer version of the app. Update first.')
  const roster = parsed['roster']
  if (
    !isRecord(roster) ||
    typeof roster['id'] !== 'string' ||
    typeof roster['name'] !== 'string' ||
    typeof roster['catalogueId'] !== 'string' ||
    typeof roster['pointsLimit'] !== 'number' ||
    !Array.isArray(roster['selections'])
  )
    throw new Error('The roster inside is incomplete.')
  return parsed as unknown as RosterEnvelope
}

/** A fresh copy for this device: new id, new timestamps, a name that does not collide. */
export function adoptRoster(roster: Roster, existingNames: string[]): Roster {
  const now = Date.now()
  let name = roster.name
  let n = 2
  while (existingNames.includes(name)) name = `${roster.name} (${n++})`
  return {
    ...roster,
    id: `roster-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    configuration: Array.isArray(roster.configuration) ? roster.configuration : [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Share sheet on a phone, clipboard on a PC, a visible fallback when both are
 * blocked. Desktop Chrome also has `navigator.share`, but there the clipboard
 * is what the user wants — so the sheet is only used on touch devices.
 */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'shown'> {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  if (touch && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch {
      // Cancelled or unsupported payload; fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    alert(text)
    return 'shown'
  }
}
