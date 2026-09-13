/**
 * Hits the real sources. Skipped unless WH40K_NETWORK=1, so CI and offline work
 * stay deterministic. Run it after changing any URL or the discovery logic:
 *
 *   WH40K_NETWORK=1 npm test
 */

import { describe, expect, it } from 'vitest'
import { installCatalogue, listAvailableCatalogues } from './install'

const enabled = process.env['WH40K_NETWORK'] === '1'

describe.skipIf(!enabled)('live sources', { timeout: 120_000 }, () => {
  it('discovers catalogues and pairs them with the points mirror', async () => {
    const catalogues = await listAvailableCatalogues()
    expect(catalogues.length).toBeGreaterThan(10)
    // Names must be de-prefixed ("Xenos - Orks" → "Orks") or the mirror pairing
    // silently fails and every faction loses its official points.
    expect(catalogues.every((c) => !c.name.includes(' - '))).toBe(true)
    expect(catalogues.filter((c) => c.slug).length).toBeGreaterThan(5)
  })

  it('installs a catalogue end to end', async () => {
    const catalogues = await listAvailableCatalogues()
    const target = catalogues.find((c) => c.slug)
    expect(target).toBeDefined()

    const steps: string[] = []
    const { record, health } = await installCatalogue(target!, (p) => steps.push(p.step))

    expect(steps.length).toBeGreaterThan(2)
    expect(record.parsed.datasheets.length).toBeGreaterThan(10)
    expect(record.raw.catalogue.length).toBeGreaterThan(1000)
    expect(record.versions.mfmVersion).toBeTruthy()
    expect(health.matchedDatasheets).toBeGreaterThan(0)
  })
})
