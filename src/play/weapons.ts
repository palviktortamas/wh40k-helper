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
 * The profiles one loadout entry stands for, most specific first, so "Shoota"
 * never matches "Big Shoota":
 * 1. the profile (or the weapon a multi-mode profile belongs to) has that name;
 * 2. else a combined weapon ("Kustom Choppa and Kombi-skorcha") names the
 *    weapon as a whole word.
 * A weapon with several firing modes yields all of them — which mode is fired
 * is a decision made at the table, so both have to be in front of the player.
 */
const profilesFor = (name: string, profiles: readonly WeaponProfile[]): WeaponProfile[] => {
  const key = normalise(name)
  const exact = profiles.filter((p) => normalise(p.name) === key || baseOf(p) === key)
  return exact.length > 0 ? exact : profiles.filter((p) => containsWord(key, baseOf(p)))
}

/**
 * Counts of each weapon the *living* models carry, matched to the datasheet's
 * weapon profiles. A loadout name that matches no profile is kept as a plain
 * line rather than dropped.
 *
 * Profiles the datasheet only reaches through a shared option tree (the
 * Crusade relics every datasheet in the game links) are not the unit's own
 * options, so they are listed only when a model actually carries one.
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
    const hits = profilesFor(name, profiles)
    if (hits.length === 0) {
      unmatched.push([name, n])
      continue
    }
    for (const hit of hits) counts.set(hit.id, (counts.get(hit.id) ?? 0) + n)
  }
  const rows: WeaponRow[] = profiles
    .filter((profile) => !profile.shared || (counts.get(profile.id) ?? 0) > 0)
    .map((profile) => ({ profile, count: counts.get(profile.id) ?? 0 }))
  return { rows, unmatched }
}

/** One model type of a unit and the weapons every model of it carries. */
export type ModelLoadout = {
  id: string
  name: string
  alive: number
  total: number
  /** Profiles one model of this group carries — `count` is per model, not per unit. */
  rows: WeaponRow[]
  /** Wargear that matched no weapon profile, per model. */
  unmatched: [string, number][]
}

/**
 * The loadout split by model type: "12 Boyz with a slugga and a choppa, 2 with
 * a rokkit launcha, 2 Nobz with…". A twenty-model mob's weapon table is a wall
 * of numbers that never says *which* models carry the special weapons — and
 * that is exactly what you need to know when removing casualties or deciding
 * who shoots. Dead groups drop out; the table follows the models still on the
 * board.
 */
export function loadoutByModel(unit: { models: ModelGroup[] }, sheet: Datasheet | undefined): ModelLoadout[] {
  const profiles = sheet?.weapons ?? []
  return unit.models
    .filter((group) => group.alive > 0)
    .map((group) => {
      const rows: WeaponRow[] = []
      const unmatched: [string, number][] = []
      for (const weapon of group.weapons) {
        const hits = profilesFor(weapon.name, profiles)
        if (hits.length === 0) {
          unmatched.push([weapon.name, weapon.perModel])
          continue
        }
        for (const profile of hits)
          if (!rows.some((r) => r.profile.id === profile.id)) rows.push({ profile, count: weapon.perModel })
      }
      // Shooting comes before fighting at the table, so the list reads in that order.
      rows.sort((a, b) => Number(a.profile.kind === 'melee') - Number(b.profile.kind === 'melee'))
      return { id: group.id, name: group.name, alive: group.alive, total: group.total, rows, unmatched }
    })
}
