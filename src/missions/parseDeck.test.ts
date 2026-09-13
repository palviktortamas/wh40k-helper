// @vitest-environment jsdom
/**
 * Runs against a saved copy of the Wahapedia mission-deck page. Skipped unless
 * WH40K_FIXTURES points at a directory holding `missions.html` — the page is
 * GW content and never enters the repo.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMissionDeckHtml } from './parseDeck'
import { FORCE_DISPOSITIONS, blockApplies, primaryFor, slug, titleCase } from './types'

const dir = process.env['WH40K_FIXTURES']
const file = dir ? join(dir, 'missions.html') : ''
const available = Boolean(file && existsSync(file))

describe('mission deck schema helpers', () => {
  it('slugs and title-cases card names', () => {
    expect(slug("DESTROYER'S WRATH")).toBe('destroyers-wrath')
    expect(titleCase('SECURE NO MAN’S LAND')).toBe('Secure no Man’s Land')
    expect(titleCase('TAKE AND HOLD')).toBe('Take and Hold')
  })

  it('knows which battle rounds a scoring block applies to', () => {
    expect([1, 2, 3, 4, 5].map((r) => blockApplies('ANY BATTLE ROUND', r))).toEqual([true, true, true, true, true])
    expect([1, 2, 3].map((r) => blockApplies('FIRST AND SECOND BATTLE ROUND', r))).toEqual([true, true, false])
    expect([1, 2, 5].map((r) => blockApplies('SECOND BATTLE ROUND ONWARDS', r))).toEqual([false, true, true])
    expect([1, 2, 4, 5].map((r) => blockApplies('SECOND TO FOURTH BATTLE ROUND', r))).toEqual([false, true, true, false])
    expect([4, 5].map((r) => blockApplies('FIFTH BATTLE ROUND', r))).toEqual([false, true])
    expect(blockApplies('END OF THE BATTLE', 5)).toBe(false)
    expect(blockApplies('END OF THE BATTLE', 5, true)).toBe(true)
    expect(blockApplies('PRIMARY MISSION', 3)).toBe(true)
  })
})

describe.skipIf(!available)('mission deck parser on the real page', () => {
  const deck = () => parseMissionDeckHtml(readFileSync(file, 'utf8'))

  it('finds every deck at the sizes the Chapter Approved deck has', () => {
    const d = deck()
    expect(d.forceDispositions).toHaveLength(5)
    expect(d.forceDispositions.every((c) => c.rows.length === 5)).toBe(true)
    expect(d.primaries).toHaveLength(25)
    expect(d.deployments).toHaveLength(6)
    expect(d.secondaries).toHaveLength(18)
    expect(d.twists).toHaveLength(6)
  })

  it('maps every disposition pairing to a primary mission card', () => {
    const d = deck()
    for (const mine of FORCE_DISPOSITIONS)
      for (const theirs of FORCE_DISPOSITIONS) {
        const primary = primaryFor(d, mine, theirs)
        expect(primary, `${mine} vs ${theirs}`).toBeDefined()
        expect(primary!.disposition).toBe(mine)
        expect(primary!.opponentDisposition).toBe(theirs)
      }
  })

  it('reads scoring blocks with timing, VP, cumulative bonuses and OR alternatives', () => {
    const d = deck()
    const withVp = d.primaries.flatMap((p) => p.blocks.flatMap((b) => b.lines)).filter((l) => l.vp !== undefined)
    expect(withVp.length).toBeGreaterThan(50)
    expect(d.primaries.some((p) => p.blocks.some((b) => b.lines.some((l) => l.cumulative && l.join === 'plus')))).toBe(true)
    expect(d.primaries.some((p) => p.blocks.some((b) => b.lines.some((l) => l.join === 'or')))).toBe(true)
    expect(d.primaries.every((p) => p.blocks.length > 0 && p.blocks.every((b) => b.header.length > 0))).toBe(true)
    expect(d.primaries.some((p) => p.blocks.some((b) => /Command phase/i.test(b.when ?? '')))).toBe(true)
  })

  it('reads secondary specifics: fixed eligibility, fixed/tactical values, caps, when-drawn, actions', () => {
    const d = deck()
    const fixed = d.secondaries.filter((s) => s.fixedEligible)
    expect(fixed.length).toBeGreaterThanOrEqual(4)
    expect(fixed.every((s) => s.blocks.some((b) => b.lines.some((l) => l.fixedVp !== undefined || l.vp !== undefined)))).toBe(true)
    expect(d.secondaries.some((s) => s.blocks.some((b) => b.lines.some((l) => l.fixedVp !== undefined && l.tacticalVp !== undefined && l.fixedVp !== l.tacticalVp)))).toBe(true)
    expect(d.secondaries.some((s) => s.blocks.some((b) => b.lines.some((l) => l.cap === 5)))).toBe(true)
    expect(d.secondaries.filter((s) => s.whenDrawn).length).toBeGreaterThanOrEqual(3)
    expect(d.secondaries.some((s) => s.actions.some((a) => a.rows.some((r) => r.label === 'STARTS')))).toBe(true)
  })

  it('keeps deployment card images as absolute URLs and twists as rules text', () => {
    const d = deck()
    expect(d.deployments.every((c) => c.imageUrl.startsWith('https://') && c.imageUrl.endsWith('.png'))).toBe(true)
    expect(d.twists.every((t) => t.intro.length > 0 || t.blocks.length > 0)).toBe(true)
  })
})
