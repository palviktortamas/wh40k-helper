/**
 * Battlefield roles are game-system vocabulary (the primary category of a
 * datasheet: Character, Battleline, Dedicated Transport, …), never faction
 * vocabulary. The screens group and colour units by them so a 20-unit list can
 * be scanned instead of read. Unknown role names fall into "other".
 */

import type { CatalogueGraph } from './resolve'

export type RoleKey = 'character' | 'battleline' | 'transport' | 'other' | 'fortification'

/** Display order: the units you read first when checking a list. */
export const ROLE_ORDER: readonly RoleKey[] = ['character', 'battleline', 'transport', 'other', 'fortification']

export function roleKey(role: string | undefined): RoleKey {
  const r = (role ?? '').toLowerCase()
  if (r.includes('character') || r.includes('epic hero')) return 'character'
  if (r.includes('battleline')) return 'battleline'
  if (r.includes('transport')) return 'transport'
  if (r.includes('fortification')) return 'fortification'
  return 'other'
}

/** The data's own role name for a root entry, when it has one. */
export function roleOf(graph: CatalogueGraph, entryId: string): string | undefined {
  const entry = graph.resolve(entryId)
  const id = entry?.primaryCategoryId
  return id ? graph.categories.get(id)?.name : undefined
}

/** Plural heading for a group of units of one role. */
export function roleHeading(key: RoleKey, roleName?: string): string {
  if (roleName) return roleName.endsWith('s') ? roleName : `${roleName}s`
  switch (key) {
    case 'character':
      return 'Characters'
    case 'battleline':
      return 'Battleline'
    case 'transport':
      return 'Dedicated Transports'
    case 'fortification':
      return 'Fortifications'
    default:
      return 'Other units'
  }
}
