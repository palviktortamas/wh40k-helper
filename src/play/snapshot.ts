/**
 * Freezes a roster into the units a game tracks.
 *
 * The roster tree already distinguishes model types ("Boy" vs "Boy w/ Rokkit
 * launcha") and their per-copy weapons, which is exactly what lets Play Mode
 * ask which model died and keep the weapons table right. Stats come from the
 * parsed datasheet; everything is copied so later roster or data edits cannot
 * change a game in progress.
 */

import type { Datasheet, ParsedCatalogue } from '@/data/model'
import type { Roster, Selection } from '@/roster/types'
import type { Validation } from '@/roster/store'
import type { GameUnit, ModelGroup } from './types'
import { unitNames } from '@/roster/naming'

/** "Damaged: 1-4 Wounds Remaining" — the threshold is the upper bound. */
const DAMAGED = /damaged:\s*\d+\s*[-–]\s*(\d+)/i

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parseWounds = (raw: string | undefined): number => {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * The stat line for a model: an exact name match, else the longest stat-line
 * name the model name starts with ("Boy" for "Boy w/ Rokkit launcha"), else
 * the first line.
 */
function statsFor(sheet: Datasheet | undefined, modelName: string) {
  if (!sheet || sheet.stats.length === 0) return undefined
  const lower = modelName.toLowerCase()
  const exact = sheet.stats.find((s) => s.name.toLowerCase() === lower)
  if (exact) return exact
  const prefixed = sheet.stats
    .filter((s) => lower.startsWith(s.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0]
  return prefixed ?? sheet.stats[0]
}

const CONNECTORS = /\b(and|or|with|w\/|&)\b/gi

/**
 * Weapons under a model selection, per copy of that model. An upgrade that
 * holds further upgrades is a combined weapon ("X and Y"): its children are
 * weapons in their own right, and the container counts only for whatever part
 * of its name the children do not already cover — in the data the container
 * entry can itself be the second weapon.
 */
function weaponsOf(model: Selection): { name: string; perModel: number }[] {
  const counts = new Map<string, number>()
  const add = (name: string, n: number) => counts.set(name, (counts.get(name) ?? 0) + n)
  const walk = (node: Selection, multiplier: number) => {
    for (const child of node.selections) {
      const total = child.count * multiplier
      if (child.type === 'upgrade') {
        const parts = child.selections.filter((s) => s.type === 'upgrade')
        if (parts.length === 0) add(child.name, total)
        else {
          let remainder = child.name
          for (const part of parts) remainder = remainder.replace(new RegExp(escape(part.name), 'i'), ' ')
          remainder = remainder.replace(CONNECTORS, ' ').replace(/\s+/g, ' ').trim()
          if (/[a-z]/i.test(remainder)) add(remainder, total)
        }
      }
      walk(child, total)
    }
  }
  walk(model, 1)
  return [...counts.entries()].map(([name, perModel]) => ({ name, perModel }))
}

export function modelGroups(unit: Selection, sheet: Datasheet | undefined): ModelGroup[] {
  const groups: ModelGroup[] = []
  const walk = (node: Selection, multiplier: number) => {
    for (const child of node.selections) {
      const total = child.count * multiplier
      if (child.type === 'model') {
        const wounds = parseWounds(statsFor(sheet, child.name)?.w)
        groups.push({
          id: child.id,
          name: child.name,
          total,
          alive: total,
          wounds,
          currentWounds: wounds,
          weapons: weaponsOf(child),
        })
        continue
      }
      walk(child, total)
    }
  }
  walk(unit, 1)

  // A single-model datasheet is its own model.
  if (groups.length === 0) {
    const wounds = parseWounds(statsFor(sheet, unit.name)?.w)
    groups.push({
      id: unit.id,
      name: unit.name,
      total: unit.count,
      alive: unit.count,
      wounds,
      currentWounds: wounds,
      weapons: weaponsOf(unit),
    })
  }
  return groups
}

export function buildGameUnits(
  roster: Roster,
  catalogue: ParsedCatalogue,
  validation: Validation,
): GameUnit[] {
  const sheets = new Map(catalogue.datasheets.map((d) => [d.id, d]))
  // The table shows the same names the list was built with, numbering included,
  // so "Boyz #2 is Battle-shocked" means something.
  const names = unitNames(roster)
  const enhancementIds = new Set((catalogue.enhancements ?? []).map((e) => e.id))
  // Enhancements are upgrade selections somewhere under the unit whose entry carries an Enhancement cost.
  const enhancementsOf = (unit: Selection): { id: string; name: string }[] => {
    const found: { id: string; name: string }[] = []
    const walk = (node: Selection) => {
      for (const child of node.selections) {
        if (child.type === 'upgrade' && enhancementIds.has(child.entryId)) found.push({ id: child.entryId, name: child.name })
        walk(child)
      }
    }
    walk(unit)
    return found
  }
  return roster.selections.map((unit) => {
    const sheet = sheets.get(unit.entryId)
    const enhancements = enhancementsOf(unit)
    const damaged = sheet?.abilities
      .map((a) => DAMAGED.exec(`${a.name} ${a.text}`)?.[1])
      .find((hit) => hit !== undefined)
    return {
      id: unit.id,
      name: names.get(unit.id) ?? unit.name,
      entryId: unit.entryId,
      points: validation.unitPoints[unit.id] ?? 0,
      isCharacter: validation.characterSelectionIds.includes(unit.id),
      isWarlord: validation.warlordSelectionId === unit.id,
      ...(unit.attachedTo && roster.selections.some((u) => u.id === unit.attachedTo)
        ? { leaderOf: unit.attachedTo }
        : {}),
      models: modelGroups(unit, sheet),
      ...(damaged !== undefined ? { damagedAt: Number(damaged) } : {}),
      ...(sheet?.transportCapacity ? { transportCapacity: sheet.transportCapacity } : {}),
      statuses: [],
      destroyed: false,
      usedOnce: [],
      ...(enhancements.length > 0 ? { enhancements } : {}),
    }
  })
}
