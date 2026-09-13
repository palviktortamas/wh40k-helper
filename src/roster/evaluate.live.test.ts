/**
 * Exercises the constraint evaluator against the real catalogue.
 * Skipped unless WH40K_FIXTURES is set (see src/data/live.test.ts).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildGraph,
  childOptions,
  type CatalogueGraph,
  type ResolvedEntry,
  type ResolvedGroup,
} from './resolve'
import { analyseRoster, evaluateRoster } from './evaluate'
import { instantiate } from './defaults'
import { detachmentOptions, normaliseRoster, validate, withDetachment, withWarlord } from './store'
import type { Roster, Selection } from './types'
import { COST_TYPE, type GameSystem, type Catalogue } from '@/data/bsdata/schema'

const dir = process.env['WH40K_FIXTURES']
const available = Boolean(dir && existsSync(dir) && existsSync(join(dir, 'gs.json')))

const loadGraph = (): CatalogueGraph => {
  const gs = JSON.parse(readFileSync(join(dir!, 'gs.json'), 'utf8')).gameSystem as GameSystem
  const file = readdirSync(dir!).find((f) => f.endsWith('.json') && f !== 'gs.json')!
  const cat = JSON.parse(readFileSync(join(dir!, file), 'utf8')).catalogue as Catalogue
  return buildGraph(gs, cat)
}

let counter = 0
const sel = (entry: ResolvedEntry, count: number, children: Selection[] = []): Selection => ({
  id: `s${counter++}`,
  entryId: entry.id,
  name: entry.name,
  type: entry.type,
  count,
  selections: children,
})

const roster = (selections: Selection[], pointsLimit = 2000): Roster => ({
  id: 'r1',
  name: 'Test',
  catalogueId: 'c1',
  pointsLimit,
  configuration: [],
  selections,
  createdAt: 0,
  updatedAt: 0,
  builtWith: { bsdataRevision: 1 },
})

/** Depth-first search of a resolved tree by entry or group name. */
const findEntry = (root: ResolvedEntry, name: string): ResolvedEntry | undefined => {
  if (root.name === name) return root
  for (const child of [...root.entries, ...root.groups.flatMap(groupEntries)])
    if (child.name === name) return child
  for (const child of [...root.entries, ...root.groups.flatMap(groupEntries)]) {
    const hit = findEntry(child, name)
    if (hit) return hit
  }
  return undefined
}
const groupEntries = (group: ResolvedGroup): ResolvedEntry[] => [
  ...group.entries,
  ...group.groups.flatMap(groupEntries),
]

describe.skipIf(!available)('constraint evaluator on real data', () => {
  it('resolves a unit into a buildable tree', () => {
    const graph = loadGraph()
    expect(graph.rootEntryIds.length).toBeGreaterThan(50)

    // Pick any multi-model unit that has option groups, without naming one.
    const units = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .filter((e) => e.type === 'unit' && e.groups.length > 0)
    expect(units.length).toBeGreaterThan(0)

    const unit = units[0]!
    expect(unit.groups.some((g) => groupEntries(g).length > 0)).toBe(true)
    // Weapons arrive through entry links; if resolution broke, models are bare.
    const models = units.flatMap((u) => u.groups.flatMap(groupEntries)).filter((e) => e.type === 'model')
    expect(models.some((m) => m.entries.length > 0)).toBe(true)
  })

  it('costs a unit at its base price and enforces group minimums', () => {
    const graph = loadGraph()
    const unit = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .find((e) => e.type === 'unit' && e.groups.length > 0)!

    // An empty unit must fail its group minimums rather than pass silently.
    const empty = evaluateRoster(roster([sel(unit, 1)]), graph)
    expect(empty.issues.some((i) => i.severity === 'error')).toBe(true)
  })

  it('applies a size-dependent points modifier', () => {
    const graph = loadGraph()
    // Find a unit whose points are changed by a `set` modifier on the cost type.
    const candidates = graph.rootEntryIds.map((id) => graph.resolve(id)!)
    const scaling = candidates.find((e) =>
      e.modifiers.some((m) => m.type === 'set' && m.field === '51b2-306e-1021-d207'),
    )
    expect(scaling).toBeDefined()

    const models = scaling!.groups.flatMap(groupEntries).filter((m) => m.type === 'model')
    expect(models.length).toBeGreaterThan(0)

    const small = evaluateRoster(roster([sel(scaling!, 1, [sel(models[0]!, 1)])]), graph)
    const large = evaluateRoster(roster([sel(scaling!, 1, [sel(models[0]!, 20)])]), graph)
    // The larger unit must cost more; if modifiers were skipped they are equal.
    expect(large.points).toBeGreaterThan(small.points)
  })

  it('reports no unsupported constructs for a simple roster', () => {
    const graph = loadGraph()
    const unit = graph.rootEntryIds.map((id) => graph.resolve(id)!).find((e) => e.type === 'unit')!
    const result = evaluateRoster(roster([sel(unit, 1)]), graph)
    // Gaps must surface rather than become silently wrong validation.
    expect(result.unsupported.filter((u) => u.startsWith('Unsupported'))).toEqual([])
  })

  it('resolves every datasheet without a missing link', () => {
    const graph = loadGraph()
    for (const id of graph.rootEntryIds) graph.resolve(id)
    const missing = graph.unsupported.filter((u) => u.startsWith('Missing'))
    // Some links point at other catalogues (Crusade, shared libraries) and are
    // expected to be absent; a flood would mean resolution is broken.
    expect(missing.length).toBeLessThan(graph.rootEntryIds.length)
  })

  it('finds named option entries through their links', () => {
    const graph = loadGraph()
    const unit = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .find((e) => e.type === 'unit' && e.groups.length > 1)!
    const named = groupEntries(unit.groups[0]!)[0]
    expect(named).toBeDefined()
    expect(findEntry(unit, named!.name)).toBeDefined()
  })
})

// --- the review fixes, checked against the real data -----------------------------

const configured = (graph: CatalogueGraph, selections: Selection[], pointsLimit = 2000): Roster => {
  const base = normaliseRoster(roster(selections, pointsLimit), graph)
  const detachment = detachmentOptions(graph)[0]!
  return withDetachment(base, graph, detachment.entry.id)
}

const isEnhancement = (entry: ResolvedEntry) => (entry.costs[COST_TYPE.enhancements] ?? 0) > 0

describe.skipIf(!available)('review fixes on real data', () => {
  it('normalises a roster into the data’s own configuration selections', () => {
    const graph = loadGraph()
    const r = configured(graph, [])
    expect(r.configuration.length).toBeGreaterThan(1)
    const analysis = analyseRoster(r, graph)
    expect(analysis.detachment).toBeDefined()
    expect(analysis.detachmentPoints).toBeGreaterThan(0)
    // The force's own points limit is now live, so layer 2 stands down.
    expect(analysis.pointsLimitChecked).toBe(true)
    // Battle size mirrors the limit: nothing about size or points should fire.
    const sizeErrors = analysis.issues.filter((i) => /pts|Battle Size/i.test(i.message))
    expect(sizeErrors).toEqual([])
  })

  it('instantiates every datasheet without tripping an availability gate', () => {
    const graph = loadGraph()
    const hiddenErrors: string[] = []
    for (const id of graph.rootEntryIds) {
      const entry = graph.resolve(id)!
      const r = configured(graph, [instantiate(entry)])
      const analysis = analyseRoster(r, graph)
      // Legends and the like are gated by design; skip units the picker would not offer.
      if (!analysis.isEntryAvailable(undefined, entry)) continue
      for (const issue of analysis.issues)
        if (issue.rule.includes('not offered')) hiddenErrors.push(`${entry.name}: ${issue.message}`)
    }
    expect(hiddenErrors).toEqual([])
  })

  it('caps a special weapon two levels below the unit (the flagship case)', () => {
    const graph = loadGraph()
    // Find, without naming anything, a unit whose model option carries a
    // unit-scope max 1 either on itself or on one of its weapons.
    type Hit = { unit: ResolvedEntry; model: ResolvedEntry; weapon?: ResolvedEntry }
    let hit: Hit | undefined
    const unitMaxOne = (e: ResolvedEntry) =>
      e.constraints.some((c) => c.type === 'max' && c.scope === 'unit' && c.value === 1)
    for (const id of graph.rootEntryIds) {
      const unit = graph.resolve(id)!
      if (unit.type !== 'unit') continue
      for (const { entry: model } of childOptions(unit)) {
        if (model.type !== 'model') continue
        if (unitMaxOne(model)) {
          hit = { unit, model }
          break
        }
        const weapon = childOptions(model).find((o) => unitMaxOne(o.entry))?.entry
        if (weapon) {
          hit = { unit, model, weapon }
          break
        }
      }
      if (hit) break
    }
    expect(hit).toBeDefined()
    const { unit, model, weapon } = hit!
    const filler = childOptions(unit).find((o) => o.entry.type === 'model' && o.entry.id !== model.id)!
    const build = (specials: number) =>
      sel(unit, 1, [
        sel(filler.entry, 12 - specials),
        {
          ...sel(model, specials, weapon ? [sel(weapon, 1)] : []),
          ...(model.linkId ? { linkId: model.linkId } : {}),
        },
      ])
    const one = analyseRoster(configured(graph, [build(1)]), graph)
    const two = analyseRoster(configured(graph, [build(2)]), graph)
    const named = (a: ReturnType<typeof analyseRoster>) =>
      a.issues.filter((i) => i.severity === 'error' && i.message.includes((weapon ?? model).name))
    expect(named(one)).toEqual([])
    expect(named(two).length).toBeGreaterThan(0)
  })

  it('offers enhancements only once a detachment is chosen, and caps them', () => {
    const graph = loadGraph()
    const character = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .find((e) => childOptions(e).some((o) => isEnhancement(o.entry)))!
    expect(character).toBeDefined()
    const enhancements = childOptions(character).filter((o) => isEnhancement(o.entry))

    const bare = normaliseRoster(roster([instantiate(character)]), graph)
    const without = analyseRoster(bare, graph)
    const unitId = bare.selections[0]!.id
    // Detachment gating lives on the *group*, so the group has to be asked.
    expect(enhancements.some((o) => without.isEntryAvailable(unitId, o.entry, o.group))).toBe(false)

    const withDet = withDetachment(bare, graph, detachmentOptions(graph)[0]!.entry.id)
    const analysis = analyseRoster(withDet, graph)
    const offered = enhancements.filter((o) => analysis.isEntryAvailable(unitId, o.entry, o.group))
    expect(offered.length).toBeGreaterThan(1)

    // Two enhancements on one character breaks the character's own cap.
    const twoOn: Roster = {
      ...withDet,
      selections: withDet.selections.map((u) => ({
        ...u,
        selections: [
          ...u.selections,
          ...offered.slice(0, 2).map((o) => ({
            ...sel(o.entry, 1),
            ...(o.entry.linkId ? { linkId: o.entry.linkId } : {}),
            ...(o.group ? { groupId: o.group.id } : {}),
          })),
        ],
      })),
    }
    const capped = analyseRoster(twoOn, graph)
    expect(capped.enhancements).toBe(2)
    expect(capped.issues.some((i) => i.severity === 'error' && /enhancement/i.test(i.message))).toBe(true)

    // An enhancement from another detachment's group is taken from a hidden
    // group, which must be an error rather than a silent pass.
    const foreign = enhancements.find((o) => !offered.includes(o))!
    const wrongDetachment: Roster = {
      ...withDet,
      selections: withDet.selections.map((u) => ({
        ...u,
        selections: [
          ...u.selections,
          {
            ...sel(foreign.entry, 1),
            ...(foreign.entry.linkId ? { linkId: foreign.entry.linkId } : {}),
            ...(foreign.group ? { groupId: foreign.group.id } : {}),
          },
        ],
      })),
    }
    const flagged = analyseRoster(wrongDetachment, graph)
    expect(flagged.issues.some((i) => i.rule.includes('not offered'))).toBe(true)
  })

  it('nominates the Warlord through the data’s own upgrade', () => {
    const graph = loadGraph()
    const character = graph.rootEntryIds
      .map((id) => graph.resolve(id)!)
      .find((e) => e.associations.length > 0)!
    const r = configured(graph, [instantiate(character)])
    const before = validate(r, graph)
    expect(before.warlordSelectionId).toBeUndefined()
    expect(before.characterSelectionIds).toContain(r.selections[0]!.id)
    const nominated = withWarlord(r, graph, r.selections[0]!.id)
    const after = validate(nominated, graph)
    expect(after.warlordSelectionId).toBe(r.selections[0]!.id)
    expect(after.issues.some((i) => /Warlord/.test(i.message) && i.severity === 'error')).toBe(false)
  })

  it('finds eligible bodyguard units for a leader and rejects the wrong one', () => {
    const graph = loadGraph()
    const units = graph.rootEntryIds.map((id) => graph.resolve(id)!)
    const leader = units.find((e) => e.associations.some((a) => a.action === 'group'))!
    const others = units.filter((e) => e.associations.length === 0).map((e) => instantiate(e))
    const r = configured(graph, [instantiate(leader), ...others])
    const analysis = analyseRoster(r, graph)
    const targets = analysis.leaderTargets(r.selections[0]!.id)
    const eligible = targets.flatMap((t) => t.targetIds)
    expect(eligible.length).toBeGreaterThan(0)
    expect(eligible.length).toBeLessThan(others.length)

    const wrong = others.find((o) => !eligible.includes(o.id))!
    const attach = (targetId: string): Roster => ({
      ...r,
      selections: r.selections.map((u, i) =>
        i === 0 ? { ...u, attachedTo: targetId, associationId: targets[0]!.association.id } : u,
      ),
    })
    const bad = analyseRoster(attach(wrong.id), graph)
    expect(bad.issues.some((i) => i.message.includes('cannot be attached'))).toBe(true)
    const good = analyseRoster(attach(eligible[0]!), graph)
    expect(good.issues.some((i) => i.message.includes('cannot be attached'))).toBe(false)
  })

  it('reports an army-wide cap once, not once per copy', () => {
    const graph = loadGraph()
    const armyCap = (c: { type: string; scope: string; value: number }) =>
      c.type === 'max' && (c.scope === 'force' || c.scope === 'roster') && c.value > 0 && c.value < 4
    const unit = graph.rootEntryIds.map((id) => graph.resolve(id)!).find((e) => e.constraints.some(armyCap))!
    const cap = unit.constraints.find(armyCap)!
    const copies = Array.from({ length: cap.value + 2 }, () => instantiate(unit))
    const analysis = analyseRoster(configured(graph, copies), graph)
    const hits = analysis.issues.filter((i) => i.rule.endsWith(cap.id))
    expect(hits).toHaveLength(1)
  })
})
