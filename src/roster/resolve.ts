/**
 * Resolves BSData's link graph into a tree the list builder can walk.
 *
 * A catalogue entry rarely holds its own children: option groups and weapons
 * arrive through `entryLink`s that point at shared entries, and a link may add
 * its own constraints, modifiers and costs on top of the target. Resolving that
 * once, lazily and with memoisation, keeps the builder and the evaluator free of
 * link-chasing.
 */

import type {
  Catalogue,
  GameSystem,
  SelectionEntry,
  SelectionEntryGroup,
  EntryLink,
  Constraint,
  Modifier,
  ModifierGroup,
  Cost,
  Association,
  CategoryEntry,
  CostType,
} from '@/data/bsdata/schema'
import type { SelectionType } from './types'

export type ResolvedEntry = {
  /** Entry id. Two links to one shared entry resolve to the same id. */
  id: string
  /** The link that pulled this entry in, when it came through one. */
  linkId?: string
  name: string
  type: SelectionType
  hidden: boolean
  /** Base costs by cost type id. */
  costs: Record<string, number>
  constraints: Constraint[]
  modifiers: Modifier[]
  modifierGroups: ModifierGroup[]
  associations: Association[]
  /** Category entry ids this selection belongs to. */
  categoryIds: string[]
  primaryCategoryId?: string
  groups: ResolvedGroup[]
  /** Entries selectable directly under this one (not via a group). */
  entries: ResolvedEntry[]
}

export type ResolvedGroup = {
  id: string
  linkId?: string
  name: string
  hidden: boolean
  defaultEntryId?: string
  constraints: Constraint[]
  modifiers: Modifier[]
  modifierGroups: ModifierGroup[]
  groups: ResolvedGroup[]
  entries: ResolvedEntry[]
}

export type CatalogueGraph = {
  entries: Map<string, SelectionEntry>
  groups: Map<string, SelectionEntryGroup>
  categories: Map<string, CategoryEntry>
  costTypes: Map<string, CostType>
  /** Entries that are datasheets — a primary category link and not hidden. */
  rootEntryIds: string[]
  resolve: (entryId: string) => ResolvedEntry | undefined
  /** Constructs met but not modelled, surfaced rather than swallowed. */
  unsupported: string[]
}

const asCosts = (costs: Cost[] | undefined): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const cost of costs ?? []) out[cost.typeId] = cost.value
  return out
}

/** Guards against the cycles that entry links can form (a transport listing its cargo). */
const MAX_DEPTH = 12

export function buildGraph(gs: GameSystem, cat: Catalogue): CatalogueGraph {
  const entries = new Map<string, SelectionEntry>()
  const groups = new Map<string, SelectionEntryGroup>()
  const categories = new Map<string, CategoryEntry>()
  const costTypes = new Map<string, CostType>()
  const unsupported: string[] = []

  const indexEntry = (entry: SelectionEntry) => {
    entries.set(entry.id, entry)
    for (const child of entry.selectionEntries ?? []) indexEntry(child)
    for (const group of entry.selectionEntryGroups ?? []) indexGroup(group)
  }
  const indexGroup = (group: SelectionEntryGroup) => {
    groups.set(group.id, group)
    for (const child of group.selectionEntries ?? []) indexEntry(child)
    for (const nested of group.selectionEntryGroups ?? []) indexGroup(nested)
  }

  for (const source of [gs, cat]) {
    for (const entry of source.sharedSelectionEntries ?? []) indexEntry(entry)
    for (const group of source.sharedSelectionEntryGroups ?? []) indexGroup(group)
    for (const category of source.categoryEntries ?? []) categories.set(category.id, category)
  }
  for (const costType of gs.costTypes ?? []) costTypes.set(costType.id, costType)

  const cache = new Map<string, ResolvedEntry>()

  const resolveEntry = (
    entry: SelectionEntry,
    link: EntryLink | undefined,
    depth: number,
  ): ResolvedEntry => {
    const categoryLinks = [...(entry.categoryLinks ?? []), ...(link?.categoryLinks ?? [])]
    const primary = categoryLinks.find((l) => l.primary)

    const resolved: ResolvedEntry = {
      id: entry.id,
      ...(link ? { linkId: link.id } : {}),
      name: link?.name ?? entry.name,
      type: entry.type,
      hidden: Boolean(entry.hidden ?? link?.hidden),
      // A link may override the target's cost, so its values win.
      costs: { ...asCosts(entry.costs), ...asCosts(link?.costs) },
      constraints: [...(entry.constraints ?? []), ...(link?.constraints ?? [])],
      modifiers: [...(entry.modifiers ?? []), ...(link?.modifiers ?? [])],
      modifierGroups: [...(entry.modifierGroups ?? []), ...(link?.modifierGroups ?? [])],
      associations: entry.associations ?? [],
      categoryIds: categoryLinks.map((l) => l.targetId),
      ...(primary ? { primaryCategoryId: primary.targetId } : {}),
      groups: [],
      entries: [],
    }

    if (depth >= MAX_DEPTH) return resolved

    for (const group of entry.selectionEntryGroups ?? [])
      resolved.groups.push(resolveGroup(group, undefined, depth + 1))
    for (const child of entry.selectionEntries ?? [])
      resolved.entries.push(resolveEntry(child, undefined, depth + 1))
    for (const child of link?.selectionEntries ?? [])
      resolved.entries.push(resolveEntry(child, undefined, depth + 1))

    for (const childLink of [...(entry.entryLinks ?? []), ...(link?.entryLinks ?? [])])
      follow(childLink, resolved, depth)

    return resolved
  }

  const follow = (
    childLink: EntryLink,
    parent: ResolvedEntry | ResolvedGroup,
    depth: number,
  ): void => {
    if (childLink.type === 'selectionEntryGroup') {
      const target = groups.get(childLink.targetId)
      if (!target) {
        unsupported.push(`Missing group target ${childLink.targetId} ("${childLink.name}")`)
        return
      }
      parent.groups.push(resolveGroup(target, childLink, depth + 1))
      return
    }
    const target = entries.get(childLink.targetId)
    if (!target) {
      unsupported.push(`Missing entry target ${childLink.targetId} ("${childLink.name}")`)
      return
    }
    parent.entries.push(resolveEntry(target, childLink, depth + 1))
  }

  const resolveGroup = (
    group: SelectionEntryGroup,
    link: EntryLink | undefined,
    depth: number,
  ): ResolvedGroup => {
    const resolved: ResolvedGroup = {
      id: group.id,
      ...(link ? { linkId: link.id } : {}),
      name: link?.name ?? group.name,
      hidden: Boolean(group.hidden ?? link?.hidden),
      ...(group.defaultSelectionEntryId ? { defaultEntryId: group.defaultSelectionEntryId } : {}),
      constraints: [...(group.constraints ?? []), ...(link?.constraints ?? [])],
      modifiers: [...(group.modifiers ?? []), ...(link?.modifiers ?? [])],
      modifierGroups: [...(group.modifierGroups ?? []), ...(link?.modifierGroups ?? [])],
      groups: [],
      entries: [],
    }

    if (depth >= MAX_DEPTH) return resolved

    for (const nested of group.selectionEntryGroups ?? [])
      resolved.groups.push(resolveGroup(nested, undefined, depth + 1))
    for (const child of group.selectionEntries ?? [])
      resolved.entries.push(resolveEntry(child, undefined, depth + 1))
    for (const childLink of [...(group.entryLinks ?? []), ...(link?.entryLinks ?? [])])
      follow(childLink, resolved, depth)

    return resolved
  }

  const resolve = (entryId: string): ResolvedEntry | undefined => {
    const cached = cache.get(entryId)
    if (cached) return cached
    const entry = entries.get(entryId)
    if (!entry) return undefined
    const resolved = resolveEntry(entry, undefined, 0)
    cache.set(entryId, resolved)
    return resolved
  }

  const rootEntryIds = (cat.sharedSelectionEntries ?? [])
    .filter((e) => (e.categoryLinks ?? []).some((l) => l.primary) && !e.hidden)
    .map((e) => e.id)

  return { entries, groups, categories, costTypes, rootEntryIds, resolve, unsupported }
}
