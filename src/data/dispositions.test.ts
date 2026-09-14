/**
 * Force Dispositions reach the app from two sources that disagree on casing —
 * the MFM mirror shouts them, BSData title-cases them. An 11e army may hold
 * several detachments and show their lists side by side, so whatever a source
 * says, one casing is stored.
 *
 * Invented detachments — the repo holds no real game data.
 */

import { describe, expect, it } from 'vitest'
import { parseMfm } from './mfm/parse'
import { parseCatalogue } from './bsdata/parse'
import { COST_TYPE } from './bsdata/schema'
import type { Catalogue, GameSystem } from './bsdata/schema'

const gameSystem: GameSystem = {
  id: 'gs',
  name: 'Test System',
  revision: 1,
  battleScribeVersion: '2.03',
  costTypes: [{ id: COST_TYPE.detachmentPoints, name: 'Detachment Points' }],
  categoryEntries: [
    { id: 'cat-hold', name: 'TAKE AND HOLD' },
    { id: 'cat-purge', name: 'Purge the Foe' },
    { id: 'cat-dp', name: '1DP Detachment' },
  ],
}

const catalogue: Catalogue = {
  id: 'cat',
  name: 'Test Catalogue',
  revision: 1,
  battleScribeVersion: '2.03',
  gameSystemId: 'gs',
  sharedSelectionEntries: [
    {
      id: 'e-band',
      name: 'Loud Band',
      type: 'upgrade',
      costs: [{ name: 'Detachment Points', typeId: COST_TYPE.detachmentPoints, value: 1 }],
      categoryLinks: [
        { id: 'l1', targetId: 'cat-hold' },
        { id: 'l2', targetId: 'cat-purge' },
        { id: 'l3', targetId: 'cat-dp' },
      ],
    },
  ],
}

describe('Force Disposition casing', () => {
  it('title-cases what BSData says, however the category is spelled', () => {
    const parsed = parseCatalogue(gameSystem, catalogue)
    expect(parsed.detachments[0]?.forceDispositions).toEqual(['Take and Hold', 'Purge the Foe'])
  })

  it('title-cases what the MFM mirror shouts', () => {
    const mfm = parseMfm(
      [
        'name: Test',
        'version: "1.0"',
        'detachments:',
        '  - name: Loud Band',
        '    dp: 1',
        '    objectives:',
        '      - TAKE AND HOLD',
        '      - PURGE THE FOE',
      ].join('\n'),
    )
    expect(mfm.detachments[0]?.forceDispositions).toEqual(['Take and Hold', 'Purge the Foe'])
  })
})
