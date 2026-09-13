/**
 * Turns a BSData catalogue into the app's internal model.
 *
 * Scope note: this parser produces what the *datasheet browser* needs, and
 * preserves the raw constraint/association graph untouched so the Phase 2
 * constraint evaluator can work from the source of truth rather than from a
 * lossy summary. It does not evaluate modifiers — a datasheet's displayed
 * points are the base cost; conditional costs are a roster-time concern.
 */

import type {
  Catalogue,
  GameSystem,
  Profile,
  SelectionEntry,
  SelectionEntryGroup,
  EntryLink,
  CategoryEntry,
  Rule,
} from './schema'
import { COST_TYPE } from './schema'
import type {
  Ability,
  Datasheet,
  Detachment,
  ModelEntry,
  ParsedCatalogue,
  UnitStats,
  WeaponProfile,
} from '../model'

/** Profile type names are stable across the 11e data; matched case-insensitively. */
const PROFILE_UNIT = 'unit'
const PROFILE_RANGED = 'ranged weapons'
const PROFILE_MELEE = 'melee weapons'
const PROFILE_ABILITIES = 'abilities'
const PROFILE_TRANSPORT = 'transport'

const FACTION_PREFIX = 'faction:'
/** The roster setup entry's role — army configuration, not a unit. */
const CONFIGURATION_ROLE = 'Configuration'
/** BSData tags variants in brackets: "Some Unit [Legends]". */
const VARIANT_TAG = /\s*\[([^\]]+)\]\s*$/

type Index = {
  entries: Map<string, SelectionEntry>
  groups: Map<string, SelectionEntryGroup>
  profiles: Map<string, Profile>
  rules: Map<string, Rule>
  categories: Map<string, CategoryEntry>
}

const characteristic = (profile: Profile, name: string): string | undefined => {
  const hit = profile.characteristics?.find((c) => c.name.toLowerCase() === name.toLowerCase())
  const text = hit?.$text?.trim()
  return text ? text : undefined
}

/** Weapon keyword cells read "Sustained Hits 1, Lethal Hits" or "-". */
const splitKeywords = (raw: string | undefined): string[] =>
  !raw || raw === '-'
    ? []
    : raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)

function buildIndex(gs: GameSystem, cat: Catalogue): Index {
  const index: Index = {
    entries: new Map(),
    groups: new Map(),
    profiles: new Map(),
    rules: new Map(),
    categories: new Map(),
  }

  // Shared nodes are addressed by id from anywhere in either file, so index both
  // and let the catalogue win on collision (it is the more specific source).
  for (const source of [gs, cat]) {
    for (const e of source.sharedSelectionEntries ?? []) indexEntry(e, index)
    for (const g of source.sharedSelectionEntryGroups ?? []) indexGroup(g, index)
    for (const p of source.sharedProfiles ?? []) index.profiles.set(p.id, p)
    for (const r of [...(source.sharedRules ?? []), ...(source.rules ?? [])])
      index.rules.set(r.id, r)
    for (const c of source.categoryEntries ?? []) index.categories.set(c.id, c)
  }
  return index
}

function indexEntry(entry: SelectionEntry, index: Index): void {
  index.entries.set(entry.id, entry)
  for (const p of entry.profiles ?? []) index.profiles.set(p.id, p)
  for (const r of entry.rules ?? []) index.rules.set(r.id, r)
  for (const child of entry.selectionEntries ?? []) indexEntry(child, index)
  for (const group of entry.selectionEntryGroups ?? []) indexGroup(group, index)
}

function indexGroup(group: SelectionEntryGroup, index: Index): void {
  index.groups.set(group.id, group)
  for (const child of group.selectionEntries ?? []) indexEntry(child, index)
  for (const nested of group.selectionEntryGroups ?? []) indexGroup(nested, index)
}

/**
 * Collects every profile reachable from an entry: its own, those pulled in by
 * infoLinks, and those on nested entries (a model's weapons hang off the model,
 * not the unit). Depth is bounded because entry links can form cycles.
 */
function collectProfiles(
  entry: SelectionEntry | SelectionEntryGroup,
  index: Index,
  seen: Set<string>,
  depth = 0,
): Profile[] {
  if (depth > 8) return []
  const out: Profile[] = []

  const visitEntry = (node: SelectionEntry) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    for (const p of node.profiles ?? []) if (!seen.has(p.id)) (seen.add(p.id), out.push(p))
    for (const link of node.infoLinks ?? []) {
      if (link.type !== 'profile') continue
      const target = index.profiles.get(link.targetId)
      if (target && !seen.has(target.id)) (seen.add(target.id), out.push(target))
    }
    for (const child of node.selectionEntries ?? []) visitEntry(child)
    for (const group of node.selectionEntryGroups ?? []) visitGroup(group)
    for (const link of node.entryLinks ?? []) visitLink(link)
  }

  const visitGroup = (node: SelectionEntryGroup) => {
    if (seen.has(node.id)) return
    seen.add(node.id)
    for (const child of node.selectionEntries ?? []) visitEntry(child)
    for (const nested of node.selectionEntryGroups ?? []) visitGroup(nested)
    for (const link of node.entryLinks ?? []) visitLink(link)
  }

  const visitLink = (link: EntryLink) => {
    const target =
      link.type === 'selectionEntry'
        ? index.entries.get(link.targetId)
        : index.groups.get(link.targetId)
    if (!target) return
    out.push(...collectProfiles(target, index, seen, depth + 1))
    for (const child of link.selectionEntries ?? []) visitEntry(child)
    for (const nested of link.entryLinks ?? []) visitLink(nested)
  }

  if ('type' in entry && (entry as SelectionEntry).type) visitEntry(entry as SelectionEntry)
  else visitGroup(entry as SelectionEntryGroup)

  return out
}

const toStats = (p: Profile): UnitStats => ({
  name: p.name,
  ...(characteristic(p, 'M') !== undefined ? { m: characteristic(p, 'M')! } : {}),
  ...(characteristic(p, 'T') !== undefined ? { t: characteristic(p, 'T')! } : {}),
  ...(characteristic(p, 'SV') !== undefined ? { sv: characteristic(p, 'SV')! } : {}),
  ...(characteristic(p, 'W') !== undefined ? { w: characteristic(p, 'W')! } : {}),
  ...(characteristic(p, 'LD') !== undefined ? { ld: characteristic(p, 'LD')! } : {}),
  ...(characteristic(p, 'OC') !== undefined ? { oc: characteristic(p, 'OC')! } : {}),
  ...(characteristic(p, 'InSv') !== undefined ? { invSv: characteristic(p, 'InSv')! } : {}),
})

const toWeapon = (p: Profile, kind: 'ranged' | 'melee'): WeaponProfile => ({
  id: p.id,
  name: p.name,
  kind,
  ...(characteristic(p, 'Range') !== undefined ? { range: characteristic(p, 'Range')! } : {}),
  ...(characteristic(p, 'A') !== undefined ? { a: characteristic(p, 'A')! } : {}),
  ...(characteristic(p, kind === 'ranged' ? 'BS' : 'WS') !== undefined
    ? { skill: characteristic(p, kind === 'ranged' ? 'BS' : 'WS')! }
    : {}),
  ...(characteristic(p, 'S') !== undefined ? { s: characteristic(p, 'S')! } : {}),
  ...(characteristic(p, 'AP') !== undefined ? { ap: characteristic(p, 'AP')! } : {}),
  ...(characteristic(p, 'D') !== undefined ? { d: characteristic(p, 'D')! } : {}),
  keywords: splitKeywords(characteristic(p, 'Keywords')),
})

/** Model entries are the nested `type: 'model'` entries of a unit. */
function collectModels(entry: SelectionEntry): ModelEntry[] {
  const models: ModelEntry[] = []

  const scanEntry = (node: SelectionEntry) => {
    if (node.type === 'model') {
      const parentBound = node.constraints ?? []
      const min = parentBound.find((c) => c.type === 'min')?.value
      const max = parentBound.find((c) => c.type === 'max')?.value
      models.push({
        id: node.id,
        name: node.name,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        optionGroupIds: (node.selectionEntryGroups ?? []).map((g) => g.id),
      })
    }
    for (const child of node.selectionEntries ?? []) scanEntry(child)
    for (const group of node.selectionEntryGroups ?? []) scanGroup(group)
  }
  const scanGroup = (group: SelectionEntryGroup) => {
    for (const child of group.selectionEntries ?? []) scanEntry(child)
    for (const nested of group.selectionEntryGroups ?? []) scanGroup(nested)
  }

  for (const child of entry.selectionEntries ?? []) scanEntry(child)
  for (const group of entry.selectionEntryGroups ?? []) scanGroup(group)
  // A single-model datasheet is itself the model.
  if (models.length === 0 && entry.type === 'model') {
    models.push({ id: entry.id, name: entry.name, optionGroupIds: [] })
  }
  return models
}

function toDatasheet(entry: SelectionEntry, index: Index): Datasheet {
  const profiles = collectProfiles(entry, index, new Set())
  const byType = (name: string) =>
    profiles.filter((p) => (p.typeName ?? '').toLowerCase() === name)

  const categoryNames = (entry.categoryLinks ?? []).map(
    (l) => index.categories.get(l.targetId)?.name ?? l.name ?? '',
  )
  const primaryLink = (entry.categoryLinks ?? []).find((l) => l.primary)
  const role = primaryLink
    ? (index.categories.get(primaryLink.targetId)?.name ?? primaryLink.name)
    : undefined

  const factionKeywords = categoryNames
    .filter((n) => n.toLowerCase().startsWith(FACTION_PREFIX))
    .map((n) => n.slice(FACTION_PREFIX.length).trim())
  const keywords = categoryNames.filter((n) => n && !n.toLowerCase().startsWith(FACTION_PREFIX))

  const abilities: Ability[] = byType(PROFILE_ABILITIES).map((p) => ({
    id: p.id,
    name: p.name,
    kind: 'datasheet',
    text: characteristic(p, 'Description') ?? '',
  }))
  // Rules linked by infoLink are faction/core rules shared across datasheets.
  for (const link of entry.infoLinks ?? []) {
    if (link.type !== 'rule') continue
    const rule = index.rules.get(link.targetId)
    if (rule) abilities.push({ id: rule.id, name: rule.name, kind: 'faction', text: rule.description ?? '' })
  }

  const transport = byType(PROFILE_TRANSPORT)[0]
  const points = entry.costs?.find((c) => c.typeId === COST_TYPE.points)?.value
  const variant = VARIANT_TAG.exec(entry.name)?.[1]

  return {
    id: entry.id,
    name: entry.name,
    ...(role ? { role } : {}),
    ...(variant ? { variant } : {}),
    keywords,
    factionKeywords,
    type: entry.type,
    stats: byType(PROFILE_UNIT).map(toStats),
    weapons: [
      ...byType(PROFILE_RANGED).map((p) => toWeapon(p, 'ranged')),
      ...byType(PROFILE_MELEE).map((p) => toWeapon(p, 'melee')),
    ],
    abilities,
    models: collectModels(entry),
    ...(transport && characteristic(transport, 'Capacity')
      ? { transportCapacity: characteristic(transport, 'Capacity')! }
      : {}),
    ...(points !== undefined ? { basePoints: points } : {}),
    associations: entry.associations ?? [],
    constraints: entry.constraints ?? [],
    sources: ['bsdata'],
  }
}

/**
 * Detachments are the entries that carry a non-zero Detachment Points cost.
 * That is the game system's own vocabulary for the 11e modular detachment
 * system, so it holds for any faction. Their remaining category links are the
 * Force Disposition(s) they may field.
 *
 * Verified 2026-09-13: this yields exactly the set the MFM mirror lists. The
 * `NDP Detachment` category noted in spec Appendix A.1 no longer exists in
 * catalogue revision 3 — do not key off it.
 */
function collectDetachments(cat: Catalogue, index: Index): Detachment[] {
  const detachments: Detachment[] = []
  const seen = new Set<string>()

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!node || typeof node !== 'object') return
    const entry = node as SelectionEntry
    const dp = entry.costs?.find((c) => c.typeId === COST_TYPE.detachmentPoints)?.value
    if (dp !== undefined && dp > 0 && entry.id && !seen.has(entry.id)) {
      seen.add(entry.id)
      const dispositions = (entry.categoryLinks ?? [])
        .map((l) => index.categories.get(l.targetId)?.name ?? l.name ?? '')
        .filter((name) => name && !/detachment/i.test(name))
      detachments.push({
        id: entry.id,
        name: entry.name,
        dp,
        forceDispositions: dispositions,
        enhancements: [],
        sources: ['bsdata'],
      })
    }
    for (const value of Object.values(node as Record<string, unknown>))
      if (value && typeof value === 'object') visit(value)
  }

  visit(cat)
  return detachments
}

export function parseCatalogue(gs: GameSystem, cat: Catalogue): ParsedCatalogue {
  const index = buildIndex(gs, cat)
  const unsupported: string[] = []

  // A datasheet is a shared entry with a primary category link — that link is
  // the battlefield role, and only real datasheets carry one. Configuration is
  // the roster's own setup entry (the detachment picker), not a unit.
  const datasheets = (cat.sharedSelectionEntries ?? [])
    .filter((e) => (e.categoryLinks ?? []).some((l) => l.primary) && !e.hidden)
    .map((e) => toDatasheet(e, index))
    .filter((d) => d.role !== CONFIGURATION_ROLE)
    .sort((a, b) => a.name.localeCompare(b.name))

  const detachments = collectDetachments(cat, index).sort((a, b) => a.name.localeCompare(b.name))

  const rules: Ability[] = [...index.rules.values()].map((r) => ({
    id: r.id,
    name: r.name,
    kind: 'core',
    text: r.description ?? '',
  }))

  if (datasheets.length === 0) unsupported.push('No datasheets found — primary category links missing?')
  if (detachments.length === 0) unsupported.push('No detachments found — Detachment Points cost missing?')

  return {
    id: cat.id,
    name: cat.name,
    revision: cat.revision,
    gameSystemId: cat.gameSystemId,
    ...(cat.gameSystemRevision !== undefined ? { gameSystemRevision: cat.gameSystemRevision } : {}),
    datasheets,
    detachments,
    rules,
    unsupported,
  }
}
