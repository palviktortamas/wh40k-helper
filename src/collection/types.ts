/**
 * The owner's collection: for each datasheet of a faction, how many models are
 * bought, how many of those are assembled, and how many of those are painted.
 * One record per datasheet, so "30 bought, 20 built, 10 painted" is one row.
 */

export type Stage = 'bought' | 'assembled' | 'painted'

export const STAGES: readonly Stage[] = ['bought', 'assembled', 'painted']

export const STAGE_LABELS: Record<Stage, string> = {
  bought: 'Bought',
  assembled: 'Assembled',
  painted: 'Painted',
}

export type CollectionEntry = {
  /** `${catalogueId}:${entryId}` — one record per datasheet per faction. */
  id: string
  catalogueId: string
  /** The datasheet's id, as the roster's `entryId`. */
  entryId: string
  /** The datasheet's name when it was added, so the row still reads if the data changes. */
  name: string
  /** Models owned. */
  bought: number
  /** Of those, models assembled. */
  assembled: number
  /** Of those, models painted. */
  painted: number
  updatedAt: number
}

export const collectionId = (catalogueId: string, entryId: string): string => `${catalogueId}:${entryId}`
