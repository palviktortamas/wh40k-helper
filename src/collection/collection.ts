import type { Datasheet } from '@/data/model'
import { COUNTS, STAGES, type CollectionEntry, type Count } from './types'

/**
 * Sets one stage's count and moves the others so the stages still nest: what
 * is painted has been assembled, and what is assembled was bought. Raising
 * painted raises the stages below it; lowering bought lowers the ones above.
 * What is planned is not owned yet, so it moves on its own.
 */
export function withCount(entry: CollectionEntry, stage: Count, count: number): CollectionEntry {
  const n = Math.max(0, Math.floor(count))
  const next = { ...entry, [stage]: n }
  if (stage === 'planned') return next
  const at = STAGES.indexOf(stage)
  for (let i = at - 1; i >= 0; i--) next[STAGES[i]!] = Math.max(next[STAGES[i]!], n)
  for (let i = at + 1; i < STAGES.length; i++) next[STAGES[i]!] = Math.min(next[STAGES[i]!], n)
  return next
}

/** The price list's sizes for a first copy, smallest first. */
const sizesOf = (sheet: Datasheet | undefined) =>
  [...(sheet?.pricing?.find((b) => b.from <= 1)?.costs ?? sheet?.pricing?.[0]?.costs ?? [])].sort(
    (a, b) => a.models - b.models,
  )

/** A new row starts at one unit of the smallest size it is sold at. */
export const startingModels = (sheet: Datasheet | undefined): number => sizesOf(sheet)[0]?.models ?? 1

/**
 * What `models` models are worth in points: as many whole units as fit,
 * biggest size first (a 20-model mob costs less than two of 10), and any models
 * short of a unit at the smallest unit's rate per model. Without a price list
 * the catalogue's cost is taken per model, which is right for the single-model
 * datasheets that lack one.
 */
export function pointsForModels(sheet: Datasheet | undefined, models: number): number {
  if (!sheet || models <= 0) return 0
  const sizes = sizesOf(sheet)
  if (sizes.length === 0) return (sheet.basePoints ?? 0) * models
  let left = models
  let points = 0
  for (const size of [...sizes].reverse()) {
    while (left >= size.models) {
      points += size.points
      left -= size.models
    }
  }
  const smallest = sizes[0]!
  return points + Math.round((left * smallest.points) / smallest.models)
}

export type StageTotals = { models: number; points: number }

/** Models and points at each stage, across a faction's collection. */
export function collectionStats(
  entries: readonly CollectionEntry[],
  sheets: Map<string, Datasheet>,
): Record<Count, StageTotals> {
  const totals = Object.fromEntries(COUNTS.map((s) => [s, { models: 0, points: 0 }])) as Record<Count, StageTotals>
  for (const entry of entries) {
    const sheet = sheets.get(entry.entryId)
    for (const stage of COUNTS) {
      const n = countOf(entry, stage)
      totals[stage].models += n
      totals[stage].points += pointsForModels(sheet, n)
    }
  }
  return totals
}

/** A row's count at a stage; a row saved before plans existed plans nothing. */
export const countOf = (entry: CollectionEntry, stage: Count): number => entry[stage] ?? 0

/** The add-unit picker's filter: any datasheet, or only those with models at a stage (or planned). */
export type StageFilter = 'any' | Count

export const hasStage = (entry: CollectionEntry | undefined, filter: StageFilter): boolean =>
  filter === 'any' || (entry ? countOf(entry, filter) : 0) > 0
