/**
 * Giving each model of a multi-model pick its own loadout.
 *
 * Two Nobz are one selection with `count: 2`, and the loadout hanging off it is
 * shared — so the editor could only ever configure "both Nobz", never one of
 * each. Splitting turns the one selection into as many selections of one as it
 * held, each carrying a copy of what was there.
 *
 * Invented units — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { canSplit, mergeSelection, splitSelection } from './split'
import type { Selection } from './types'

const child = (id: string, entryId: string, name: string, count = 1, kids: Selection[] = []): Selection => ({
  id,
  entryId,
  name,
  type: 'model',
  count,
  selections: kids,
})

const parent = (kids: Selection[]): Selection => ({
  id: 'unit',
  entryId: 'e-mob',
  name: 'Mob',
  type: 'unit',
  count: 1,
  selections: kids,
})

const ids = (s: Selection) => s.selections.map((c) => c.id)

describe('splitSelection', () => {
  it('turns a pick of two into two picks of one', () => {
    const before = parent([child('a', 'e-nob', 'Nob', 2)])
    const after = splitSelection(before, 'a')

    expect(after.selections).toHaveLength(2)
    expect(after.selections.map((c) => c.count)).toEqual([1, 1])
    expect(after.selections.every((c) => c.entryId === 'e-nob')).toBe(true)
  })

  it('gives every copy its own identity, so their loadouts can differ', () => {
    const after = splitSelection(parent([child('a', 'e-nob', 'Nob', 3)]), 'a')
    expect(new Set(ids(after)).size).toBe(3)
  })

  it('copies the loadout onto each, rather than leaving the new ones bare', () => {
    const before = parent([
      child('a', 'e-nob', 'Nob', 2, [child('w', 'e-klaw', 'Power Klaw', 1)]),
    ])
    const after = splitSelection(before, 'a')

    for (const nob of after.selections) {
      expect(nob.selections.map((w) => w.entryId)).toEqual(['e-klaw'])
    }
    // …and the copies must not share the original's ids, or editing one would
    // edit the other.
    const [first, second] = after.selections
    expect(first!.selections[0]!.id).not.toBe(second!.selections[0]!.id)
  })

  it('keeps the other picks where they were', () => {
    const before = parent([
      child('boy', 'e-boy', 'Boy', 9),
      child('a', 'e-nob', 'Nob', 2),
    ])
    const after = splitSelection(before, 'a')

    expect(after.selections[0]).toEqual(before.selections[0])
    expect(after.selections).toHaveLength(3)
  })

  it('leaves a pick of one alone — there is nothing to separate', () => {
    const before = parent([child('a', 'e-nob', 'Nob', 1)])
    expect(splitSelection(before, 'a')).toBe(before)
  })

  it('leaves the tree alone when the id is not there', () => {
    const before = parent([child('a', 'e-nob', 'Nob', 2)])
    expect(splitSelection(before, 'missing')).toBe(before)
  })

  it('splits a pick nested deeper in the tree', () => {
    const before = parent([
      child('boy', 'e-boy', 'Boy', 9, [child('gun', 'e-gun', 'Big shoota', 2)]),
    ])
    const after = splitSelection(before, 'gun')

    expect(after.selections[0]!.selections).toHaveLength(2)
    expect(after.selections[0]!.selections.every((g) => g.count === 1)).toBe(true)
  })
})


describe('canSplit', () => {
  it('offers the split for a pick of two that has something to equip', () => {
    expect(canSplit(child('a', 'e-nob', 'Nob', 2), true)).toBe(true)
  })

  it('does not offer it for a single model', () => {
    expect(canSplit(child('a', 'e-nob', 'Nob', 1), true)).toBe(false)
  })

  it('does not offer it when there is nothing to equip', () => {
    expect(canSplit(child('a', 'e-nob', 'Nob', 2), false)).toBe(false)
  })

  it('does not offer it for a mob, where the screen would be unusable', () => {
    // Sixteen expandable rows is not an editor. The data's own
    // special-weapon entries are the route for a big unit.
    expect(canSplit(child('a', 'e-boy', 'Boy', 16), true)).toBe(false)
  })
})

describe('mergeSelection', () => {
  it('puts identical copies back together', () => {
    const before = parent([
      child('a', 'e-nob', 'Nob', 1, [child('w1', 'e-klaw', 'Power Klaw', 1)]),
      child('b', 'e-nob', 'Nob', 1, [child('w2', 'e-klaw', 'Power Klaw', 1)]),
    ])
    const after = mergeSelection(before, 'a')

    expect(after.selections).toHaveLength(1)
    expect(after.selections[0]!.count).toBe(2)
    expect(after.selections[0]!.selections.map((w) => w.entryId)).toEqual(['e-klaw'])
  })

  it('refuses to merge copies that were equipped differently', () => {
    const before = parent([
      child('a', 'e-nob', 'Nob', 1, [child('w1', 'e-klaw', 'Power Klaw', 1)]),
      child('b', 'e-nob', 'Nob', 1, [child('w2', 'e-choppa', 'Big Choppa', 1)]),
    ])
    expect(mergeSelection(before, 'a')).toBe(before)
  })

  it('leaves other picks alone', () => {
    const before = parent([
      child('boy', 'e-boy', 'Boy', 9),
      child('a', 'e-nob', 'Nob', 1),
      child('b', 'e-nob', 'Nob', 1),
    ])
    const after = mergeSelection(before, 'a')
    expect(after.selections.map((c) => `${c.entryId}x${c.count}`)).toEqual(['e-boyx9', 'e-nobx2'])
  })
})
