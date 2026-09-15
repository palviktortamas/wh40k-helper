/**
 * What a profile is, read from the characteristics it carries.
 *
 * The obvious reading — trust `typeName`, which is "Unit", "Ranged Weapons",
 * "Melee Weapons", "Abilities" on most of the data — quietly loses everything a
 * codex files under a type of its own invention: a psyker's powers, a court's
 * auras, a D6 table of button results, a star god's attacks. Those are the
 * rules the owner cannot look up anywhere else mid-game, so they must not be
 * dropped.
 *
 * The characteristics say what the profile is without naming anybody: a stat
 * line has Wounds and Toughness, a weapon has a Range and an attack skill, a
 * transport has a Capacity, and anything else carrying rules text is an
 * ability. The type name is then kept only as a heading, so "Psychic Abilities"
 * still reads as psychic abilities on the datasheet.
 */

import type { Profile } from './schema'

export type ProfileKind =
  | { kind: 'stats' }
  | { kind: 'weapon'; weapon: 'ranged' | 'melee' }
  | { kind: 'transport' }
  /** `group` is the codex's own heading, when it is not simply "Abilities". */
  | { kind: 'ability'; group?: string }

/** The type name every source uses for plain datasheet abilities. */
const PLAIN_ABILITIES = 'abilities'

const has = (profile: Profile, name: string): boolean =>
  (profile.characteristics ?? []).some((c) => c.name.toLowerCase() === name.toLowerCase())

const text = (profile: Profile): string =>
  (profile.characteristics ?? [])
    .map((c) => (c.$text ?? '').trim())
    .filter(Boolean)
    .join('\n')

export function classifyProfile(profile: Profile): ProfileKind | undefined {
  // Wounds and no Range: a stat line. Every weapon profile has a Range (melee
  // weapons say "Melee"), so the pair separates the two without either one
  // having to carry a full stat block.
  if (has(profile, 'W') && !has(profile, 'Range')) return { kind: 'stats' }
  if (has(profile, 'Range') && has(profile, 'A')) {
    return { kind: 'weapon', weapon: has(profile, 'WS') ? 'melee' : 'ranged' }
  }
  if (has(profile, 'Capacity')) return { kind: 'transport' }
  if (!text(profile)) return undefined
  const group = (profile.typeName ?? '').trim()
  return group && group.toLowerCase() !== PLAIN_ABILITIES ? { kind: 'ability', group } : { kind: 'ability' }
}

/** An ability's text: whatever the profile's characteristics spell out. */
export const abilityText = (profile: Profile): string => text(profile)
