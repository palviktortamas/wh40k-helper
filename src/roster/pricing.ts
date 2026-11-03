/**
 * Points from the price list where it and the catalogue disagree.
 *
 * Spec §4.1 puts the Munitorum Field Manual mirror ahead of BSData for points
 * (`POINTS_PRECEDENCE`). The constraint evaluator only knows BSData's costs, so
 * a unit BSData prices flat across sizes the manual prices in bands comes out
 * wrong. Where the datasheet carries the manual's bands, the unit's points are
 * the band for its ordinal copy and the price for its model count.
 */

import type { Datasheet } from '@/data/model'
import type { EvaluationResult } from './evaluate'
import { modelCount } from './size'
import type { Roster } from './types'

/**
 * The manual's price for `models` models of the `ordinal`-th copy (1-based) of
 * a datasheet. A count the list does not price pays the next size up — the
 * same way the catalogue's own size groups behave — and a count beyond the
 * list, or a copy no band covers, has no manual price.
 */
export function mfmPriceOf(sheet: Datasheet | undefined, models: number, ordinal: number): number | undefined {
  const band = sheet?.pricing?.find((b) => ordinal >= b.from && (b.to === undefined || ordinal <= b.to))
  if (!band || band.costs.length === 0) return undefined
  const sizes = [...band.costs].sort((a, b) => a.models - b.models)
  return (sizes.find((c) => c.models >= models) ?? undefined)?.points
}

export type PricedRoster = {
  points: number
  unitPoints: Record<string, number>
  /** Whether any unit's price came from the manual rather than the catalogue. */
  adjusted: boolean
}

/**
 * Restates each root unit's points from the manual's bands. A unit's cost from
 * the catalogue also carries whatever else it adds up (an enhancement is its
 * own cost type, so it is not in here); only the part the manual prices is
 * replaced, and only when the two disagree.
 */
export function withMfmPoints(
  roster: Roster,
  evaluation: Pick<EvaluationResult, 'points' | 'unitPoints'>,
  sheets: readonly Datasheet[],
): PricedRoster {
  const sheetOf = new Map(sheets.map((s) => [s.id, s]))
  const seen = new Map<string, number>()
  const unitPoints = { ...evaluation.unitPoints }
  let points = evaluation.points
  let adjusted = false
  for (const unit of roster.selections) {
    const ordinal = (seen.get(unit.entryId) ?? 0) + 1
    seen.set(unit.entryId, ordinal)
    const models = modelCount(unit)
    if (models === 0) continue
    const price = mfmPriceOf(sheetOf.get(unit.entryId), models, ordinal)
    const before = unitPoints[unit.id]
    if (price === undefined || before === undefined || price === before) continue
    unitPoints[unit.id] = price
    points += price - before
    adjusted = true
  }
  return { points, unitPoints, adjusted }
}
