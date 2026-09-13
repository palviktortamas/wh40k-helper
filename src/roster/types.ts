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
  /** The group it was chosen from, when it came from one. */
  groupId?: string
  name: string
  type: SelectionType
  /** How many copies. Models use this for unit size; upgrades are usually 1. */
  count: number
  selections: Selection[]
}

export type Roster = {
  id: string
  name: string
  /** Catalogue record id, so a roster knows which faction it belongs to. */
  catalogueId: string
  pointsLimit: number
  /** Chosen detachment entry id, when one is picked. */
  detachmentId?: string
  /** Instance id of the selection marked Warlord. */
  warlordSelectionId?: string
  notes?: string
  /** Top-level unit selections, in display order. */
  selections: Selection[]
  createdAt: number
  updatedAt: number
  /** The data version this roster was built against, for post-update diffs. */
  builtWith: { bsdataRevision: number; mfmVersion?: string }
}

export const POINTS_PRESETS = [500, 1000, 1500, 2000, 3000] as const

export type ValidationSeverity = 'error' | 'warning'

export type ValidationIssue = {
  severity: ValidationSeverity
  /** Instance id of the offending selection, when the issue is local to one. */
  selectionId?: string
  message: string
  /** The rule this comes from, so the message can cite it (spec §5.3). */
  rule: string
}
