/**
 * Stratagem selection for an army that may hold several detachments at once
 * (11e modular detachments). Invented stratagems — no game data in the repo.
 */

import { describe, expect, it } from 'vitest'
import { forDetachment } from './select'
import type { Stratagem } from './types'

const strat = (name: string, detachment: string, core = false): Stratagem => ({
  id: name,
  name,
  factionId: core ? '' : 'f1',
  detachment,
  core,
  cp: 1,
  turn: 'Your turn',
  phase: 'Any phase',
  when: '',
  target: '',
  effect: '',
})

const all = [
  strat('Command Re-roll', '', true),
  strat('Rapid Advance', 'Vanguard Spear'),
  strat('Hold the Line', 'Bulwark Host'),
  strat('Unseen Blade', 'Shadow Cadre'),
]

const names = (list: Stratagem[]) => list.map((s) => s.name)

describe('forDetachment', () => {
  it('gives an army with no detachment only the Core stratagems', () => {
    expect(names(forDetachment(all, []))).toEqual(['Command Re-roll'])
  })

  it('adds the chosen detachment’s stratagems to the Core ones', () => {
    expect(names(forDetachment(all, ['Vanguard Spear']))).toEqual(['Command Re-roll', 'Rapid Advance'])
  })

  it('adds every chosen detachment’s stratagems when several are taken', () => {
    expect(names(forDetachment(all, ['Vanguard Spear', 'Bulwark Host']))).toEqual([
      'Command Re-roll',
      'Rapid Advance',
      'Hold the Line',
    ])
  })

  it('matches detachment names loosely, as the importer’s names differ in case and punctuation', () => {
    expect(names(forDetachment(all, ['vanguard  spear']))).toContain('Rapid Advance')
  })

  it('lists a stratagem once even if two chosen detachments would both claim it', () => {
    expect(names(forDetachment(all, ['Vanguard Spear', 'Vanguard Spear']))).toEqual([
      'Command Re-roll',
      'Rapid Advance',
    ])
  })
})
