/**
 * Wargear the data calls compulsory is not a choice, and must not be offered
 * as one. A model whose slugga and choppa sit behind a 0/1 stepper can be
 * stripped of both by two taps — and the owner then finds a model with nothing
 * to roll, mid-game, with no hint of what it lost.
 *
 * Invented entries — the repo holds no game data.
 */

import { describe, expect, it } from 'vitest'
import { compulsoryCount, groupShape, isFixedLoadout, tradeDonor } from './compulsory'
import type { ResolvedEntry } from './resolve'

const entry = (
  over: Partial<ResolvedEntry> & { min?: number; max?: number },
): ResolvedEntry => ({
  id: 'e',
  name: 'Thing',
  type: over.type ?? 'upgrade',
  hidden: false,
  costs: {},
  constraints: [
    ...(over.min !== undefined
      ? [{ id: 'c-min', type: 'min' as const, value: over.min, field: 'selections', scope: 'parent' }]
      : []),
    ...(over.max !== undefined
      ? [{ id: 'c-max', type: 'max' as const, value: over.max, field: 'selections', scope: 'parent' }]
      : []),
  ],
  modifiers: [],
  modifierGroups: [],
  associations: [],
  categoryIds: [],
  groups: [],
  entries: [],
})

describe('compulsoryCount', () => {
  it('is the minimum the entry demands of itself', () => {
    expect(compulsoryCount(entry({ min: 1, max: 1 }))).toBe(1)
    expect(compulsoryCount(entry({ min: 2, max: 4 }))).toBe(2)
  })

  it('is nothing when the data asks for nothing', () => {
    expect(compulsoryCount(entry({ max: 2 }))).toBe(0)
    expect(compulsoryCount(entry({}))).toBe(0)
  })

  it('leaves model counts to the evaluator', () => {
    // How many models a unit has is a unit-size question with its own rules and
    // its own controls; only the wargear on a model is settled here.
    expect(compulsoryCount(entry({ type: 'model', min: 6, max: 18 }))).toBe(0)
  })
})

describe('isFixedLoadout', () => {
  it('is fixed when the data allows exactly one number', () => {
    expect(isFixedLoadout(entry({ min: 1, max: 1 }))).toBe(true)
    expect(isFixedLoadout(entry({ min: 2, max: 2 }))).toBe(true)
  })

  it('is a choice when the data allows a range', () => {
    expect(isFixedLoadout(entry({ min: 1, max: 2 }))).toBe(false)
    expect(isFixedLoadout(entry({ max: 1 }))).toBe(false)
    expect(isFixedLoadout(entry({ min: 6, max: 6, type: 'model' }))).toBe(false)
  })

  it('ignores a cap that is not about this entry inside its parent', () => {
    const wider = entry({ min: 1, max: 1 })
    wider.constraints.push({ id: 'c-unit', type: 'max', value: 1, field: 'selections', scope: 'unit' })
    expect(isFixedLoadout(wider)).toBe(true)
  })
})

/** Options that may each be taken once, as most wargear is written. */
const ones = (n: number) => Array.from({ length: n }, () => 1)

describe('groupShape', () => {
  it('is a choice when the group must hold exactly one of several', () => {
    expect(groupShape({ min: 1, limit: 1, candidates: ones(4) })).toBe('one')
  })

  it('is fixed when the group must hold everything it offers', () => {
    expect(groupShape({ min: 1, limit: 1, candidates: ones(1) })).toBe('all')
    expect(groupShape({ min: 2, limit: 2, candidates: ones(2) })).toBe('all')
  })

  it('leaves a range to the steppers', () => {
    expect(groupShape({ min: 1, limit: 2, candidates: ones(3) })).toBe('many')
    expect(groupShape({ min: 0, limit: 1, candidates: ones(3) })).toBe('many')
    expect(groupShape({ min: 9, limit: 18, candidates: ones(1) })).toBe('many')
    expect(groupShape({ min: 0, limit: undefined, candidates: ones(5) })).toBe('many')
  })

  it('leaves "two of these four" to the steppers, with the floor the group keeps', () => {
    expect(groupShape({ min: 2, limit: 2, candidates: ones(4) })).toBe('many')
  })

  it('reads the cap the evaluator gives, so a cap a rule raises is not frozen', () => {
    // "One rokkit per ten models" is min 1 / max 1 in the raw data and 2 once
    // the mob is twenty strong; that is a count, not a fixed choice.
    expect(groupShape({ min: 1, limit: 2, candidates: ones(3) })).toBe('many')
  })

  it('counts what each option may be taken, not how many options there are', () => {
    // "Two of: rokkit pistol (up to two), smash hammer (one)" — two pistols or
    // a pistol and the hammer. Two options for two slots, and still a choice.
    expect(groupShape({ min: 2, limit: 2, candidates: [2, 1] })).toBe('many')
    // An option with no cap of its own can fill the group by itself.
    expect(groupShape({ min: 1, limit: 1, candidates: [undefined] })).toBe('all')
    expect(groupShape({ min: 2, limit: 2, candidates: [undefined, 1] })).toBe('many')
  })
})

describe('tradeDonor', () => {
  const sel = (id: string, count: number, keep = 0) => ({ id, count, keep })

  it('takes from the option with the most to spare', () => {
    expect(tradeDonor([sel('pistol', 2, 1), sel('other', 1)], 'hammer')).toBe('pistol')
  })

  it('never takes below what an option must keep', () => {
    expect(tradeDonor([sel('pistol', 1, 1), sel('hammer', 1)], 'pistol')).toBe('hammer')
    expect(tradeDonor([sel('pistol', 1, 1)], 'hammer')).toBeUndefined()
  })

  it('does not take from the option being raised', () => {
    expect(tradeDonor([sel('pistol', 2)], 'pistol')).toBeUndefined()
  })
})
