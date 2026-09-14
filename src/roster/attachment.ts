/**
 * Attaching one unit to another (11e "Leader", "Supported by", and whatever
 * else a codex invents — Necrons attach Cryptothralls to a Cryptek as
 * "Retainers").
 *
 * Every one of these is an association whose `action` is `group`, which is why
 * the app used to treat them as one thing and call every attached character a
 * Leader. They are separate rules with separate caps — a unit may hold one
 * Leader *and* one Support — so the **kind** has to be carried rather than
 * flattened, and it must not be a fixed list of two: the kind is whatever the
 * data's association is labelled, so a faction added tomorrow works unchanged.
 */

import type { Association } from '@/data/bsdata/schema'
import type { CatalogueGraph } from './resolve'
import type { Roster, Selection } from './types'

export type AttachmentKind = {
  /** Stable key for comparing kinds (the label, folded). */
  key: string
  /** What the rules call it, for the screen: "Leader", "Support", "Retainers". */
  label: string
}

/**
 * The game system labels the Support group "Supported by", which reads wrong in
 * "Attach as …" and in an error message; the rules call them Support
 * characters. Everything else is shown exactly as the data labels it.
 */
const DISPLAY_LABELS: Record<string, string> = {
  'supported by': 'Support',
  supporting: 'Support',
  leading: 'Leader',
}

const fold = (text: string): string => text.trim().toLowerCase()

const kindFromLabel = (label: string | undefined): AttachmentKind | undefined => {
  const raw = label?.trim()
  if (!raw) return undefined
  const key = fold(raw)
  return { key, label: DISPLAY_LABELS[key] ?? raw }
}

/** The kind one association attaches through. */
export const kindOfAssociation = (association: Association): AttachmentKind | undefined =>
  kindFromLabel(association.label) ?? kindFromLabel(association.name)

/** Anything that carries the data's associations: a resolved entry, or a parsed datasheet. */
type HasAssociations = { associations: Association[] }

/** The associations by which this datasheet joins another unit. */
export const joiningAssociations = (entry: HasAssociations): Association[] =>
  entry.associations.filter((a) => a.action === 'group')

/** Whether a datasheet takes part in attachment at all. */
export const canAttach = (entry: HasAssociations): boolean => joiningAssociations(entry).length > 0

/**
 * How a datasheet attaches. A unit that can join in more than one way reports
 * the first the data lists; the picker still offers each association
 * separately, so nothing is lost.
 */
export function attachmentKind(entry: HasAssociations): AttachmentKind | undefined {
  for (const association of joiningAssociations(entry)) {
    const kind = kindOfAssociation(association)
    if (kind) return kind
  }
  return undefined
}

/** What a unit is already holding, per kind — what the picker must show. */
export type Attachments = Map<string, { kind: AttachmentKind; units: Selection[] }>

export function attachmentsOf(roster: Roster, graph: CatalogueGraph, targetId: string): Attachments {
  const held: Attachments = new Map()
  for (const unit of roster.selections) {
    if (unit.attachedTo !== targetId) continue
    const entry = graph.resolve(unit.entryId)
    if (!entry) continue
    const association = entry.associations.find((a) => a.id === unit.associationId)
    const kind = (association && kindOfAssociation(association)) ?? attachmentKind(entry)
    if (!kind) continue
    const slot = held.get(kind.key) ?? { kind, units: [] }
    slot.units.push(unit)
    held.set(kind.key, slot)
  }
  return held
}

/** Units of one kind already attached to a target, excluding `exceptId`. */
export const heldOfKind = (
  held: Attachments,
  kind: AttachmentKind,
  exceptId?: string,
): Selection[] => (held.get(kind.key)?.units ?? []).filter((u) => u.id !== exceptId)

/** How many of one kind a target may hold, as the association itself states. */
export const capacityOf = (association: Association): number => association.max ?? 1
