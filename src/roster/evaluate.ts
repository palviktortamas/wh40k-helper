/**
 * The generic BattleScribe constraint evaluator (spec §5.3, layer 1).
 *
 * This is what makes "1 rokkit per 10 Boyz", "max 3 of a datasheet", Epic Hero
 * uniqueness, enhancement limits and Requisition Thresholds work without any of
 * them being hand-coded — and it is why adding a faction costs no code.
 *
 * The model: a roster is a tree of selection instances. For each instance we
 * resolve its catalogue entry *in the context of its parent* (a link can add
 * constraints and costs on top of a shared entry), apply the modifiers whose
 * conditions hold, then test the resulting constraints. Queries count
 * selections (or sum costs) within a scope, which is a node found by walking
 * the instance tree; a scope's whole subtree is searched.
 *
 * Counts are per copy of the parent (see `Selection.count`). A node's absolute
 * count is the product of the counts on its path, and a query reports counts
 * relative to the scope it looks from.
 *
 * Anything the data uses that is not modelled here is collected in `unsupported`
 * rather than silently ignored, so gaps are visible instead of becoming wrong
 * validation results.
 */

import type {
  Association,
  Condition,
  ConditionGroup,
  Constraint,
  LocalConditionGroup,
  Modifier,
  ModifierGroup,
  Repeat,
} from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'
import { childOptions, type CatalogueGraph, type ResolvedEntry, type ResolvedGroup } from './resolve'
import type { Roster, Selection, ValidationIssue } from './types'
import {
  ASSOCIATION_LABELS,
  CHARACTER_CATEGORY,
  WARLORD_CATEGORY,
  associationGroupIdForLabel,
} from './vocabulary'

/** One selection instance with its resolved entry and computed values. */
type Node = {
  selection: Selection
  entry: ResolvedEntry
  parent: Node | undefined
  children: Node[]
  /** Effective costs after modifiers, by cost type id, for one copy. */
  costs: Record<string, number>
  /** Effective constraints after modifiers, keyed by constraint id. */
  constraints: Map<string, Constraint>
  categoryIds: Set<string>
  /** Count multiplied through every ancestor — the number of these in the roster. */
  absolute: number
  /** Depth-first position in the whole roster, so "before" has a total order. */
  order: number
  /** After modifiers: the data says this option is not offered here. */
  hidden: boolean
  /**
   * Option groups are not selections, so they get no node of their own — but
   * they carry the constraints that make "1 in 10 may take …" work. They are
   * evaluated in the context of the selection that owns them.
   */
  groups: GroupContext[]
  /** Issues raised by `add error` / `add warning` modifiers. */
  extra: ValidationIssue[]
  /** Leader attachment, resolved both ways. */
  attached?: { target: Node; association: Association }
  attachedLeaders: { leader: Node; association: Association }[]
  /**
   * Force entries and category entries carry constraints but are not
   * selections. They are evaluated as virtual nodes that see the whole roster.
   */
  virtual: boolean
}

/** A group's constraints, bound to the selection that owns it. */
type GroupContext = {
  group: ResolvedGroup
  /** Entry ids that count towards this group, including nested groups. */
  entryIds: Set<string>
  constraints: Map<string, Constraint>
  hidden: boolean
}

export type EvaluationResult = {
  issues: ValidationIssue[]
  /** Total points, including per-copy costs and Requisition surcharges. */
  points: number
  /** Points per root selection id, after modifiers — what the export prints. */
  unitPoints: Record<string, number>
  /** Detachment Points spent, the detachment's own cost included. */
  detachmentPoints: number
  /** Enhancements taken. */
  enhancements: number
  /** Whether the data itself enforced the points limit, so layer 2 need not. */
  pointsLimitChecked: boolean
  /** Whether the data itself requires a Warlord, so layer 2 need not repeat it. */
  warlordChecked: boolean
  /**
   * The chosen detachments, in the order they were taken, read from the
   * configuration selections. An 11e army takes as many as its Detachment
   * Points budget allows (spec §5.3).
   */
  detachments: { selectionId: string; entryId: string; name: string; dp: number }[]
  /**
   * The Detachment Points the army may spend, from the game system's own `max`
   * constraint after modifiers — so it follows the battle size without this
   * code knowing any edition's numbers. Undefined when the data sets no cap.
   */
  detachmentPointsLimit?: number
  /** The root selection holding the Warlord upgrade, if any. */
  warlordSelectionId?: string
  /** Root selections whose entry carries the Character category. */
  characterSelectionIds: string[]
  /**
   * Per selection id: how many more copies its tightest `max` constraint allows
   * (0 = at the limit, negative = already over). Only selections that carry a
   * cap on themselves appear. Lets the editor stop at the limit (spec §5.2).
   */
  headroom: Record<string, number>
  /** Per `${ownerSelectionId}:${groupId}`: room left in an option group's `max`. */
  groupHeadroom: Record<string, number>
  unsupported: string[]
}

/** Evaluation plus the questions the editor asks about options not yet taken. */
export type Analysis = EvaluationResult & {
  /**
   * Would `entry` be offered under `parentSelectionId` (undefined = as a root)?
   * Pass the group it sits in: a hidden group hides everything inside it.
   */
  isEntryAvailable: (
    parentSelectionId: string | undefined,
    entry: ResolvedEntry,
    group?: ResolvedGroup,
  ) => boolean
  isGroupAvailable: (parentSelectionId: string, group: ResolvedGroup) => boolean
  /** Root selection ids `leaderSelectionId` may attach to, per association. */
  leaderTargets: (
    leaderSelectionId: string,
  ) => { association: Association; targetIds: string[] }[]
}

export function evaluateRoster(roster: Roster, graph: CatalogueGraph): EvaluationResult {
  return analyseRoster(roster, graph)
}

export function analyseRoster(roster: Roster, graph: CatalogueGraph): Analysis {
  const unsupported: string[] = []
  const issues: ValidationIssue[] = []
  const categoryByName = new Map<string, string>()
  for (const category of graph.categories.values()) categoryByName.set(category.name, category.id)

  const context: Context = {
    graph,
    roots: [],
    all: [],
    byId: new Map(),
    unsupported,
    forceId: graph.forceEntries.find((f) => !f.hidden)?.id,
    emitted: new Set(),
    headroom: new Map(),
    groupHeadroom: new Map(),
  }

  const roots = context.roots
  const addRoot = (selection: Selection, index: number) => {
    const node = build(selection, undefined, context)
    if (node) roots.push(node)
    else unsupported.push(`Unknown catalogue entry ${selection.entryId} ("${selection.name}")`)
    return index
  }
  roster.configuration.forEach(addRoot)
  roster.selections.forEach(addRoot)

  const collect = (node: Node) => {
    node.order = context.all.length
    context.all.push(node)
    context.byId.set(node.selection.id, node)
    node.children.forEach(collect)
  }
  roots.forEach(collect)

  linkAssociations(roots, context, issues)

  // Modifiers first: a constraint's limit and a selection's cost can both be
  // changed by one, so nothing may be read before they have all been applied.
  for (const node of context.all) applyModifiers(node, context)
  const virtuals = virtualNodes(context)
  for (const node of virtuals) applyModifiers(node, context)

  for (const node of context.all) {
    checkHidden(node, issues)
    checkConstraints(node, context, issues)
    checkGroupConstraints(node, context, issues)
    checkAttachment(node, context, issues)
    issues.push(...node.extra)
  }
  let pointsLimitChecked = false
  for (const node of virtuals) {
    checkConstraints(node, context, issues)
    issues.push(...node.extra)
    if (
      [...node.constraints.values()].some(
        (c) => c.field === COST_TYPE.points && c.type === 'max' && c.value >= 0,
      )
    )
      pointsLimitChecked = true
  }

  let points = 0
  let detachmentPoints = 0
  let enhancements = 0
  const unitPoints: Record<string, number> = {}
  for (const root of roots) {
    let unit = 0
    for (const node of subtree(root)) {
      unit += (node.costs[COST_TYPE.points] ?? 0) * node.absolute
      detachmentPoints += (node.costs[COST_TYPE.detachmentPoints] ?? 0) * node.absolute
      enhancements += (node.costs[COST_TYPE.enhancements] ?? 0) * node.absolute
    }
    unitPoints[root.selection.id] = unit
    points += unit
  }

  const detachmentNodes = context.all.filter((n) => (n.costs[COST_TYPE.detachmentPoints] ?? 0) > 0)
  // The budget lives on the force entry as a `max` on the cost type; modifiers
  // have already raised or lowered it for the battle size chosen.
  const detachmentPointsLimit = virtuals
    .flatMap((n) => [...n.constraints.values()])
    .filter((c) => c.field === COST_TYPE.detachmentPoints && c.type === 'max' && c.value >= 0)
    .reduce<number | undefined>((min, c) => (min === undefined ? c.value : Math.min(min, c.value)), undefined)
  const warlordCategory = categoryByName.get(WARLORD_CATEGORY)
  const warlordChecked = virtuals.some(
    (n) =>
      n.entry.id === warlordCategory &&
      [...n.constraints.values()].some((c) => c.type === 'min' && c.value >= 1),
  )
  const warlordNode = warlordCategory
    ? context.all.find((n) => n.categoryIds.has(warlordCategory))
    : undefined
  const characterCategory = categoryByName.get(CHARACTER_CATEGORY)

  const result: EvaluationResult = {
    issues,
    points,
    unitPoints,
    detachmentPoints,
    enhancements,
    pointsLimitChecked,
    warlordChecked,
    detachments: detachmentNodes.map((node) => ({
      selectionId: node.selection.id,
      entryId: node.entry.id,
      name: node.selection.name,
      dp: node.costs[COST_TYPE.detachmentPoints] ?? 0,
    })),
    ...(detachmentPointsLimit === undefined ? {} : { detachmentPointsLimit }),
    ...(warlordNode ? { warlordSelectionId: rootOf(warlordNode).selection.id } : {}),
    characterSelectionIds: characterCategory
      ? roots.filter((r) => r.categoryIds.has(characterCategory)).map((r) => r.selection.id)
      : [],
    headroom: Object.fromEntries(context.headroom),
    groupHeadroom: Object.fromEntries(context.groupHeadroom),
    unsupported,
  }

  return {
    ...result,
    isEntryAvailable: (parentSelectionId, entry, group) => {
      const parent = parentSelectionId ? context.byId.get(parentSelectionId) : undefined
      if (parentSelectionId && !parent) return false
      if (parent && group) {
        const ctx = groupContext(group)
        applyGroupModifiers(parent, ctx, context)
        if (ctx.hidden) return false
      }
      // A phantom node: parented for scope resolution, but never counted.
      const phantom = makeNode(
        { id: 'phantom', entryId: entry.id, name: entry.name, type: entry.type, count: 1, selections: [] },
        entry,
        parent,
      )
      applyModifiers(phantom, context)
      return !phantom.hidden
    },
    isGroupAvailable: (parentSelectionId, group) => {
      const parent = context.byId.get(parentSelectionId)
      if (!parent) return false
      const ctx = groupContext(group)
      applyGroupModifiers(parent, ctx, context)
      return !ctx.hidden
    },
    leaderTargets: (leaderSelectionId) => {
      const leader = context.byId.get(leaderSelectionId)
      if (!leader) return []
      return leader.entry.associations
        .filter((a) => a.action === 'group')
        .map((association) => ({
          association,
          targetIds: roots
            .filter((candidate) => candidate !== leader && eligible(leader, association, candidate, context))
            .map((candidate) => candidate.selection.id),
        }))
    },
  }
}

type Context = {
  graph: CatalogueGraph
  roots: Node[]
  all: Node[]
  byId: Map<string, Node>
  unsupported: string[]
  forceId: string | undefined
  /** Army-wide constraints already reported, so seven copies give one message. */
  emitted: Set<string>
  /** How many more of each selection its tightest `max` allows (see EvaluationResult.headroom). */
  headroom: Map<string, number>
  groupHeadroom: Map<string, number>
  /**
   * Set while a group's own modifiers are evaluated against the selection that
   * owns the group. A group is not a selection, so for its conditions the owner
   * is the first `ancestor` — BattleScribe hides "Enhancements" with
   * `ancestor notInstanceOf Character`, which must see the Character itself.
   */
  groupOwner?: Node
}

// --- building the tree --------------------------------------------------------

function groupContext(group: ResolvedGroup): GroupContext {
  return {
    group,
    entryIds: groupEntryIds(group),
    constraints: new Map(group.constraints.map((c) => [c.id, { ...c }])),
    hidden: group.hidden,
  }
}

/** Flattens an entry's option groups, keeping nested groups as their own context. */
function collectGroups(groups: ResolvedGroup[]): GroupContext[] {
  const out: GroupContext[] = []
  for (const group of groups) {
    out.push(groupContext(group))
    out.push(...collectGroups(group.groups))
  }
  return out
}

/** Every entry that counts towards a group, including those in nested groups. */
function groupEntryIds(group: ResolvedGroup): Set<string> {
  const ids = new Set<string>()
  const walk = (g: ResolvedGroup) => {
    for (const entry of g.entries) ids.add(entry.id)
    for (const nested of g.groups) walk(nested)
  }
  walk(group)
  return ids
}

function makeNode(selection: Selection, entry: ResolvedEntry, parent: Node | undefined): Node {
  return {
    selection,
    entry,
    parent,
    children: [],
    costs: { ...entry.costs },
    constraints: new Map(entry.constraints.map((c) => [c.id, { ...c }])),
    categoryIds: new Set(entry.categoryIds),
    absolute: selection.count * (parent?.absolute ?? 1),
    order: 0,
    hidden: entry.hidden,
    groups: collectGroups(entry.groups),
    extra: [],
    attachedLeaders: [],
    virtual: false,
  }
}

/**
 * Finds the resolved entry a child selection instantiates *within its parent*:
 * the same shared entry can arrive through different links, each adding its
 * own constraints and costs, so the bare entry is not enough.
 */
function childEntry(parent: Node, selection: Selection): ResolvedEntry | undefined {
  const candidates = childOptions(parent.entry).filter((o) => o.entry.id === selection.entryId)
  if (candidates.length === 0) return undefined
  if (selection.linkId) {
    const byLink = candidates.find((o) => o.entry.linkId === selection.linkId)
    if (byLink) return byLink.entry
  }
  if (selection.groupId) {
    const byGroup = candidates.find((o) => o.group?.id === selection.groupId)
    if (byGroup) return byGroup.entry
  }
  return candidates[0]!.entry
}

function build(selection: Selection, parent: Node | undefined, context: Context): Node | undefined {
  let entry = parent ? childEntry(parent, selection) : context.graph.resolve(selection.entryId)
  if (!entry && parent) {
    // The data no longer offers this here (or the roster predates the link
    // field). Fall back to the bare entry so the selection is still validated.
    entry = context.graph.resolve(selection.entryId)
    if (entry)
      context.unsupported.push(
        `"${selection.name}" is no longer an option of "${parent.selection.name}"`,
      )
  }
  if (!entry) return undefined

  const node = makeNode(selection, entry, parent)
  for (const child of selection.selections) {
    const built = build(child, node, context)
    if (built) node.children.push(built)
    else context.unsupported.push(`Unknown catalogue entry ${child.entryId} ("${child.name}")`)
  }
  return node
}

/** Force entries and category entries as constraint owners over the whole roster. */
function virtualNodes(context: Context): Node[] {
  const { graph } = context
  const out: Node[] = []
  const virtual = (
    id: string,
    name: string,
    constraints: Constraint[] | undefined,
    modifiers: Modifier[] | undefined,
    modifierGroups: ModifierGroup[] | undefined,
    defaultChildId: string | undefined,
  ) => {
    if (!constraints?.length && !modifiers?.length && !modifierGroups?.length) return
    const entry: ResolvedEntry = {
      id,
      name,
      type: 'upgrade',
      hidden: false,
      costs: {},
      // A category's constraint counts members of that category.
      constraints: (constraints ?? []).map((c) =>
        c.childId === undefined && defaultChildId ? { ...c, childId: defaultChildId } : c,
      ),
      modifiers: modifiers ?? [],
      modifierGroups: modifierGroups ?? [],
      associations: [],
      categoryIds: [],
      groups: [],
      entries: [],
    }
    const node = makeNode(
      { id: `virtual-${id}`, entryId: id, name, type: 'upgrade', count: 1, selections: [] },
      entry,
      undefined,
    )
    node.virtual = true
    out.push(node)
  }

  const force = graph.forceEntries.find((f) => f.id === context.forceId)
  if (force) {
    // Cost limits on the force sum every selection, whatever its entry.
    virtual(force.id, force.name, force.constraints, force.modifiers, undefined, 'any')
    for (const link of force.categoryLinks ?? [])
      virtual(
        `${force.id}/${link.targetId}`,
        link.name ?? graph.categories.get(link.targetId)?.name ?? 'Category',
        link.constraints,
        link.modifiers,
        undefined,
        link.targetId,
      )
  }
  for (const category of graph.categories.values())
    virtual(category.id, category.name, category.constraints, category.modifiers, undefined, category.id)
  return out
}

// --- associations (leader attachment) ------------------------------------------

function linkAssociations(roots: Node[], context: Context, issues: ValidationIssue[]): void {
  for (const node of roots) {
    const { attachedTo, associationId } = node.selection
    if (!attachedTo) continue
    const target = roots.find((r) => r.selection.id === attachedTo)
    const association = node.entry.associations.find((a) => a.id === associationId)
    if (!target || !association) {
      issues.push({
        severity: 'error',
        selectionId: node.selection.id,
        message: `${node.selection.name} is attached to a unit that is no longer in the army.`,
        rule: 'Core Rules — Leader',
      })
      continue
    }
    node.attached = { target, association }
    target.attachedLeaders.push({ leader: node, association })
  }
  void context
}

/**
 * Whether `candidate` may be joined by `leader` under `association`. The
 * association's conditions describe the candidate ("is Boyz"), except those
 * flagged `queryFromSelf`, which look at the leader ("has the Kaptin's Hat").
 */
function eligible(leader: Node, association: Association, candidate: Node, context: Context): boolean {
  if (candidate.parent) return false
  if (candidate.virtual) return false
  // `childId: 'unit'` names any unit-level selection, which in a roster is a root.
  if (
    association.childId !== 'unit' &&
    association.childId !== 'any' &&
    !matches(candidate, association.childId)
  )
    return false
  const from = (condition: Condition) => (condition.queryFromSelf ? leader : candidate)
  const direct = (association.conditions ?? []).every((c) => testCondition(from(c), c, context))
  const grouped = (association.conditionGroups ?? []).every((g) =>
    testGroupFrom(leader, candidate, g, context),
  )
  return direct && grouped
}

function testGroupFrom(leader: Node, candidate: Node, group: ConditionGroup, context: Context): boolean {
  const results = [
    ...(group.conditions ?? []).map((c) =>
      testCondition(c.queryFromSelf ? leader : candidate, c, context),
    ),
    ...(group.conditionGroups ?? []).map((g) => testGroupFrom(leader, candidate, g, context)),
    ...(group.localConditionGroups ?? []).map((l) => testLocalGroup(candidate, l, context)),
  ]
  if (results.length === 0) return true
  return group.type === 'or' ? results.some(Boolean) : results.every(Boolean)
}

function checkAttachment(node: Node, context: Context, issues: ValidationIssue[]): void {
  if (!node.attached) return
  const { target, association } = node.attached
  if (!eligible(node, association, target, context)) {
    issues.push({
      severity: 'error',
      selectionId: node.selection.id,
      message: `${node.selection.name} cannot be attached to ${target.selection.name}.`,
      rule: `Datasheet — ${association.label ?? association.name}`,
    })
  }
}

// --- scope resolution -------------------------------------------------------

/**
 * Finds the node a scope names, relative to `node`. Scopes that address the
 * whole roster return 'all'. Virtual owners (force, categories) see everything.
 */
function resolveScope(node: Node, scope: string, context: Context): Node | undefined | 'all' {
  if (node.virtual) return 'all'
  switch (scope) {
    case 'self':
      return node
    case 'parent':
      return node.parent ?? 'all'
    case 'force':
    case 'roster':
    case 'primary-catalogue':
      return 'all'
    case 'root-entry':
      return rootOf(node)
    case 'unit':
      return nearest(node, (n) => n.entry.type === 'unit') ?? rootOf(node)
    case 'model':
      return nearest(node, (n) => n.entry.type === 'model')
    case 'model-or-unit':
      return nearest(node, (n) => n.entry.type === 'model' || n.entry.type === 'unit')
    case 'upgrade':
      return nearest(node, (n) => n.entry.type === 'upgrade')
    case 'ancestor':
      // As a counting scope, the whole chain above; `instanceOf` handles it
      // separately by testing every ancestor.
      return node.parent
    default: {
      // A scope may name a specific entry id: find the nearest ancestor of it.
      const byEntry = nearest(node, (n) => n.entry.id === scope, true)
      if (byEntry) return byEntry
      context.unsupported.push(`Unsupported scope "${scope}"`)
      return undefined
    }
  }
}

const rootOf = (node: Node): Node => {
  let current = node
  while (current.parent) current = current.parent
  return current
}

const nearest = (
  node: Node,
  predicate: (n: Node) => boolean,
  includeSelf = true,
): Node | undefined => {
  let current: Node | undefined = includeSelf ? node : node.parent
  while (current) {
    if (predicate(current)) return current
    current = current.parent
  }
  return undefined
}

const ancestors = (node: Node): Node[] => {
  const out: Node[] = []
  for (let current = node.parent; current; current = current.parent) out.push(current)
  return out
}

// --- queries ----------------------------------------------------------------

const subtree = (node: Node): Node[] => {
  const out: Node[] = []
  const walk = (n: Node) => {
    out.push(n)
    n.children.forEach(walk)
  }
  walk(node)
  return out
}

type Pool = { nodes: Node[]; base: number }

/**
 * The nodes a query looks at — the scope's whole subtree, as BattleScribe
 * searches it — and the absolute count of the scope, so counts can be read
 * relative to it. `self` excludes the node itself: a constraint counts what is
 * *inside* its scope.
 */
function pool(node: Node, scope: string, context: Context, traverse = false): Pool {
  const target = resolveScope(node, scope, context)
  if (target === undefined) return { nodes: [], base: 1 }
  if (target === 'all') return { nodes: context.all, base: 1 }
  let nodes = subtree(target)
  if (scope === 'self') nodes = nodes.filter((n) => n !== node)
  if (traverse) {
    // "Attached unit" limits span the leader and its bodyguard unit together.
    const root = rootOf(target)
    const linked = [
      ...(root.attached ? [root.attached.target] : []),
      ...root.attachedLeaders.map((l) => l.leader),
    ]
    for (const other of linked) nodes = nodes.concat(subtree(other))
  }
  return { nodes, base: target.absolute }
}

/** True when a node is an instance of `childId` — an entry id or a category id. */
const matches = (node: Node, childId: string | undefined): boolean => {
  if (childId === undefined || childId === 'any') return true
  if (childId === 'model') return node.entry.type === 'model'
  if (childId === 'unit') return node.entry.type === 'unit'
  if (childId === 'upgrade') return node.entry.type === 'upgrade'
  return node.entry.id === childId || node.categoryIds.has(childId)
}

type Query = {
  field: string
  scope: string
  childId?: string
  includeChildSelections?: boolean
  traverseAssociationGroup?: boolean
}

/**
 * Evaluates a query to a number: a count of matching selections, or a sum of one
 * cost type, relative to the scope.
 */
function queryValue(node: Node, query: Query, context: Context): number {
  if (query.field === 'forces') {
    // One force per roster in this app.
    return query.childId === undefined || query.childId === context.forceId ? 1 : 0
  }
  if (query.field === 'associations') {
    const target = resolveScope(node, query.scope, context)
    const owner = target === 'all' || target === undefined ? node : target
    const label = query.childId ? ASSOCIATION_LABELS[query.childId] : undefined
    return owner.attachedLeaders.filter((l) => label === undefined || l.association.label === label)
      .length
  }

  const { nodes, base } = pool(node, query.scope, context, query.traverseAssociationGroup)
  const relative = (n: Node) => n.absolute / base

  if (query.field === 'selections') {
    return nodes.filter((n) => matches(n, query.childId)).reduce((sum, n) => sum + relative(n), 0)
  }
  // Otherwise the field is a cost type id.
  return nodes
    .filter((n) => matches(n, query.childId))
    .reduce((sum, n) => sum + (n.costs[query.field] ?? 0) * relative(n), 0)
}

const toQuery = (source: {
  field: string
  scope: string
  childId?: string
  includeChildSelections?: boolean
  traverseAssociationGroup?: boolean
}): Query => ({
  field: source.field,
  scope: source.scope,
  ...(source.childId !== undefined ? { childId: source.childId } : {}),
  ...(source.includeChildSelections !== undefined
    ? { includeChildSelections: source.includeChildSelections }
    : {}),
  ...(source.traverseAssociationGroup !== undefined
    ? { traverseAssociationGroup: source.traverseAssociationGroup }
    : {}),
})

// --- conditions -------------------------------------------------------------

function testCondition(node: Node, condition: Condition, context: Context): boolean {
  switch (condition.type) {
    case 'instanceOf':
      return countInstances(node, condition, context) >= (condition.value ?? 1)
    case 'notInstanceOf':
      return countInstances(node, condition, context) < (condition.value ?? 1)
    case 'atLeast':
      return queryValue(node, toQuery(condition), context) >= condition.value
    case 'atMost':
      return queryValue(node, toQuery(condition), context) <= condition.value
    case 'equalTo':
      return queryValue(node, toQuery(condition), context) === condition.value
    case 'greaterThan':
      return queryValue(node, toQuery(condition), context) > condition.value
    case 'lessThan':
      return queryValue(node, toQuery(condition), context) < condition.value
    case 'before':
      // Ordinal position among prior selections matching childId — this is how
      // Requisition Thresholds ("your 4th+ unit costs more") are encoded.
      return countBefore(node, condition, context) >= condition.value
    default:
      context.unsupported.push(`Unsupported condition "${String(condition.type)}"`)
      return false
  }
}

/**
 * `instanceOf` asks whether the scope *is* (or contains) the given category or
 * entry, rather than counting children.
 */
function countInstances(node: Node, condition: Condition, context: Context): number {
  if (condition.scope === 'primary-catalogue' && condition.childId === context.graph.catalogueId)
    return 1
  if (condition.scope === 'ancestor' && !node.virtual) {
    // For a group's own conditions the owning selection is the first ancestor.
    const chain = context.groupOwner === node ? [node, ...ancestors(node)] : ancestors(node)
    return chain.filter((n) => matches(n, condition.childId)).length
  }
  const target = resolveScope(node, condition.scope, context)
  if (target === undefined) return 0
  const nodes =
    target === 'all'
      ? context.all
      : condition.includeChildSelections
        ? subtree(target)
        : [target]
  return nodes.filter((n) => matches(n, condition.childId)).length
}

function countBefore(node: Node, condition: Condition, context: Context): number {
  return context.all
    .filter((other) => precedes(other, node) && matches(other, condition.childId))
    .reduce((sum, other) => sum + other.absolute, 0)
}

/** Document order: everything earlier in the depth-first walk comes "before". */
const precedes = (a: Node, b: Node): boolean => a.order < b.order

/**
 * A local condition group counts the selections in a scope that individually
 * satisfy its inner conditions, then compares that count against its own value.
 *
 * This is how Requisition Thresholds are encoded: "at least 3 selections of
 * this same entry come before this one" means this is the 4th copy, so the
 * surcharge applies. Without it the surcharge fires on the very first unit.
 */
function testLocalGroup(node: Node, local: LocalConditionGroup, context: Context): boolean {
  const { nodes, base } = pool(node, local.scope, context)
  const candidates = nodes.filter(
    (candidate) => candidate !== node && matches(candidate, local.childId ?? node.entry.id),
  )

  const passing = candidates.filter((candidate) =>
    (local.conditions ?? []).every((condition) =>
      condition.type === 'before'
        ? precedes(candidate, node)
        : testCondition(candidate, condition, context),
    ),
  )
  const count = passing.reduce((sum, candidate) => sum + candidate.absolute / base, 0)
  const value = local.value ?? 0

  switch (local.type) {
    case 'atLeast':
      return count >= value
    case 'atMost':
      return count <= value
    case 'equalTo':
      return count === value
    case 'greaterThan':
      return count > value
    case 'lessThan':
      return count < value
    default:
      context.unsupported.push(`Unsupported local condition group "${local.type}"`)
      return false
  }
}

function testGroup(node: Node, group: ConditionGroup, context: Context): boolean {
  const results = [
    ...(group.conditions ?? []).map((c) => testCondition(node, c, context)),
    ...(group.conditionGroups ?? []).map((g) => testGroup(node, g, context)),
    ...(group.localConditionGroups ?? []).map((l) => testLocalGroup(node, l, context)),
  ]
  if (results.length === 0) return true
  return group.type === 'or' ? results.some(Boolean) : results.every(Boolean)
}

function conditionsHold(
  node: Node,
  conditions: Condition[] | undefined,
  groups: ConditionGroup[] | undefined,
  context: Context,
): boolean {
  const direct = (conditions ?? []).every((c) => testCondition(node, c, context))
  const nested = (groups ?? []).every((g) => testGroup(node, g, context))
  return direct && nested
}

// --- modifiers --------------------------------------------------------------

/** How many times a repeating modifier fires, e.g. "+1 for every 10 models". */
function repeatCount(node: Node, repeats: Repeat[] | undefined, context: Context): number {
  if (!repeats || repeats.length === 0) return 1
  let total = 0
  for (const repeat of repeats) {
    const value = queryValue(node, toQuery(repeat), context)
    if (repeat.value <= 0) continue
    const times = repeat.roundUp
      ? Math.ceil(value / repeat.value)
      : Math.floor(value / repeat.value)
    total += Math.max(0, times) * (repeat.repeats ?? 1)
  }
  return total
}

function applyModifiers(node: Node, context: Context): void {
  for (const modifier of node.entry.modifiers) applyModifier(node, modifier, context)
  for (const group of node.entry.modifierGroups) applyModifierGroup(node, group, context)
}

function applyModifierGroup(node: Node, group: ModifierGroup, context: Context): void {
  if (!conditionsHold(node, group.conditions, group.conditionGroups, context)) return
  const times = repeatCount(node, group.repeats, context)
  for (let i = 0; i < times; i++) {
    for (const modifier of group.modifiers ?? []) applyModifier(node, modifier, context)
    for (const nested of group.modifierGroups ?? []) applyModifierGroup(node, nested, context)
  }
}

const truthy = (value: unknown): boolean => value === true || value === 'true'

function applyModifier(node: Node, modifier: Modifier, context: Context): void {
  if (!conditionsHold(node, modifier.conditions, modifier.conditionGroups, context)) return
  const times = repeatCount(node, modifier.repeats, context)
  if (times <= 0) return

  const numeric = Number(modifier.value)
  const constraint = node.constraints.get(modifier.field)

  // `field` may name a constraint, a cost type, or a plain attribute.
  const readTarget = (): number | undefined =>
    constraint ? constraint.value : node.costs[modifier.field]
  const writeTarget = (value: number) => {
    if (constraint) constraint.value = value
    else node.costs[modifier.field] = value
  }

  switch (modifier.type) {
    case 'set':
      if (modifier.field === 'hidden') {
        // The data's main "you may only take X if Y" gate.
        node.hidden = truthy(modifier.value)
        return
      }
      if (constraint || modifier.field in node.costs || isCostField(modifier.field)) {
        if (!Number.isNaN(numeric)) writeTarget(numeric)
      }
      // Other presentation fields (name, annotation, category) do not affect legality.
      return
    case 'increment': {
      const current = readTarget()
      if (current !== undefined && !Number.isNaN(numeric)) writeTarget(current + numeric * times)
      return
    }
    case 'decrement': {
      const current = readTarget()
      if (current !== undefined && !Number.isNaN(numeric)) writeTarget(current - numeric * times)
      return
    }
    case 'multiply': {
      const current = readTarget()
      if (current !== undefined && !Number.isNaN(numeric)) writeTarget(current * numeric)
      return
    }
    case 'divide': {
      const current = readTarget()
      if (current !== undefined && numeric !== 0 && !Number.isNaN(numeric))
        writeTarget(current / numeric)
      return
    }
    case 'floor': {
      const current = readTarget()
      if (current !== undefined) writeTarget(Math.floor(current))
      return
    }
    case 'add':
      if (modifier.field === 'error' || modifier.field === 'warning') {
        node.extra.push({
          severity: modifier.field,
          ...(node.virtual ? {} : { selectionId: node.selection.id }),
          message: node.virtual ? String(modifier.value) : `${node.selection.name}: ${String(modifier.value)}`,
          rule: 'BattleScribe data rule',
        })
        return
      }
      if (modifier.field === 'category' && typeof modifier.value === 'string')
        node.categoryIds.add(modifier.value)
      return
    case 'remove':
      if (modifier.field === 'category' && typeof modifier.value === 'string')
        node.categoryIds.delete(modifier.value)
      return
    case 'set-primary':
    case 'append':
    case 'replace':
      // Text and primary-category changes are display concerns, not legality.
      return
    default:
      context.unsupported.push(`Unsupported modifier "${String(modifier.type)}"`)
  }
}

/** How many detachments the army holds — an entry costing Detachment Points. */
const detachmentCount = (context: Context): number =>
  context.all.filter((n) => (n.costs[COST_TYPE.detachmentPoints] ?? 0) > 0).length

const isCostField = (field: string): boolean =>
  field === COST_TYPE.points ||
  field === COST_TYPE.detachmentPoints ||
  field === COST_TYPE.enhancements

// --- constraints ------------------------------------------------------------

const ARMY_WIDE = new Set(['roster', 'force', 'primary-catalogue'])

/** Keeps the smallest room seen for a key. */
const tighten = (map: Map<string, number>, key: string, room: number): void => {
  const known = map.get(key)
  if (known === undefined || room < known) map.set(key, room)
}

function checkHidden(node: Node, issues: ValidationIssue[]): void {
  if (!node.hidden) return
  issues.push({
    severity: 'error',
    selectionId: node.selection.id,
    message: `${node.selection.name} is not available with the current army configuration.`,
    rule: 'BattleScribe data — option not offered',
  })
}

function checkConstraints(node: Node, context: Context, issues: ValidationIssue[]): void {
  for (const constraint of node.constraints.values()) {
    // A negative limit means "unbounded" in BattleScribe.
    if (constraint.value < 0) continue

    // A constraint with no childId counts instances of the entry that owns it —
    // "max 6 @force" on a unit means six of *that* unit, not six of anything.
    // A cost-typed constraint ("Enhancements max 1") sums every selection.
    const childId =
      constraint.childId ?? (constraint.field === 'selections' ? node.entry.id : 'any')
    const actual = queryValue(node, { ...toQuery(constraint), childId }, context)

    // Remember how much room a cap leaves on this selection itself, so the
    // editor can stop the "+" button at the limit instead of offering an error.
    if (constraint.type === 'max' && constraint.field === 'selections' && childId === node.entry.id && !node.virtual) {
      const room = constraint.value - actual
      tighten(context.headroom, node.selection.id, room)
      // A cap that reaches beyond the parent ("max 1 rokkit launcha per unit")
      // is also a cap on every option that brings this one with it: one more
      // "Boy w/ Rokkit launcha" is one more rokkit launcha in the unit.
      if (constraint.scope !== 'parent' && constraint.scope !== 'self') {
        for (let a = node.parent; a && a.entry.id !== constraint.scope; a = a.parent) {
          if (a.absolute <= 0) break
          const perCopy = node.absolute / a.absolute
          if (perCopy <= 0) break
          tighten(context.headroom, a.selection.id, Math.floor(room / perCopy))
          if (constraint.scope === 'unit' || constraint.scope === 'model-or-unit') {
            if (!a.parent) break
          }
        }
      }
    }

    const broken =
      constraint.type === 'max' ? actual > constraint.value : actual < constraint.value
    if (!broken) continue

    // One detachment is always yours to take, whatever it costs: the
    // Detachment Points budget governs *combinations*. At a 2 DP battle size
    // that is one 2 DP detachment, one 3 DP detachment, or two of 1 DP — but
    // not a 1 and a 2. The budget itself still comes from the data.
    if (
      constraint.type === 'max' &&
      constraint.field === COST_TYPE.detachmentPoints &&
      detachmentCount(context) <= 1
    )
      continue

    // A min of 0 that is unmet is not a real failure, and an unselected optional
    // group would otherwise shout on every empty roster.
    if (constraint.type === 'min' && constraint.value === 0) continue

    // An army-wide limit is broken by the roster, not by each copy: report once.
    if (ARMY_WIDE.has(constraint.scope) || node.virtual) {
      const key = `${constraint.id}`
      if (context.emitted.has(key)) continue
      context.emitted.add(key)
    }

    issues.push({
      severity: 'error',
      ...(node.virtual ? {} : { selectionId: node.selection.id }),
      message: constraint.message
        ? constraint.message.replace('{value}', String(constraint.value))
        : `${node.selection.name}: ${describe(constraint, node, context)} (has ${actual})`,
      rule: `BattleScribe constraint ${constraint.id}`,
    })
  }
}

/**
 * Checks the constraints that live on an option group. The group is not a
 * selection, so the counted pool is the owning selection's descendants whose
 * entry belongs to that group — which is exactly what "9-18 models" and
 * "at most 3 special weapons" mean.
 */
function checkGroupConstraints(node: Node, context: Context, issues: ValidationIssue[]): void {
  for (const ctx of node.groups) {
    // Group modifiers are evaluated in the owning selection's context, and may
    // raise a limit (more special weapons once the unit is large enough).
    applyGroupModifiers(node, ctx, context)
    if (ctx.hidden) {
      // A hidden group offers nothing: anything taken from it is not available.
      for (const child of node.children) {
        if (!(child.selection.groupId === ctx.group.id) || child.hidden) continue
        child.hidden = true
        issues.push({
          severity: 'error',
          selectionId: child.selection.id,
          message: `${child.selection.name} is not available with the current army configuration.`,
          rule: 'BattleScribe data — option not offered',
        })
      }
      continue
    }

    for (const constraint of ctx.constraints.values()) {
      if (constraint.value < 0) continue
      const actual = countInGroup(node, ctx, constraint.includeChildSelections ?? false)
      if (constraint.type === 'max') {
        const key = `${node.selection.id}:${ctx.group.id}`
        const room = constraint.value - actual
        const known = context.groupHeadroom.get(key)
        if (known === undefined || room < known) context.groupHeadroom.set(key, room)
      }
      const broken =
        constraint.type === 'max' ? actual > constraint.value : actual < constraint.value
      if (!broken) continue
      if (constraint.type === 'min' && constraint.value === 0) continue

      issues.push({
        severity: 'error',
        selectionId: node.selection.id,
        message: constraint.message
          ? constraint.message.replace('{value}', String(constraint.value))
          : `${node.selection.name} — ${ctx.group.name}: ${
              constraint.type === 'max' ? 'at most' : 'at least'
            } ${constraint.value} selections (has ${actual})`,
        rule: `BattleScribe constraint ${constraint.id}`,
      })
    }
  }
}

/**
 * Members of a group under its owner. A child that recorded the group it came
 * from counts only there, so two sibling groups sharing an option list do not
 * both claim one pick.
 */
function countInGroup(node: Node, ctx: GroupContext, deep: boolean): number {
  const nodes = deep ? subtree(node).filter((n) => n !== node) : node.children
  return nodes
    .filter((child) =>
      child.selection.groupId
        ? child.selection.groupId === ctx.group.id ||
          (ctx.entryIds.has(child.entry.id) && nestedGroupIds(ctx.group).has(child.selection.groupId))
        : ctx.entryIds.has(child.entry.id),
    )
    .reduce((sum, child) => sum + child.absolute / node.absolute, 0)
}

const nestedGroupIds = (group: ResolvedGroup): Set<string> => {
  const ids = new Set<string>()
  const walk = (g: ResolvedGroup) => {
    for (const nested of g.groups) {
      ids.add(nested.id)
      walk(nested)
    }
  }
  walk(group)
  return ids
}

function applyGroupModifiers(node: Node, ctx: GroupContext, context: Context): void {
  const previous = context.groupOwner
  context.groupOwner = node
  try {
    for (const modifier of ctx.group.modifiers) applyModifierTo(node, ctx, modifier, context)
    for (const group of ctx.group.modifierGroups) applyModifierGroupTo(node, ctx, group, context)
  } finally {
    if (previous) context.groupOwner = previous
    else delete context.groupOwner
  }
}

/** A modifier on a group can change that group's own constraints, or hide it. */
function applyModifierTo(
  node: Node,
  ctx: GroupContext,
  modifier: Modifier,
  context: Context,
): void {
  if (!conditionsHold(node, modifier.conditions, modifier.conditionGroups, context)) return
  if (modifier.type === 'set' && modifier.field === 'hidden') {
    ctx.hidden = truthy(modifier.value)
    return
  }
  const constraint = ctx.constraints.get(modifier.field)
  if (!constraint) return
  const times = repeatCount(node, modifier.repeats, context)
  if (times <= 0) return
  const numeric = Number(modifier.value)
  if (Number.isNaN(numeric)) return

  switch (modifier.type) {
    case 'set':
      constraint.value = numeric
      return
    case 'increment':
      constraint.value += numeric * times
      return
    case 'decrement':
      constraint.value -= numeric * times
      return
    case 'multiply':
      constraint.value *= numeric
      return
    case 'divide':
      if (numeric !== 0) constraint.value /= numeric
      return
    case 'floor':
      constraint.value = Math.floor(constraint.value)
      return
    default:
      return
  }
}

function applyModifierGroupTo(
  node: Node,
  ctx: GroupContext,
  group: ModifierGroup,
  context: Context,
): void {
  if (!conditionsHold(node, group.conditions, group.conditionGroups, context)) return
  const times = repeatCount(node, group.repeats, context)
  for (let i = 0; i < times; i++) {
    for (const modifier of group.modifiers ?? []) applyModifierTo(node, ctx, modifier, context)
    for (const nested of group.modifierGroups ?? [])
      applyModifierGroupTo(node, ctx, nested, context)
  }
}

function describe(constraint: Constraint, node: Node, context: Context): string {
  const costType = context.graph.costTypes.get(constraint.field)
  const what =
    // An attachment cap counts Leaders or Support characters, not points — and
    // saying "points" here left the owner with nothing to act on.
    constraint.field === 'associations'
      ? (constraint.childName ??
        (constraint.childId ? (ASSOCIATION_LABELS[constraint.childId] ?? 'attached characters') : 'attached characters'))
      : constraint.field !== 'selections'
      ? (costType?.name ?? 'points')
      : (constraint.childName ??
        (constraint.childId === undefined
          ? node.virtual
            ? 'selections'
            : `copies of ${node.selection.name}`
          : constraint.childId === 'model'
            ? 'models'
            : (context.graph.categories.get(constraint.childId)?.name ?? 'selections')))
  const where =
    constraint.scope === 'self'
      ? node.virtual
        ? 'in the army'
        : 'in this selection'
      : constraint.scope === 'parent'
        ? node.virtual
          ? 'in the army'
          : 'in this group'
        : ARMY_WIDE.has(constraint.scope)
          ? 'in the army'
          : constraint.scope === 'unit' || constraint.scope === 'root-entry'
            ? 'in this unit'
            : `in ${constraint.scope}`
  const limit = constraint.type === 'max' ? 'at most' : 'at least'
  return `${limit} ${constraint.value} ${what} ${where}`
}

export { associationGroupIdForLabel }
