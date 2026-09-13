/**
 * Game-system vocabulary the app has to recognise by name.
 *
 * Everything here comes from the shared game system file, never from a faction
 * catalogue, so it holds for every faction: these are the category names the
 * 11th-edition core rules themselves use. Nothing faction-specific belongs here.
 */

import { ASSOCIATION } from '@/data/bsdata/schema'

/** The battlefield role of roster setup entries — battle size, detachment, toggles. */
export const CONFIGURATION_CATEGORY = 'Configuration'
export const CHARACTER_CATEGORY = 'Character'
export const WARLORD_CATEGORY = 'Warlord'
export const EPIC_HERO_CATEGORY = 'Epic Hero'

/**
 * Constraints on the `associations` field name an association *group* by id
 * (`childId`), while the associations themselves only carry a `label`. The game
 * system defines no table joining the two, so this is it.
 */
export const ASSOCIATION_LABELS: Record<string, string> = {
  [ASSOCIATION.leader]: 'Leader',
  [ASSOCIATION.support]: 'Supported by',
}

export const associationGroupIdForLabel = (label: string | undefined): string | undefined =>
  Object.entries(ASSOCIATION_LABELS).find(([, l]) => l === label)?.[0]
