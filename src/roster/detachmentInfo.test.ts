/**
 * What a detachment gives you, gathered for the roster editor: its enhancements
 * with their rules text, and its stratagems.
 *
 * The two halves come from different sources — the mirror lists a detachment's
 * enhancements by name and price, BSData carries the text — so they have to be
 * joined, and the join has to survive the casing and punctuation the sources
 * disagree on.
 *
 * Invented content — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { detachmentEnhancements, detachmentStratagems } from './detachmentInfo'
import type { Detachment, ParsedCatalogue } from '@/data/model'
import type { Stratagem } from '@/stratagems/types'

const catalogue = (enhancements: { id: string; name: string; text: string }[]): ParsedCatalogue =>
  ({
    id: 'cat',
    name: 'Faction',
    revision: 1,
    gameSystemId: 'gs',
    datasheets: [],
    detachments: [],
    rules: [],
    unsupported: [],
    enhancements: enhancements.map((e) => ({ ...e, kind: 'enhancement' as const })),
  }) as ParsedCatalogue

const detachment = (enhancements: { name: string; points?: number }[]): Detachment => ({
  name: 'Loud Band',
  forceDispositions: [],
  enhancements,
  sources: ['bsdata'],
})

describe('detachmentEnhancements', () => {
  it('joins the mirror’s names and prices to the rules text', () => {
    const joined = detachmentEnhancements(
      detachment([{ name: 'Shiny Hat', points: 15 }]),
      catalogue([{ id: 'e1', name: 'Shiny Hat', text: 'Once per battle, gain 1 CP.' }]),
    )

    expect(joined).toEqual([
      { id: 'e1', name: 'Shiny Hat', points: 15, text: 'Once per battle, gain 1 CP.' },
    ])
  })

  it('matches names the two sources spell differently', () => {
    const joined = detachmentEnhancements(
      detachment([{ name: "DA BOSS' HAT" }]),
      catalogue([{ id: 'e1', name: 'Da Boss’ Hat', text: 'Very loud.' }]),
    )
    expect(joined[0]?.text).toBe('Very loud.')
  })

  it('still lists an enhancement whose text is missing, rather than dropping it', () => {
    const joined = detachmentEnhancements(
      detachment([{ name: 'Mystery Trinket', points: 10 }]),
      catalogue([]),
    )
    expect(joined).toEqual([{ name: 'Mystery Trinket', points: 10, text: '' }])
  })

  it('reports nothing for a detachment the mirror gave no enhancements', () => {
    expect(detachmentEnhancements(detachment([]), catalogue([]))).toEqual([])
  })
})

const strat = (name: string, forDetachment: string, core = false): Stratagem => ({
  id: name,
  name,
  factionId: core ? '' : 'f1',
  detachment: forDetachment,
  core,
  cp: 1,
  turn: 'Your turn',
  phase: 'Any phase',
  when: '',
  target: '',
  effect: '',
})

describe('detachmentStratagems', () => {
  const all = [
    strat('Command Re-roll', '', true),
    strat('Get Stuck In', 'Loud Band'),
    strat('Hold Fast', 'Quiet Band'),
  ]

  it('lists the detachment’s own stratagems and leaves the Core set out', () => {
    // The Core set belongs to every army, so it says nothing about *this*
    // detachment — which is the question the section answers.
    expect(detachmentStratagems(detachment([]), all).map((s) => s.name)).toEqual(['Get Stuck In'])
  })

  it('reports nothing when the stratagems were never imported', () => {
    expect(detachmentStratagems(detachment([]), undefined)).toEqual([])
  })

  it('reports nothing for a detachment with none of its own', () => {
    expect(detachmentStratagems({ ...detachment([]), name: 'Silent Band' }, all)).toEqual([])
  })
})
