/**
 * Resolves BSData's link graph into a tree the list builder can walk.
 *
 * A catalogue entry rarely holds its own children: option groups and weapons
 * arrive through `entryLink`s that point at shared entries, and a link may add
 * its own constraints, modifiers and costs on top of the target. Resolving that
 * once, lazily and with memoisation, keeps the builder and the evaluator free of
 * link-chasing.
 */

import { rootEntries } from '@/data/bsdata/parse'
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
  ForceEntry,
} from '@/data/bsdata/schema'
import type { SelectionType } from './types'
import { CONFIGURATION_CATEGORY } from './vocabulary'

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
  /** The catalogue's own id — what `primary-catalogue` conditions compare against. */
  catalogueId: string
  entries: Map<string, SelectionEntry>
  groups: Map<string, SelectionEntryGroup>
  categories: Map<string, CategoryEntry>
  costTypes: Map<string, CostType>
  /** The force entries the game system offers; the first non-hidden one is the app's force. */
  forceEntries: ForceEntry[]
  /** Entries that are datasheets — a primary category link and not hidden. */
  rootEntryIds: string[]
  /**
   * Roster setup entries (battle size, detachment, force disposition, toggles),
   * from both the game system and the catalogue. Instantiated once per roster.
   */
  configurationEntryIds: string[]
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

export function buildGraph(gs: GameSystem, cat: Catalogue, libraries: Catalogue[] = []): CatalogueGraph {
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

  // Libraries are the catalogues this one imports; the catalogue wins on collision.
  for (const source of [gs, ...libraries, cat]) {
    for (const entry of source.sharedSelectionEntries ?? []) indexEntry(entry)
    for (const group of source.sharedSelectionEntryGroups ?? []) indexGroup(group)
    for (const category of source.categoryEntries ?? []) categories.set(category.id, category)
  }
  // A root entry link can carry its own categories, costs and constraints; the
  // roster addresses roots by entry id, so remember the link per target.
  const rootLinks = new Map<string, EntryLink>()
  const rememberRootLinks = (source: Catalogue) => {
    for (const link of source.entryLinks ?? [])
      if (link.type === 'selectionEntry' && !rootLinks.has(link.targetId)) rootLinks.set(link.targetId, link)
  }
  rememberRootLinks(cat)
  const imported = new Set(
    (cat.catalogueLinks ?? []).filter((l) => l.importRootEntries).map((l) => l.targetId),
  )
  for (const lib of libraries) if (imported.has(lib.id)) rememberRootLinks(lib)
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
    const resolved = resolveEntry(entry, rootLinks.get(entryId), 0)
    cache.set(entryId, resolved)
    return resolved
  }

  const isConfiguration = (e: SelectionEntry): boolean =>
    (e.categoryLinks ?? []).some(
      (l) => l.primary && categories.get(l.targetId)?.name === CONFIGURATION_CATEGORY,
    )
  const hasPrimary = (e: SelectionEntry): boolean =>
    (e.categoryLinks ?? []).some((l) => l.primary) && !e.hidden

  const roots = rootEntries(cat, libraries, entries)
  const rootEntryIds = roots.filter((e) => hasPrimary(e) && !isConfiguration(e)).map((e) => e.id)

  // Game-system setup entries are the shared ones marked for import (battle
  // size, force disposition, visibility toggles); the catalogue adds its own
  // (the detachment picker), possibly through a library.
  // Roster setup comes from the catalogue's own links and entries only — a
  // library imported with `importRootEntries` (Unaligned Forces) brings its
  // units, not a second detachment picker.
  const ownConfiguration = rootEntries(cat, [], entries).filter((e) => hasPrimary(e) && isConfiguration(e))
  // Only when the catalogue has no setup entry of its own (everything lives in
  // its library) do the libraries' setup entries stand in — otherwise an
  // imported library's picker would sit next to the faction's own.
  const libraryConfiguration =
    ownConfiguration.length > 0
      ? []
      : libraries.flatMap((lib) =>
          (lib.sharedSelectionEntries ?? []).filter((e) => hasPrimary(e) && isConfiguration(e)),
        )
  const configurationEntryIds = [
    ...(gs.sharedSelectionEntries ?? []).filter(
      (e) => hasPrimary(e) && isConfiguration(e) && e.import !== false,
    ),
    ...ownConfiguration,
    ...libraryConfiguration,
  ]
    .map((e) => e.id)
    .filter((id, i, all) => all.indexOf(id) === i)

  return {
    catalogueId: cat.id,
    entries,
    groups,
    categories,
    costTypes,
    forceEntries: gs.forceEntries ?? [],
    rootEntryIds,
    configurationEntryIds,
    resolve,
    unsupported,
  }
}

/** A selectable child of a resolved entry, with the group it was offered in. */
export type ChildOption = { entry: ResolvedEntry; group?: ResolvedGroup }

/** Every entry selectable under `entry`: direct ones and those in (nested) groups. */
export function childOptions(entry: ResolvedEntry): ChildOption[] {
  const out: ChildOption[] = entry.entries.map((e) => ({ entry: e }))
  const walk = (group: ResolvedGroup) => {
    for (const e of group.entries) out.push({ entry: e, group })
    for (const nested of group.groups) walk(nested)
  }
  for (const group of entry.groups) walk(group)
  return out
}
