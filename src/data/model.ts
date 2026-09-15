/**
 * The app's internal model (spec §4.3). Deliberately source-agnostic: nothing
 * here names a faction, and every record carries the ids needed to cross-link
 * back to the source it came from.
 */

import type { SelectionEntry, Association, Constraint } from './bsdata/schema'
import type { SourceId } from './sources'

/** A single line of a stat block. Values stay strings — they carry "6\"", "2+", "D6". */
export type UnitStats = {
  name: string
  m?: string
  t?: string
  sv?: string
  w?: string
  ld?: string
  oc?: string
  invSv?: string
}

export type WeaponKind = 'ranged' | 'melee'

export type WeaponProfile = {
  id: string
  name: string
  kind: WeaponKind
  range?: string
  a?: string
  /** BS for ranged, WS for melee. */
  skill?: string
  s?: string
  ap?: string
  d?: string
  /** Sustained Hits, Lethal Hits, Anti-Infantry 4+, … */
  keywords: string[]
  /**
   * Reached only through a shared option tree the datasheet links (Crusade
   * relics, army-wide wargear), not through one of this datasheet's own
   * options. Every datasheet in the game links those trees, so such a profile
   * is listed only when a model actually carries it.
   */
  shared?: boolean
}

export type AbilityKind =
  | 'core'
  | 'faction'
  | 'detachment'
  | 'datasheet'
  | 'wargear'
  | 'enhancement'
  | 'stratagem'
  | 'other'

export type Ability = {
  id: string
  name: string
  kind: AbilityKind
  /** May contain HTML when it came from a rules-text source. */
  text: string
  /**
   * The heading the source filed it under when that is not simply "Abilities" —
   * "Psychic Abilities", a D6 table's name. Some of those rows are called "1-2"
   * and mean nothing without it.
   */
  group?: string
}

/**
 * One model entry inside a datasheet — "Boy", "Nob" — with its own count
 * limits and weapon options.
 */
export type ModelEntry = {
  id: string
  name: string
  min?: number
  max?: number
  /** Weapon option groups, kept as the raw entry so the Phase 2 editor can walk them. */
  optionGroupIds: string[]
}

export type PointsAtSize = {
  models: number
  points: number
}

/**
 * A Requisition Threshold band: "your 1st to 3rd units cost …", "your 4th+ …".
 * `from`/`to` are 1-based counts of this datasheet already in the roster.
 */
export type PricingBand = {
  label?: string
  from: number
  to?: number
  costs: PointsAtSize[]
}

export type Datasheet = {
  /** BSData shared selection entry id — the app's primary key for a unit. */
  id: string
  name: string
  /** Battlefield role from the primary category link: Character, Battleline, … */
  role?: string
  /** Bracketed variant tag BSData appends, e.g. "Legends" — the mirror omits it. */
  variant?: string
  keywords: string[]
  factionKeywords: string[]
  type: SelectionEntry['type']
  stats: UnitStats[]
  /** Wounds threshold at which the damaged profile applies, when the data says. */
  weapons: WeaponProfile[]
  abilities: Ability[]
  models: ModelEntry[]
  transportCapacity?: string
  /** Base cost from BSData, before modifiers and Requisition Thresholds. */
  basePoints?: number
  /** Authoritative pricing bands, from the MFM mirror where it matched. */
  pricing?: PricingBand[]
  /** Units this one may lead / support, by name, where the source says so. */
  leaderTo?: string[]
  supportTo?: string[]
  /** Name of the linked library catalogue this came from, when not the faction's own file. */
  library?: string
  /** Leader/Support attachment rules as encoded by BSData. */
  associations: Association[]
  /** Kept faithfully for the Phase 2 constraint evaluator — never lossy. */
  constraints: Constraint[]
  sources: SourceId[]
}

export type Enhancement = {
  name: string
  points?: number
}

export type Detachment = {
  id?: string
  name: string
  /** Detachment Points cost in the 11e modular detachment system. */
  dp?: number
  /** Force Dispositions this detachment can field, e.g. Take and Hold. */
  forceDispositions: string[]
  enhancements: Enhancement[]
  /** The detachment's own rules, as BSData attaches them to the entry. Absent on catalogues parsed before Phase 5. */
  rules?: Ability[]
  /** Name of the linked library catalogue this came from, when not the faction's own file. */
  library?: string
  sources: SourceId[]
}

export type ParsedCatalogue = {
  /** BSData catalogue id. */
  id: string
  name: string
  /** MFM slug when one matched, e.g. for refreshing points. */
  slug?: string
  revision: number
  gameSystemId: string
  gameSystemRevision?: number
  datasheets: Datasheet[]
  detachments: Detachment[]
  /** Rules text shared across the catalogue, keyed by BSData rule id. */
  rules: Ability[]
  /**
   * Every enhancement in the catalogue with its rules text, by entry id (the
   * roster's `entryId` for a taken enhancement). Absent on catalogues parsed
   * before Phase 5.
   */
  enhancements?: Ability[]
  /** Constructs the parser met but does not yet model, for the Data Health screen. */
  unsupported: string[]
}

export type CatalogueSummary = {
  id: string
  name: string
  file: string
  slug?: string
  installedRevision?: number
  installedAt?: number
  datasheetCount?: number
}
