/**
 * Battlefield roles are game-system vocabulary (the primary category of a
 * datasheet: Epic Hero, Character, Battleline, Infantry, Mounted, Monster,
 * Vehicle, Dedicated Transport, Fortification, …), never faction vocabulary.
 * The screens group and colour units by them so a 20-unit list can be scanned
 * instead of read. A role this file does not know still gets its own group,
 * under the data's own name, in the neutral colour.
 */

import type { CatalogueGraph } from './resolve'

export type RoleKey =
  | 'epic-hero'
  | 'character'
  | 'battleline'
  | 'infantry'
  | 'mounted'
  | 'beast'
  | 'swarm'
  | 'monster'
  | 'vehicle'
  | 'transport'
  | 'aircraft'
  | 'fortification'
  | 'other'

/** Display order: the units you read first when checking a list. */
export const ROLE_ORDER: readonly RoleKey[] = [
  'epic-hero',
  'character',
  'battleline',
  'infantry',
  'mounted',
  'beast',
  'swarm',
  'monster',
  'vehicle',
  'transport',
  'aircraft',
  'fortification',
  'other',
]

const HEADINGS: Record<RoleKey, string> = {
  'epic-hero': 'Epic Heroes',
  character: 'Characters',
  battleline: 'Battleline',
  infantry: 'Infantry',
  mounted: 'Mounted',
  beast: 'Beasts',
  swarm: 'Swarms',
  monster: 'Monsters',
  vehicle: 'Vehicles',
  transport: 'Dedicated Transports',
  aircraft: 'Aircraft',
  fortification: 'Fortifications',
  other: 'Other units',
}

export function roleKey(role: string | undefined): RoleKey {
  const r = (role ?? '').toLowerCase()
  if (r.includes('epic hero')) return 'epic-hero'
  if (r.includes('character')) return 'character'
  if (r.includes('battleline')) return 'battleline'
  if (r.includes('transport')) return 'transport'
  if (r.includes('infantry')) return 'infantry'
  if (r.includes('mounted')) return 'mounted'
  if (r.includes('beast')) return 'beast'
  if (r.includes('swarm')) return 'swarm'
  if (r.includes('monster')) return 'monster'
  if (r.includes('aircraft')) return 'aircraft'
  if (r.includes('vehicle')) return 'vehicle'
  if (r.includes('fortification')) return 'fortification'
  return 'other'
}

/** The data's own role name for a root entry, when it has one. */
export function roleOf(graph: CatalogueGraph, entryId: string): string | undefined {
  const entry = graph.resolve(entryId)
  const id = entry?.primaryCategoryId
  return id ? graph.categories.get(id)?.name : undefined
}

/** Heading for a group: a fixed word for a known role, the data's own name otherwise (never pluralised). */
export function roleHeading(key: RoleKey, roleName?: string): string {
  return key === 'other' && roleName ? roleName : HEADINGS[key]
}

export type RoleGroup<T> = {
  key: RoleKey
  /** The data's role name, or undefined for units without a primary category. */
  roleName: string | undefined
  heading: string
  /** Stable anchor id for jump links. */
  id: string
  items: T[]
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * Groups items by role: known roles in ROLE_ORDER, each unknown role under
 * its own name after them (alphabetically). Empty groups are not returned.
 */
export function groupByRole<T>(items: readonly T[], roleOfItem: (item: T) => string | undefined): RoleGroup<T>[] {
  const groups = new Map<string, RoleGroup<T>>()
  for (const item of items) {
    const roleName = roleOfItem(item)
    const key = roleKey(roleName)
    const groupId = key === 'other' ? `other-${slug(roleName ?? 'none')}` : key
    let group = groups.get(groupId)
    if (!group) {
      group = { key, roleName, heading: roleHeading(key, roleName), id: `group-${groupId}`, items: [] }
      groups.set(groupId, group)
    }
    group.items.push(item)
  }
  return [...groups.values()].sort((a, b) => {
    const order = ROLE_ORDER.indexOf(a.key) - ROLE_ORDER.indexOf(b.key)
    return order !== 0 ? order : a.heading.localeCompare(b.heading)
  })
}
