/**
 * Runs the reminder heuristics over a real catalogue (fixture-gated, see
 * src/data/live.test.ts). Guards the defaults against silently degrading: most
 * abilities must land on a real trigger, and once-per-battle must be caught.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCatalogue } from '@/data/bsdata/parse'
import type { Catalogue, GameSystem } from '@/data/bsdata/schema'
import { remindersForCatalogue } from './derive'

const dir = process.env['WH40K_FIXTURES']
const available = Boolean(dir && existsSync(dir) && existsSync(join(dir, 'gs.json')))

describe.skipIf(!available)('reminder heuristics on a real catalogue', () => {
  it('gives most rules a trigger and catches once-per-battle', () => {
    const gs: GameSystem = JSON.parse(readFileSync(join(dir!, 'gs.json'), 'utf8')).gameSystem
    const file = readdirSync(dir!).find((f) => f.endsWith('.json') && f !== 'gs.json')!
    const cat: Catalogue = JSON.parse(readFileSync(join(dir!, file), 'utf8')).catalogue
    const groups = remindersForCatalogue(parseCatalogue(gs, cat), new Map())
    const all = groups.flatMap((g) => g.reminders)
    expect(all.length).toBeGreaterThan(100)
    const byTrigger: Record<string, number> = {}
    for (const r of all) byTrigger[r.trigger] = (byTrigger[r.trigger] ?? 0) + 1
    // Printed for the journal, never asserted on exact numbers — the data moves.
    console.log('trigger histogram', byTrigger, 'once', all.filter((r) => r.once).length, 'enabled', all.filter((r) => r.enabled).length)
    expect(all.filter((r) => r.trigger !== 'custom').length / all.length).toBeGreaterThan(0.6)
    expect(all.some((r) => r.once === 'battle')).toBe(true)
    expect(all.every((r) => r.text.length > 0 && r.text.length <= 140)).toBe(true)
  })
})
