/**
 * Which weapon profiles a unit's models carry, and how many of each. Used by
 * the in-game datasheet (surviving models only) and by the list builder's
 * unit editor (the loadout being built), so both show the same table.
 */

import type { Datasheet, WeaponProfile } from '@/data/model'
import type { ModelGroup } from './types'

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** "➤ Rokkit Launcha - Busta" is one firing mode of the weapon "Rokkit Launcha". */
const baseOf = (profile: WeaponProfile): string => normalise(profile.name.split(' - ')[0] ?? profile.name)

const containsWord = (haystack: string, needle: string): boolean =>
  ` ${haystack} `.includes(` ${needle} `)

export type WeaponRow = { profile: WeaponProfile; count: number }

/**
 * Counts of each weapon the *living* models carry, matched to the datasheet's
 * weapon profiles. Matching is per loadout entry, most specific first, so
 * "Shoota" never counts as a "Big Shoota":
 * 1. the profile (or the weapon a multi-mode profile belongs to) has that name;
 * 2. else a combined weapon ("Kustom Choppa and Kombi-skorcha") names the
 *    weapon as a whole word.
 * A loadout name that matches no profile is kept as a plain line rather than dropped.
 */
export function weaponCounts(unit: { models: ModelGroup[] }, sheet: Datasheet | undefined) {
  const carried = new Map<string, number>()
  for (const group of unit.models) {
    if (group.alive <= 0) continue
    for (const weapon of group.weapons)
      carried.set(weapon.name, (carried.get(weapon.name) ?? 0) + weapon.perModel * group.alive)
  }
  const profiles = sheet?.weapons ?? []
  const counts = new Map<string, number>()
  const unmatched: [string, number][] = []
  for (const [name, n] of carried) {
    const key = normalise(name)
    let hits = profiles.filter((p) => normalise(p.name) === key || baseOf(p) === key)
    if (hits.length === 0) hits = profiles.filter((p) => containsWord(key, baseOf(p)))
    if (hits.length === 0) {
      unmatched.push([name, n])
      continue
    }
    for (const hit of hits) counts.set(hit.id, (counts.get(hit.id) ?? 0) + n)
  }
  const rows: WeaponRow[] = profiles.map((profile) => ({ profile, count: counts.get(profile.id) ?? 0 }))
  return { rows, unmatched }
}
