/**
 * BattleScribe data format v2.03, as BSData serialises it to JSON.
 *
 * Verified against `Warhammer 40,000.json` and `Orks.json` on 2026-09-13. Only
 * the constructs the 11e repo actually uses are typed; anything unrecognised is
 * preserved verbatim so the Phase 2 constraint evaluator can still see it.
 *
 * Two traps worth knowing:
 * - Characteristic text lives in a `$text` key, not `value`.
 * - `modifier.field` and `condition.field` are sometimes a *cost type id* or
 *   even a *constraint id* rather than one of the named fields, which is how
 *   points modifiers and conditional constraint limits are expressed.
 */

export type BsId = string

export type Characteristic = {
  name: string
  typeId: BsId
  $text?: string
}

export type Profile = {
  id: BsId
  name: string
  typeId: BsId
  typeName: string
  hidden?: boolean
  characteristics?: Characteristic[]
  modifiers?: Modifier[]
  modifierGroups?: ModifierGroup[]
}

export type Cost = {
  name: string
  typeId: BsId
  value: number
}

export type CostType = {
  id: BsId
  name: string
  defaultCostLimit?: number
  hidden?: boolean
}

export type CharacteristicType = {
  id: BsId
  name: string
  defaultValue?: string
}

export type ProfileType = {
  id: BsId
  name: string
  characteristicTypes: CharacteristicType[]
}

export type CategoryEntry = {
  id: BsId
  name: string
  hidden?: boolean
}

export type CategoryLink = {
  id: BsId
  name?: string
  targetId: BsId
  primary?: boolean
  hidden?: boolean
  constraints?: Constraint[]
  modifiers?: Modifier[]
}

export type ConstraintType = 'min' | 'max'

export type Constraint = {
  id: BsId
  type: ConstraintType
  value: number
  field: string
  scope: string
  childId?: string
  childName?: string
  shared?: boolean
  negative?: boolean
  percentValue?: boolean
  automatic?: boolean
  includeChildSelections?: boolean
  includeChildForces?: boolean
  /** Follows the leader-attachment association group — "attached unit" limits. */
  traverseAssociationGroup?: boolean
  message?: string
}

export type ConditionType =
  | 'instanceOf'
  | 'notInstanceOf'
  | 'atLeast'
  | 'atMost'
  | 'equalTo'
  | 'greaterThan'
  | 'lessThan'
  /** Ordinal position among siblings — how Requisition Thresholds are encoded. */
  | 'before'

export type Condition = {
  id?: BsId
  type: ConditionType
  value: number
  field: string
  scope: string
  childId?: string
  childName?: string
  shared?: boolean
  queryFromSelf?: boolean
  includeChildSelections?: boolean
  includeChildForces?: boolean
  traverseAssociationGroup?: boolean
}

export type ConditionGroup = {
  type: 'and' | 'or'
  conditions?: Condition[]
  conditionGroups?: ConditionGroup[]
  localConditionGroups?: LocalConditionGroup[]
}

/**
 * Counts the selections in `scope` that individually satisfy `conditions`, then
 * compares that count against `value`. Requisition Thresholds are encoded this
 * way: "at least 3 of this entry come before this one".
 */
export type LocalConditionGroup = {
  type: string
  field: string
  scope: string
  value?: number
  childId?: string
  repeats?: number
  includeChildSelections?: boolean
  includeChildForces?: boolean
  conditions?: Condition[]
}

export type ModifierType =
  | 'set'
  | 'append'
  | 'increment'
  | 'decrement'
  | 'add'
  | 'remove'
  | 'multiply'
  | 'divide'
  | 'floor'
  | 'replace'
  | 'set-primary'

export type Repeat = {
  value: number
  repeats?: number
  field: string
  scope: string
  childId?: string
  childName?: string
  roundUp?: boolean
  shared?: boolean
  includeChildSelections?: boolean
  includeChildForces?: boolean
}

export type Modifier = {
  id?: BsId
  type: ModifierType
  /** A named field, a cost type id, or a constraint id. */
  field: string
  value: string | number | boolean
  scope?: string
  affects?: string
  arg?: string
  join?: string
  position?: string
  skipIfPresent?: boolean
  repeats?: Repeat[]
  conditions?: Condition[]
  conditionGroups?: ConditionGroup[]
}

export type ModifierGroup = {
  type?: 'and' | 'or'
  modifiers?: Modifier[]
  modifierGroups?: ModifierGroup[]
  conditions?: Condition[]
  conditionGroups?: ConditionGroup[]
  repeats?: Repeat[]
}

/**
 * Leader / Support attachment. `action: 'group'` joins this unit to another
 * selection in the same force; the condition groups decide which units qualify.
 */
export type Association = {
  id: BsId
  name: string
  label?: string
  action: string
  childId: string
  childName?: string
  scope: string
  min?: number
  max?: number
  includeChildSelections?: boolean
  conditions?: Condition[]
  conditionGroups?: ConditionGroup[]
}

export type InfoLink = {
  id: BsId
  name: string
  targetId: BsId
  type: 'rule' | 'profile' | 'infoGroup'
  hidden?: boolean
  modifiers?: Modifier[]
}

export type Rule = {
  id: BsId
  name: string
  description?: string
  alias?: string
  hidden?: boolean
}

export type SelectionEntryType = 'unit' | 'model' | 'upgrade'

export type SelectionEntry = {
  id: BsId
  name: string
  type: SelectionEntryType
  hidden?: boolean
  collective?: boolean
  import?: boolean
  sortIndex?: number
  costs?: Cost[]
  profiles?: Profile[]
  rules?: Rule[]
  infoLinks?: InfoLink[]
  categoryLinks?: CategoryLink[]
  constraints?: Constraint[]
  modifiers?: Modifier[]
  modifierGroups?: ModifierGroup[]
  associations?: Association[]
  selectionEntries?: SelectionEntry[]
  selectionEntryGroups?: SelectionEntryGroup[]
  entryLinks?: EntryLink[]
}

export type SelectionEntryGroup = {
  id: BsId
  name: string
  hidden?: boolean
  collective?: boolean
  flatten?: boolean
  collapsible?: boolean
  defaultSelectionEntryId?: BsId
  sortIndex?: number
  constraints?: Constraint[]
  modifiers?: Modifier[]
  modifierGroups?: ModifierGroup[]
  selectionEntries?: SelectionEntry[]
  selectionEntryGroups?: SelectionEntryGroup[]
  entryLinks?: EntryLink[]
}

export type EntryLink = {
  id: BsId
  name: string
  targetId: BsId
  type: 'selectionEntry' | 'selectionEntryGroup'
  hidden?: boolean
  collective?: boolean
  sortIndex?: number
  costs?: Cost[]
  constraints?: Constraint[]
  modifiers?: Modifier[]
  modifierGroups?: ModifierGroup[]
  categoryLinks?: CategoryLink[]
  selectionEntries?: SelectionEntry[]
  entryLinks?: EntryLink[]
}

export type CatalogueLink = {
  id: BsId
  name: string
  targetId: BsId
  type: string
  importRootEntries?: boolean
}

type SharedNodes = {
  categoryEntries?: CategoryEntry[]
  entryLinks?: EntryLink[]
  profileTypes?: ProfileType[]
  rules?: Rule[]
  sharedProfiles?: Profile[]
  sharedRules?: Rule[]
  sharedSelectionEntries?: SelectionEntry[]
  sharedSelectionEntryGroups?: SelectionEntryGroup[]
}

export type ForceEntry = {
  id: BsId
  name: string
  hidden?: boolean
  categoryLinks?: CategoryLink[]
  constraints?: Constraint[]
  modifiers?: Modifier[]
  forceEntries?: ForceEntry[]
}

export type GameSystem = SharedNodes & {
  id: BsId
  name: string
  revision: number
  battleScribeVersion: string
  costTypes?: CostType[]
  forceEntries?: ForceEntry[]
}

export type Catalogue = SharedNodes & {
  id: BsId
  name: string
  revision: number
  battleScribeVersion: string
  gameSystemId: BsId
  gameSystemRevision?: number
  library?: boolean
  catalogueLinks?: CatalogueLink[]
}

export type GameSystemFile = { gameSystem: GameSystem }
export type CatalogueFile = { catalogue: Catalogue }

/** Cost type ids, stable in the 11e game system file. */
export const COST_TYPE = {
  points: '51b2-306e-1021-d207',
  detachmentPoints: '82ae-1066-5107-6ae0',
  enhancements: 'f759-1bc4-cb3a-f0d2',
} as const

/** Crusade and Blackstone costs are out of scope (spec §2 non-goals). */
export const IGNORED_COST_TYPE_IDS = new Set([
  'b03b-c239-15a5-da55',
  '75bb-ded1-c86d-bdf0',
  'a623-fe74-1d33-cddf',
  '716d-91b7-d55a-1022',
  'ac6b-ced3-9b5e-9a6e',
])

/** Association group ids for the 11e attachment rules. */
export const ASSOCIATION = {
  leader: '1556-9b56-fba6-4370',
  support: '7dcd-7f61-69a7-0294',
} as const
