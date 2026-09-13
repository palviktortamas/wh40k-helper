import { describe, expect, it } from 'vitest'
import { mergeMfm, normaliseName } from './merge'
import type { ParsedCatalogue } from '../model'
import type { MfmCatalogue } from '../mfm/parse'

// Fixtures are invented, not real game data — see CLAUDE.md.
const datasheet = (id: string, name: string, basePoints?: number) => ({
  id,
  name,
  keywords: [],
  factionKeywords: [],
  type: 'unit' as const,
  stats: [],
  weapons: [],
  abilities: [],
  models: [],
  ...(basePoints !== undefined ? { basePoints } : {}),
  associations: [],
  constraints: [],
  sources: ['bsdata' as const],
})

const catalogue = (over: Partial<ParsedCatalogue> = {}): ParsedCatalogue => ({
  id: 'cat-1',
  name: 'Test Catalogue',
  revision: 1,
  gameSystemId: 'gs-1',
  datasheets: [],
  detachments: [],
  rules: [],
  unsupported: [],
  ...over,
})

const mfmFile = (over: Partial<MfmCatalogue> = {}): MfmCatalogue => ({
  name: 'Test',
  slug: 'test',
  version: '1.0',
  units: [],
  detachments: [],
  ...over,
})

describe('normaliseName', () => {
  it('ignores case, punctuation and the mirror’s curly apostrophes', () => {
    expect(normaliseName('Kult Of Speed')).toBe(normaliseName('Kult of Speed'))
    expect(normaliseName('Brutal But Kunnin’')).toBe(normaliseName("Brutal But Kunnin'"))
  })

  it('drops the "(Upgrade)" suffix the mirror adds to enhancements', () => {
    expect(normaliseName('Boss Boomer (Upgrade)')).toBe(normaliseName('Boss Boomer'))
  })
})

describe('mergeMfm', () => {
  it('takes pricing and eligibility from the mirror', () => {
    const cat = catalogue({ datasheets: [datasheet('u1', 'Alpha Squad', 90)] })
    mergeMfm(
      cat,
      mfmFile({
        units: [
          {
            name: 'alpha squad',
            pricing: [{ from: 1, to: 3, costs: [{ models: 10, points: 90 }] }],
            leaderTo: ['Beta Squad'],
            supportTo: [],
          },
        ],
      }),
    )
    const sheet = cat.datasheets[0]!
    expect(sheet.pricing?.[0]?.costs[0]?.points).toBe(90)
    expect(sheet.leaderTo).toEqual(['Beta Squad'])
    expect(sheet.sources).toContain('mfm')
  })

  it('reports a points disagreement and prefers the mirror', () => {
    const cat = catalogue({ datasheets: [datasheet('u1', 'Alpha Squad', 90)] })
    const report = mergeMfm(
      cat,
      mfmFile({
        units: [
          { name: 'Alpha Squad', pricing: [{ from: 1, costs: [{ models: 10, points: 95 }] }], leaderTo: [], supportTo: [] },
        ],
      }),
    )
    expect(report.discrepancies).toHaveLength(1)
    expect(report.discrepancies[0]).toMatchObject({ field: 'points', chosen: 'mfm' })
    expect(report.discrepancies[0]?.values).toEqual([
      { source: 'mfm', value: '95' },
      { source: 'bsdata', value: '90' },
    ])
  })

  it('flags records present in only one source instead of dropping them', () => {
    const cat = catalogue({
      datasheets: [datasheet('u1', 'Only In Bsdata')],
      detachments: [
        { id: 'd1', name: 'Shared Detachment', dp: 1, forceDispositions: ['Hold'], enhancements: [], sources: ['bsdata'] },
        { id: 'd2', name: 'Only In Bsdata Detachment', dp: 1, forceDispositions: [], enhancements: [], sources: ['bsdata'] },
      ],
    })
    const report = mergeMfm(
      cat,
      mfmFile({
        units: [{ name: 'Only In Mfm', pricing: [], leaderTo: [], supportTo: [] }],
        detachments: [
          { name: 'Shared Detachment', dp: 1, forceDispositions: ['Hold'], enhancements: [], sources: ['mfm'] },
        ],
      }),
    )
    expect(report.unmatched).toEqual(
      expect.arrayContaining([
        { kind: 'datasheet', name: 'Only In Bsdata', presentIn: ['bsdata'] },
        { kind: 'datasheet', name: 'Only In Mfm', presentIn: ['mfm'] },
        { kind: 'detachment', name: 'Only In Bsdata Detachment', presentIn: ['bsdata'] },
      ]),
    )
    expect(report.matchedDetachments).toBe(1)
  })

  it('treats a Force Disposition list that the mirror extends as a discrepancy', () => {
    const cat = catalogue({
      detachments: [
        { id: 'd1', name: 'War Band', dp: 3, forceDispositions: ['Hold'], enhancements: [], sources: ['bsdata'] },
      ],
    })
    const report = mergeMfm(
      cat,
      mfmFile({
        detachments: [
          { name: 'War Band', dp: 3, forceDispositions: ['HOLD', 'PURGE'], enhancements: [], sources: ['mfm'] },
        ],
      }),
    )
    expect(report.discrepancies[0]?.field).toBe('forceDispositions')
    expect(cat.detachments[0]?.forceDispositions).toEqual(['HOLD', 'PURGE'])
  })
})
