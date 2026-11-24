import { describe, expect, it } from 'vitest'
import { wantsBundledImport } from './store'
import { STRATAGEM_SET_ID, type StratagemSet } from './types'

const set = (extra: Partial<StratagemSet>): StratagemSet => ({
  id: STRATAGEM_SET_ID,
  importedAt: 0,
  stratagems: [],
  ...extra,
})

describe('importing the shipped export on start', () => {
  it('happens on a device with no stratagems', () => {
    expect(wantsBundledImport(undefined)).toBe(true)
  })

  // A set imported before the move and shooting types were read has none of
  // their definitions, so every "pulse jet move" would stay unexplained.
  it('happens again for a set imported before the terms were read', () => {
    expect(wantsBundledImport(set({}))).toBe(true)
  })

  it('does not happen once the set carries them', () => {
    expect(wantsBundledImport(set({ terms: [] }))).toBe(false)
  })
})
