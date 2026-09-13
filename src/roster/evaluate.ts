/**
 * The generic BattleScribe constraint evaluator (spec §5.3, layer 1).
 *
 * This is what makes "1 rokkit per 10 Boyz", "max 3 of a datasheet", Epic Hero
 * uniqueness, enhancement limits and Requisition Thresholds work without any of
 * them being hand-coded — and it is why adding a faction costs no code.
 *
 * The model: a roster is a tree of selection instances. For each instance we
 * resolve its catalogue entry, apply the modifiers whose conditions hold, then
 * test the resulting constraints. Queries count selections (or sum costs) within
 * a scope, which is a node found by walking the instance tree.
 *
 * Anything the data uses that is not modelled here is collected in `unsupported`
 * rather than silently ignored, so gaps are visible instead of becoming wrong
 * validation results.
 */

import type {
  Condition,
  ConditionGroup,
  Constraint,
  LocalConditionGroup,
  Modifier,
  ModifierGroup,
  Repeat,
} from '@/data/bsdata/schema'
import { COST_TYPE } from '@/data/bsdata/schema'
import type { CatalogueGraph, ResolvedEntry, ResolvedGroup } from './resolve'
import type { Roster, Selection, ValidationIssue } from './types'

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
  /** Position among siblings. */
  ordinal: number
  /** Depth-first position in the whole roster, so "before" has a total order. */
  order: number
  /**
   * Option groups are not selections, so they get no node of their own — but
   * they carry the constraints that make "1 in 10 may take …" work. They are
   * evaluated in the context of the selection that owns them.
   */
  groups: GroupContext[]
}

/** A group's constraints, bound to the selection that owns it. */
type GroupContext = {
  group: ResolvedGroup
  /** Entry ids that count towards this group, including nested groups. */
  entryIds: Set<string>
  constraints: Map<string, Constraint>
}

export type EvaluationResult = {
  issues: ValidationIssue[]
  /** Total points, including per-copy costs and Requisition surcharges. */
  points: number
  /** Detachment Points spent. */
  detachmentPoints: number
  /** Enhancements taken. */
  enhancements: number
  unsupported: string[]
}

export function evaluateRoster(roster: Roster, graph: CatalogueGraph): EvaluationResult {
  const unsupported: string[] = []
  const issues: ValidationIssue[] = []

  const roots: Node[] = []
  roster.selections.forEach((selection, index) => {
    const node = build(selection, undefined, index, graph, unsupported)
    if (node) roots.push(node)
    else unsupported.push(`Unknown catalogue entry ${selection.entryId} ("${selection.name}")`)
  })

  const all: Node[] = []
  const collect = (node: Node) => {
    node.order = all.length
    all.push(node)
    node.children.forEach(collect)
  }
  roots.forEach(collect)

  const context: Context = { roots, all, unsupported }

  // Modifiers first: a constraint's limit and a selection's cost can both be
  // changed by one, so nothing may be read before they have all been applied.
  for (const node of all) applyModifiers(node, context)

  for (const node of all) {
    checkConstraints(node, context, issues)
    checkGroupConstraints(node, context, issues)
  }

  let points = 0
  let detachmentPoints = 0
  let enhancements = 0
  for (const node of all) {
    const copies = node.selection.count
    points += (node.costs[COST_TYPE.points] ?? 0) * copies
    detachmentPoints += (node.costs[COST_TYPE.detachmentPoints] ?? 0) * copies
    enhancements += (node.costs[COST_TYPE.enhancements] ?? 0) * copies
  }

  return { issues, points, detachmentPoints, enhancements, unsupported }
}

type Context = {
  roots: Node[]
  all: Node[]
  unsupported: string[]
}

/** Flattens an entry's option groups, keeping nested groups as their own context. */
function collectGroups(groups: ResolvedGroup[]): GroupContext[] {
  const out: GroupContext[] = []
  for (const group of groups) {
    out.push({
      group,
      entryIds: groupEntryIds(group),
      constraints: new Map(group.constraints.map((c) => [c.id, { ...c }])),
    })
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

function build(
  selection: Selection,
  parent: Node | undefined,
  ordinal: number,
  graph: CatalogueGraph,
  unsupported: string[],
): Node | undefined {
  const entry = graph.resolve(selection.entryId)
  if (!entry) return undefined

  const node: Node = {
    selection,
    entry,
    parent,
    children: [],
    costs: { ...entry.costs },
    constraints: new Map(entry.constraints.map((c) => [c.id, { ...c }])),
    categoryIds: new Set(entry.categoryIds),
    ordinal,
    order: 0,
    groups: collectGroups(entry.groups),
  }

  selection.selections.forEach((child, index) => {
    const built = build(child, node, index, graph, unsupported)
    if (built) node.children.push(built)
    else unsupported.push(`Unknown catalogue entry ${child.entryId} ("${child.name}")`)
  })

  return node
}

// --- scope resolution -------------------------------------------------------

/**
 * Finds the node a scope names, relative to `node`. Scopes that address the
 * whole roster return undefined, which callers read as "search everything".
 */
function resolveScope(node: Node, scope: string, context: Context): Node | undefined | 'all' {
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
      // Handled by callers that need every ancestor; as a single scope it means
      // the immediate chain, so the nearest ancestor is the right answer.
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

/** The nodes a query looks at: a scope, optionally including its descendants. */
function queryNodes(
  node: Node,
  scope: string,
  includeChildSelections: boolean,
  context: Context,
): Node[] {
  const target = resolveScope(node, scope, context)
  if (target === undefined) return []
  if (target === 'all') return context.all
  return includeChildSelections ? subtree(target) : [target, ...target.children]
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
  shared?: boolean
}

/**
 * Evaluates a query to a number: a count of matching selections, or a sum of one
 * cost type. `self` excludes the node itself from a count, matching
 * BattleScribe: a constraint counts what is *inside* its scope.
 */
function queryValue(node: Node, query: Query, context: Context): number {
  const nodes = queryNodes(node, query.scope, query.includeChildSelections ?? false, context)
  const pool = query.scope === 'self' ? nodes.filter((n) => n !== node) : nodes

  if (query.field === 'selections') {
    return pool.filter((n) => matches(n, query.childId)).reduce((sum, n) => sum + n.selection.count, 0)
  }
  if (query.field === 'forces') {
    // One force per roster in this app; a forces query is a roster-level count.
    return 1
  }
  if (query.field === 'associations') {
    return 0
  }
  // Otherwise the field is a cost type id.
  return pool
    .filter((n) => matches(n, query.childId))
    .reduce((sum, n) => sum + (n.costs[query.field] ?? 0) * n.selection.count, 0)
}

// --- conditions -------------------------------------------------------------

function testCondition(node: Node, condition: Condition, context: Context): boolean {
  const query: Query = {
    field: condition.field,
    scope: condition.scope,
    ...(condition.childId !== undefined ? { childId: condition.childId } : {}),
    ...(condition.includeChildSelections !== undefined
      ? { includeChildSelections: condition.includeChildSelections }
      : {}),
  }

  switch (condition.type) {
    case 'instanceOf':
      return countInstances(node, condition, context) >= condition.value
    case 'notInstanceOf':
      return countInstances(node, condition, context) < condition.value
    case 'atLeast':
      return queryValue(node, query, context) >= condition.value
    case 'atMost':
      return queryValue(node, query, context) <= condition.value
    case 'equalTo':
      return queryValue(node, query, context) === condition.value
    case 'greaterThan':
      return queryValue(node, query, context) > condition.value
    case 'lessThan':
      return queryValue(node, query, context) < condition.value
    case 'before':
      // Ordinal position among prior siblings matching childId — this is how
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
  const target = resolveScope(node, condition.scope, context)
  if (target === undefined) return 0
  const pool =
    target === 'all'
      ? context.all
      : condition.includeChildSelections
        ? subtree(target)
        : [target]
  return pool.filter((n) => matches(n, condition.childId)).length
}

function countBefore(node: Node, condition: Condition, context: Context): number {
  return context.all
    .filter((other) => precedes(other, node) && matches(other, condition.childId))
    .reduce((sum, other) => sum + other.selection.count, 0)
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
  const candidates = queryNodes(
    node,
    local.scope,
    local.includeChildSelections ?? false,
    context,
  ).filter((candidate) => candidate !== node && matches(candidate, node.entry.id))

  const passing = candidates.filter((candidate) =>
    (local.conditions ?? []).every((condition) =>
      condition.type === 'before'
        ? precedes(candidate, node)
        : testCondition(candidate, condition, context),
    ),
  )
  const count = passing.reduce((sum, candidate) => sum + candidate.selection.count, 0)
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
    const value = queryValue(
      node,
      {
        field: repeat.field,
        scope: repeat.scope,
        ...(repeat.childId !== undefined ? { childId: repeat.childId } : {}),
        ...(repeat.includeChildSelections !== undefined
          ? { includeChildSelections: repeat.includeChildSelections }
          : {}),
      },
      context,
    )
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
      if (constraint || modifier.field in node.costs || isCostField(modifier.field)) {
        if (!Number.isNaN(numeric)) writeTarget(numeric)
      }
      // Presentation-only fields (name, hidden, category) do not affect legality.
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
      if (typeof modifier.value === 'string') node.categoryIds.add(modifier.value)
      return
    case 'remove':
      if (typeof modifier.value === 'string') node.categoryIds.delete(modifier.value)
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

const isCostField = (field: string): boolean =>
  field === COST_TYPE.points ||
  field === COST_TYPE.detachmentPoints ||
  field === COST_TYPE.enhancements

// --- constraints ------------------------------------------------------------

function checkConstraints(node: Node, context: Context, issues: ValidationIssue[]): void {
  for (const constraint of node.constraints.values()) {
    // A negative limit means "unbounded" in BattleScribe.
    if (constraint.value < 0) continue

    // A constraint with no childId counts instances of the entry that owns it —
    // "max 6 @force" on a unit means six of *that* unit, not six of anything.
    const actual = queryValue(
      node,
      {
        field: constraint.field,
        scope: constraint.scope,
        childId: constraint.childId ?? node.entry.id,
        ...(constraint.includeChildSelections !== undefined
          ? { includeChildSelections: constraint.includeChildSelections }
          : {}),
      },
      context,
    )

    const broken =
      constraint.type === 'max' ? actual > constraint.value : actual < constraint.value
    if (!broken) continue

    // A min of 0 that is unmet is not a real failure, and an unselected optional
    // group would otherwise shout on every empty roster.
    if (constraint.type === 'min' && constraint.value === 0) continue

    issues.push({
      severity: 'error',
      selectionId: node.selection.id,
      message:
        constraint.message ??
        `${node.selection.name}: ${describe(constraint, node)} (has ${actual})`,
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
    for (const modifier of ctx.group.modifiers) applyModifierTo(node, ctx, modifier, context)
    for (const group of ctx.group.modifierGroups)
      applyModifierGroupTo(node, ctx, group, context)

    for (const constraint of ctx.constraints.values()) {
      if (constraint.value < 0) continue
      const actual = countInGroup(node, ctx, constraint.includeChildSelections ?? false)
      const broken =
        constraint.type === 'max' ? actual > constraint.value : actual < constraint.value
      if (!broken) continue
      if (constraint.type === 'min' && constraint.value === 0) continue

      issues.push({
        severity: 'error',
        selectionId: node.selection.id,
        message:
          constraint.message ??
          `${node.selection.name} — ${ctx.group.name}: ${
            constraint.type === 'max' ? 'at most' : 'at least'
          } ${constraint.value} selections (has ${actual})`,
        rule: `BattleScribe constraint ${constraint.id}`,
      })
    }
  }
}

function countInGroup(node: Node, ctx: GroupContext, deep: boolean): number {
  const pool = deep ? subtree(node).filter((n) => n !== node) : node.children
  return pool
    .filter((child) => ctx.entryIds.has(child.entry.id))
    .reduce((sum, child) => sum + child.selection.count, 0)
}

/** A modifier on a group can only change that group's own constraints. */
function applyModifierTo(
  node: Node,
  ctx: GroupContext,
  modifier: Modifier,
  context: Context,
): void {
  if (!conditionsHold(node, modifier.conditions, modifier.conditionGroups, context)) return
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

function describe(constraint: Constraint, node: Node): string {
  const what = constraint.childName ?? (constraint.childId === 'model' ? 'models' : 'selections')
  const where =
    constraint.scope === 'self'
      ? 'in this selection'
      : constraint.scope === 'parent'
        ? 'in this group'
        : constraint.scope === 'roster' || constraint.scope === 'force'
          ? 'in the army'
          : `in ${constraint.scope}`
  const limit = constraint.type === 'max' ? 'at most' : 'at least'
  return `${limit} ${constraint.value} ${what} ${where}${node.entry.name ? '' : ''}`
}
