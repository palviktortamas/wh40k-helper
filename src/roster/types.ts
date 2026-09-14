/**
 * A roster is a tree of selections that mirrors the catalogue's entry tree.
 * Each selection names the catalogue entry it instantiates, so validation can
 * always walk back to the constraints that govern it.
 */

export type SelectionType = 'unit' | 'model' | 'upgrade'

export type Selection = {
  /** Instance id — unique within the roster, unlike `entryId`. */
  id: string
  /** The catalogue entry this instantiates. */
  entryId: string
  /**
   * The entry link that pulled the entry into this parent, when it came through
   * one. A link can add constraints, modifiers and costs on top of the shared
   * entry, and one shared entry can be linked twice under the same parent, so
   * the link is what identifies *which* option this is. Absent on selections
   * saved before this field existed; those fall back to `entryId` + `groupId`.
   */
  linkId?: string
  /** The group it was chosen from, when it came from one. */
  groupId?: string
  name: string
  /**
   * The owner's own name for this unit ("Da Hard Boyz"), overriding the
   * datasheet name and its automatic numbering. Root selections only.
   */
  customName?: string
  type: SelectionType
  /**
   * How many copies, **per copy of the parent**. A model with `count: 9` whose
   * weapon child has `count: 1` means nine weapons; a unit-scope limit sees 9.
   * The evaluator, the export and the editor all read it this way — a nested
   * count is never an absolute total.
   */
  count: number
  selections: Selection[]
  /**
   * Leader attachment: the instance id of the root selection this unit is
   * joined to, and the association (from the catalogue) that allows it. Only
   * meaningful on a root selection.
   */
  attachedTo?: string
  associationId?: string
}

export type Roster = {
  id: string
  name: string
  /** Catalogue record id, so a roster knows which faction it belongs to. */
  catalogueId: string
  pointsLimit: number
  notes?: string
  /**
   * Roster-level configuration as real selections — battle size, detachment,
   * force disposition and the data's own toggles. They live in the tree so the
   * catalogue's conditions ("when the detachment is X", "at Incursion size")
   * can be evaluated exactly like any other selection.
   */
  configuration: Selection[]
  /** Top-level unit selections, in display order. */
  selections: Selection[]
  createdAt: number
  updatedAt: number
  /** The data version this roster was built against, for post-update diffs. */
  builtWith: { bsdataRevision: number; mfmVersion?: string }
  /**
   * Set by the storage migration from the pre-configuration roster shape and
   * consumed (then removed) by `normaliseRoster`, which needs the catalogue
   * graph the migration does not have.
   */
  pendingDetachmentId?: string
  pendingWarlordSelectionId?: string
}

/** The three battle sizes the game defines; anything else is typed in. */
export const POINTS_PRESETS = [1000, 2000, 3000] as const

export type ValidationSeverity = 'error' | 'warning'

export type ValidationIssue = {
  severity: ValidationSeverity
  /** Instance id of the offending selection, when the issue is local to one. */
  selectionId?: string
  message: string
  /** The rule this comes from, so the message can cite it (spec §5.3). */
  rule: string
}

/** Depth-first walk over a selection tree. */
export function* walkSelections(selections: Selection[]): Generator<Selection> {
  for (const selection of selections) {
    yield selection
    yield* walkSelections(selection.selections)
  }
}

export function findSelection(selections: Selection[], id: string): Selection | undefined {
  for (const selection of walkSelections(selections)) if (selection.id === id) return selection
  return undefined
}
