/**
 * Leader and Support detection against the real catalogues (fixture-gated, see
 * src/data/live.test.ts). The data hangs associations off the model entry
 * rather than the unit, so this is exactly the shape a synthetic fixture is
 * least likely to reproduce — and getting it wrong makes every Support
 * character look like a Leader.
 */

import { describe, expect, it } from 'vitest'
import { buildGraph } from './resolve'
import { attachmentKind, canAttach } from './attachment'
import {
  configuredFactions,
  fixturesAvailable,
  loadCatalogueOf,
  loadGameSystem,
  loadLibrariesOf,
  type FixtureFaction,
} from '../../test/fixtures'

const available = fixturesAvailable()
const factions = available ? configuredFactions() : []

describe.skipIf(!available)('attachment kinds on real data', () => {
  describe.each(factions)('$name', (faction: FixtureFaction) => {
    it('tells Leaders and Support characters apart', () => {
      const graph = buildGraph(loadGameSystem(), loadCatalogueOf(faction), loadLibrariesOf(faction))
      const units = graph.rootEntryIds.map((id) => graph.resolve(id)!)
      const attaching = units.filter(canAttach)
      expect(attaching.length).toBeGreaterThan(0)

      const kinds = attaching.map((e) => ({ name: e.name, kind: attachmentKind(e) }))
      const leaders = kinds.filter((k) => k.kind?.key === 'leader')
      const support = kinds.filter((k) => k.kind?.label === 'Support')
      const other = kinds.filter((k) => k.kind && k.kind.key !== 'leader' && k.kind.label !== 'Support')
      const unknown = kinds.filter((k) => k.kind === undefined)

      console.log(
        `${faction.name}: ${leaders.length} Leader, ${support.length} Support, ${other.length} other (${[
          ...new Set(other.map((k) => k.kind!.label)),
        ].join(', ')}), ${unknown.length} unrecognised`,
      )

      // Every faction fields both of the core kinds, and nothing that attaches
      // may be left without one — an unrecognised kind used to be shown as
      // "Leader", which is how Support characters came to look like leaders.
      expect(leaders.length).toBeGreaterThan(0)
      expect(support.length).toBeGreaterThan(0)
      expect(unknown).toEqual([])
    })
  })
})
