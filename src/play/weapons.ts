/**
 * Which weapon profiles a unit's models carry, and how many of each. Used by
 * the in-game datasheet (surviving models only) and by the list builder's
 * unit editor (the loadout being built), so both show the same table.
 */

import type { Datasheet, WeaponProfile } from '@/data/model'
import type { ModelGroup } from './types'

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Where a profile name splits into weapon and firing mode.
 *
 * The sources write it "➤ Rokkit Launcha - Busta" — except where they do not:
 * one profile of one datasheet's rokkit launcha is "➤ Rokkit Launcha- Busta",
 * and a whole weapon is written without the marker at all ("Kustom Blasta X -
 * Skorcha"). Requiring the exact " - " dropped that profile out of its own
 * weapon, and the unit's gun then appeared under "options not taken" — which is
 * the kind of near-miss a hand-maintained source produces constantly, so the
 * separator is a hyphen with whitespace on *either* side.
 *
 * The hyphen inside a name ("Kombi-rokkit", "Kustom Mega-blasta") has no space
 * beside it, which is exactly what keeps it out of this.
 */
const MODE_SEPARATOR = /\s-\s|\s-(?=\S)|(?<=\S)-\s/

/** The marker a source puts in front of a sub-profile — "➤ ", and anything like it. */
const MARKER = /^[^\p{L}\p{N}]+\s/u

/**
 * The other way a source writes two profiles of one weapon: a trailing
 * qualifier in brackets — "Stikka (ranged)" and "Stikka (melee)" for a weapon
 * the loadout simply calls a Stikka. Read literally, neither profile belongs to
 * the weapon the model is holding, and the unit's only gun is listed as an
 * option it did not take.
 */
const QUALIFIER = /^(.*\S)\s*\(([^)]+)\)\s*$/

const splitMode = (name: string): { base: string; mode?: string } => {
  const clean = (text: string) => text.replace(MARKER, '').trim()
  const at = MODE_SEPARATOR.exec(name)
  if (at) {
    return {
      base: clean(name.slice(0, at.index)),
      // Whatever follows the separator is the mode, brackets and all: the
      // qualifier there belongs to the mode's name, not to the weapon's.
      mode: name.slice(at.index + at[0].length).trim(),
    }
  }
  const qualified = QUALIFIER.exec(clean(name))
  if (qualified) return { base: qualified[1]!.trim(), mode: qualified[2]!.trim() }
  return { base: clean(name) }
}

/** "➤ Rokkit Launcha - Busta" is one firing mode of the weapon "Rokkit Launcha". */
const baseOf = (profile: WeaponProfile): string => normalise(splitMode(profile.name).base)

const containsWord = (haystack: string, needle: string): boolean =>
  ` ${haystack} `.includes(` ${needle} `)

export type WeaponRow = { profile: WeaponProfile; count: number }

/** One firing mode of a weapon — "Busta" of a rokkit launcha. */
export type WeaponMode = { label: string | undefined; profile: WeaponProfile }

/**
 * A weapon as the player holds it: one name, one count, and the modes it can
 * be fired in.
 */
export type WeaponGroup = { name: string; count: number; modes: WeaponMode[] }

/** The name the weapon goes by, without the source's mode marker. */
const weaponName = (profile: WeaponProfile): string => splitMode(profile.name).base

/** "Busta" of "➤ Rokkit Launcha - Busta"; nothing for a single-profile weapon. */
const modeLabel = (profile: WeaponProfile): string | undefined => splitMode(profile.name).mode

/**
 * Rows folded into weapons: a weapon with several firing modes is one weapon
 * carried once, not two weapons carried twice. Printed as separate rows it
 * doubled every count and read like an option the player had failed to choose
 * — which is exactly the opposite of what it is. Which mode is fired is a
 * decision made at the table, so every mode stays in front of the player,
 * under the weapon it belongs to.
 */
export function groupModes(rows: readonly WeaponRow[]): WeaponGroup[] {
  const out: WeaponGroup[] = []
  for (const row of rows) {
    const name = weaponName(row.profile)
    const label = modeLabel(row.profile)
    // Only a profile that names a mode joins one: two weapons whose names
    // simply begin alike stay two weapons.
    const existing = label === undefined ? undefined : out.find((g) => g.name === name)
    if (existing) {
      existing.modes.push({ label, profile: row.profile })
      existing.count = Math.max(existing.count, row.count)
    } else {
      out.push({ name, count: row.count, modes: [{ label, profile: row.profile }] })
    }
  }
  return out
}

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
export function loadoutByModel(
  unit: { models: ModelGroup[] },
  sheet: Datasheet | undefined,
  /**
   * Keep the groups nothing survives in. The weapons list follows the models
   * on the board, so they are dropped by default — but the screen that takes
   * casualties is also the screen that puts a model back, and a group that
   * has vanished cannot be healed.
   */
  includeDead = false,
): ModelLoadout[] {
  const profiles = sheet?.weapons ?? []
  return unit.models
    .filter((group) => includeDead || group.alive > 0)
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
