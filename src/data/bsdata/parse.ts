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
import { titleCase } from '@/missions/types'
import { abilityText, classifyProfile } from './profiles'
import type {
  Ability,
  Datasheet,
  Detachment,
  ModelEntry,
  ParsedCatalogue,
  UnitStats,
  WeaponProfile,
} from '../model'

/**
 * Bump when the parsed model changes shape or content; installed catalogues
 * with an older number are re-parsed from their stored raw text at app start.
 * 2: datasheet abilities no longer follow group links (Crusade tree), detachment
 *    rules and enhancement texts added (Phase 5).
 * 3: linked library catalogues are indexed; datasheets are discovered through the
 *    catalogue's root entry links (Phase 6, second-faction test).
 * 4: Force Dispositions are stored title-cased whichever source they came from,
 *    so an army holding several detachments shows one casing.
 * 5: weapon profiles reached only through a shared option tree (the Crusade
 *    relics every datasheet links) are flagged `shared`, so the datasheet no
 *    longer offers weapons the unit has no access to.
 * 6: profiles are classified by their characteristics rather than by the name
 *    of their type, so abilities and weapons a codex files under a type of its
 *    own invention (psychic abilities, aura tables, a star god's attacks) are
 *    no longer dropped; an ability keeps that type name as its heading.
 */
export const PARSER_VERSION = 6

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

function buildIndex(gs: GameSystem, cat: Catalogue, libraries: Catalogue[]): Index {
  const index: Index = {
    entries: new Map(),
    groups: new Map(),
    profiles: new Map(),
    rules: new Map(),
    categories: new Map(),
  }

  // Shared nodes are addressed by id from anywhere in these files, so index them
  // all and let the catalogue win on collision (it is the most specific source).
  // Libraries are the catalogues this one imports through `catalogueLinks` -
  // some factions keep every datasheet there and the catalogue is only links.
  for (const source of [gs, ...libraries, cat]) {
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
  /**
   * Whether to follow entry links that point at shared *groups*. A datasheet's
   * own abilities must not: those links are the option trees every unit shares
   * (Crusade upgrades, Enhancements, the Warlord pick), hidden until a
   * condition holds, and following them made every datasheet carry hundreds of
   * abilities that are not its own. Weapons still need them.
   */
  followGroupLinks = true,
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
    if (link.type !== 'selectionEntry' && !followGroupLinks) return
    const target =
      link.type === 'selectionEntry'
        ? index.entries.get(link.targetId)
        : index.groups.get(link.targetId)
    if (!target) return
    out.push(...collectProfiles(target, index, seen, depth + 1, followGroupLinks))
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

const toWeapon = (p: Profile, kind: 'ranged' | 'melee', shared = false): WeaponProfile => ({
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
  ...(shared ? { shared: true } : {}),
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
  // What each profile is, read from its characteristics (see profiles.ts).
  const kindOf = new Map(profiles.map((p) => [p.id, classifyProfile(p)]))
  const ofKind = (kind: 'stats' | 'weapon' | 'transport' | 'ability') =>
    profiles.filter((p) => kindOf.get(p.id)?.kind === kind)
  // Abilities come from the entry, its models and its infoLinks only — see collectProfiles.
  const ownProfiles = collectProfiles(entry, index, new Set(), 0, false)
  // …and so do the weapons the unit has real access to. The shared group links
  // reach the Crusade relic trees, which every datasheet in the game links, so
  // a weapon found only through those is flagged rather than offered.
  const own = new Set(ownProfiles.map((p) => p.id))

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

  const abilities: Ability[] = ownProfiles.flatMap((p) => {
    const kind = classifyProfile(p)
    if (kind?.kind !== 'ability') return []
    return [
      {
        id: p.id,
        name: p.name,
        kind: 'datasheet' as const,
        text: abilityText(p),
        // "Psychic Abilities", "Triarch Abilities": the codex's own heading,
        // without which a row called "1-2" means nothing on its own.
        ...(kind.group ? { group: kind.group } : {}),
      },
    ]
  })
  // Rules linked by infoLink are faction/core rules shared across datasheets.
  for (const link of entry.infoLinks ?? []) {
    if (link.type !== 'rule') continue
    const rule = index.rules.get(link.targetId)
    if (rule) abilities.push({ id: rule.id, name: rule.name, kind: 'faction', text: rule.description ?? '' })
  }

  const transport = ofKind('transport')[0]
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
    stats: ofKind('stats').map(toStats),
    weapons: [
      ...ofKind('weapon')
        .filter((p) => kindOf.get(p.id)?.kind === 'weapon')
        .map((p) => {
          const kind = kindOf.get(p.id)
          const weapon = kind?.kind === 'weapon' ? kind.weapon : 'ranged'
          return toWeapon(p, weapon, !own.has(p.id))
        })
        .sort((a, b) => Number(a.kind === 'melee') - Number(b.kind === 'melee')),
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
      // One casing whatever the source shouts: an army may hold several
      // detachments and show their Force Dispositions side by side.
      const dispositions = (entry.categoryLinks ?? [])
        .map((l) => index.categories.get(l.targetId)?.name ?? l.name ?? '')
        .filter((name) => name && !/detachment/i.test(name))
        .map(titleCase)
      detachments.push({
        id: entry.id,
        name: entry.name,
        dp,
        forceDispositions: dispositions,
        enhancements: [],
        // The detachment's own rules hang off the entry (Phase 5 reminders read them).
        rules: [
          ...(entry.rules ?? []).map((r) => ({ id: r.id, name: r.name, kind: 'detachment' as const, text: r.description ?? '' })),
          ...(entry.infoLinks ?? [])
            .filter((l) => l.type === 'rule')
            .map((l) => index.rules.get(l.targetId))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))
            .map((r) => ({ id: r.id, name: r.name, kind: 'detachment' as const, text: r.description ?? '' })),
        ],
        sources: ['bsdata'],
      })
    }
    for (const value of Object.values(node as Record<string, unknown>))
      if (value && typeof value === 'object') visit(value)
  }

  visit(cat)
  return detachments
}

/**
 * Enhancements are the upgrade entries carrying an Enhancement cost, wherever
 * they sit in the tree; their rules text is an Abilities profile on the entry
 * (or reached through an infoLink). Keyed by entry id — the roster's `entryId`
 * for a taken enhancement — so Play Mode can find the text for a unit's picks.
 */
function collectEnhancements(cat: Catalogue, index: Index): Ability[] {
  const out: Ability[] = []
  const seen = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!node || typeof node !== 'object') return
    const entry = node as SelectionEntry
    const cost = entry.costs?.find((c) => c.typeId === COST_TYPE.enhancements)?.value
    if (cost !== undefined && cost > 0 && entry.id && entry.name && !seen.has(entry.id)) {
      seen.add(entry.id)
      const profiles = collectProfiles(entry, index, new Set())
      const ability = profiles.find((p) => classifyProfile(p)?.kind === 'ability')
      const rule = (entry.rules ?? [])[0]
      out.push({
        id: entry.id,
        name: entry.name,
        kind: 'enhancement',
        text: (ability && abilityText(ability)) || rule?.description || '',
      })
    }
    for (const value of Object.values(node as Record<string, unknown>))
      if (value && typeof value === 'object') visit(value)
  }
  visit(cat)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The entries a catalogue offers at the root of a roster: the targets of its
 * root `entryLinks` (a catalogue that keeps its units in a library has nothing
 * else), the root links of libraries imported with `importRootEntries`, and -
 * as a fallback for older catalogues - its own shared entries with a primary
 * category. Order: link order, then the catalogue's own.
 */
export function rootEntries(
  cat: Catalogue,
  libraries: Catalogue[],
  entries: Map<string, SelectionEntry>,
): SelectionEntry[] {
  const seen = new Set<string>()
  const out: SelectionEntry[] = []
  const add = (e: SelectionEntry | undefined) => {
    if (e && !seen.has(e.id)) {
      seen.add(e.id)
      out.push(e)
    }
  }
  const linkedRoots = (source: Catalogue) => {
    for (const link of source.entryLinks ?? []) {
      if (link.type !== 'selectionEntry' || link.hidden) continue
      add(entries.get(link.targetId))
    }
  }
  linkedRoots(cat)
  const imported = new Set(
    (cat.catalogueLinks ?? []).filter((l) => l.importRootEntries).map((l) => l.targetId),
  )
  for (const lib of libraries) if (imported.has(lib.id)) linkedRoots(lib)
  for (const e of cat.sharedSelectionEntries ?? []) add(e)
  return out
}

export function parseCatalogue(gs: GameSystem, cat: Catalogue, libraries: Catalogue[] = []): ParsedCatalogue {
  const index = buildIndex(gs, cat, libraries)
  const unsupported: string[] = []

  // A datasheet is a root entry with a primary category link - that link is
  // the battlefield role, and only real datasheets carry one. Configuration is
  // the roster's own setup entry (the detachment picker), not a unit.
  // Which library an entry came from, so screens and the source check can tell
  // the faction's own units from imported ones (e.g. Legends fortifications).
  const libraryOf = new Map<string, string>()
  for (const lib of libraries) {
    for (const e of lib.sharedSelectionEntries ?? []) libraryOf.set(e.id, lib.name)
  }
  const datasheets = rootEntries(cat, libraries, index.entries)
    .filter((e) => (e.categoryLinks ?? []).some((l) => l.primary) && !e.hidden)
    .map((e) => {
      const sheet = toDatasheet(e, index)
      const library = libraryOf.get(e.id)
      return library ? { ...sheet, library } : sheet
    })
    .filter((d) => d.role !== CONFIGURATION_ROLE)
    .sort((a, b) => a.name.localeCompare(b.name))

  const detachments = [cat, ...libraries]
    .flatMap((source) =>
      collectDetachments(source, index).map((d) => (source === cat ? d : { ...d, library: source.name })),
    )
    .filter((d, i, all) => all.findIndex((o) => o.id === d.id) === i)
    .sort((a, b) => a.name.localeCompare(b.name))

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
    enhancements: [cat, ...libraries]
      .flatMap((source) => collectEnhancements(source, index))
      .filter((e, i, all) => all.findIndex((o) => o.id === e.id) === i),
    unsupported,
  }
}
