import { describe, expect, it } from 'vitest'
import { mfmPriceOf, withMfmPoints } from './pricing'
import type { Datasheet, PricingBand } from '@/data/model'
import type { Roster, Selection } from './types'
import type { EvaluationResult } from './evaluate'

// Everything here is invented — the repo must contain no real game data.

const bands: PricingBand[] = [
  { from: 1, to: 2, costs: [{ models: 1, points: 50 }, { models: 2, points: 100 }, { models: 3, points: 165 }] },
  { from: 3, costs: [{ models: 1, points: 60 }, { models: 2, points: 120 }, { models: 3, points: 190 }] },
]
const sheet = { id: 'e-gun', name: 'Gun Team', pricing: bands } as unknown as Datasheet

const unit = (id: string, entryId: string, models: number): Selection => ({
  id,
  entryId,
  name: id,
  type: 'unit',
  count: 1,
  selections: [{ id: `${id}-m`, entryId: 'm', name: 'Model', type: 'model', count: models, selections: [] }],
})

const roster = (selections: Selection[]): Roster =>
  ({ id: 'r', name: 'r', catalogueId: 'c', pointsLimit: 2000, configuration: [], selections }) as unknown as Roster

const evaluation = (unitPoints: Record<string, number>): EvaluationResult =>
  ({
    points: Object.values(unitPoints).reduce((a, b) => a + b, 0),
    unitPoints,
    issues: [],
  }) as unknown as EvaluationResult

describe('the price list wins where it disagrees with the catalogue', () => {
  it('reads the band for the copy and the price for the model count', () => {
    expect(mfmPriceOf(sheet, 3, 1)).toBe(165)
    expect(mfmPriceOf(sheet, 2, 2)).toBe(100)
    // Third copy onwards is a different band.
    expect(mfmPriceOf(sheet, 3, 3)).toBe(190)
  })

  it('takes the next size up for a count the list does not price', () => {
    expect(mfmPriceOf(sheet, 4, 1)).toBeUndefined()
    const sparse = { ...sheet, pricing: [{ from: 1, costs: [{ models: 3, points: 80 }, { models: 6, points: 160 }] }] }
    expect(mfmPriceOf(sparse as unknown as Datasheet, 4, 1)).toBe(160)
  })

  it('replaces a flat catalogue price with the banded one', () => {
    const r = roster([unit('a', 'e-gun', 3)])
    const out = withMfmPoints(r, evaluation({ a: 50 }), [sheet])
    expect(out.unitPoints['a']).toBe(165)
    expect(out.points).toBe(165)
    expect(out.adjusted).toBe(true)
  })

  it('counts the copies of one datasheet in roster order', () => {
    const r = roster([unit('a', 'e-gun', 1), unit('b', 'e-gun', 1), unit('c', 'e-gun', 1)])
    const out = withMfmPoints(r, evaluation({ a: 50, b: 50, c: 50 }), [sheet])
    expect(out.unitPoints).toEqual({ a: 50, b: 50, c: 60 })
    expect(out.points).toBe(160)
  })

  it('leaves a unit with no price list alone, and reports nothing adjusted', () => {
    const r = roster([unit('a', 'e-other', 3)])
    const out = withMfmPoints(r, evaluation({ a: 77 }), [sheet])
    expect(out.unitPoints['a']).toBe(77)
    expect(out.adjusted).toBe(false)
  })
})
