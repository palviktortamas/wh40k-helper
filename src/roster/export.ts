/**
 * Plain-text roster export (spec §5.1): readable at the table, pasteable into a
 * message, no app required to read it.
 */

import type { CatalogueGraph } from './resolve'
import type { Roster, Selection } from './types'
import type { Validation } from './store'
import { COST_TYPE } from '@/data/bsdata/schema'

/** Collapses a selection's children into "2x Rokkit launcha, 9x Choppa". */
function summarise(selection: Selection): string {
  const counts = new Map<string, number>()
  const walk = (node: Selection, multiplier: number) => {
    for (const child of node.selections) {
      const total = child.count * multiplier
      if (child.type === 'upgrade') counts.set(child.name, (counts.get(child.name) ?? 0) + total)
      walk(child, total)
    }
  }
  walk(selection, 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => (count === 1 ? name : `${count}x ${name}`))
    .join(', ')
}

/** Model lines: "9x Boy", "2x Boy w/ Rokkit launcha". */
function models(selection: Selection): { name: string; count: number; loadout: string }[] {
  const out: { name: string; count: number; loadout: string }[] = []
  const walk = (node: Selection) => {
    for (const child of node.selections) {
      if (child.type === 'model') out.push({ name: child.name, count: child.count, loadout: summarise(child) })
      walk(child)
    }
  }
  walk(selection)
  return out
}

export function exportRosterText(
  roster: Roster,
  graph: CatalogueGraph,
  validation: Validation,
  catalogueName: string,
): string {
  const lines: string[] = []
  lines.push(roster.name)
  lines.push(`${catalogueName} — ${validation.points}/${roster.pointsLimit} pts`)

  if (roster.detachmentId) {
    const detachment = graph.resolve(roster.detachmentId)
    if (detachment) lines.push(`Detachment: ${detachment.name}`)
  }
  lines.push('')

  for (const unit of roster.selections) {
    const entry = graph.resolve(unit.entryId)
    const points = entry?.costs[COST_TYPE.points]
    const size = models(unit).reduce((sum, m) => sum + m.count, 0)
    const warlord = roster.warlordSelectionId === unit.id ? ' [WARLORD]' : ''
    lines.push(
      `${unit.name}${size > 1 ? ` (${size})` : ''}${points ? ` — ${points} pts` : ''}${warlord}`,
    )

    for (const model of models(unit)) {
      lines.push(`  ${model.count}x ${model.name}${model.loadout ? `: ${model.loadout}` : ''}`)
    }
    // Upgrades hanging directly off the unit — enhancements and the like.
    for (const child of unit.selections) {
      if (child.type === 'upgrade') lines.push(`  ${child.name}`)
    }
    lines.push('')
  }

  if (validation.errors.length > 0) {
    lines.push(`!! ${validation.errors.length} validation errors — this list is not legal.`)
  }
  // The roster export must say when a number it shows is disputed (spec §4.1).
  const gaps = validation.warnings.filter((w) => w.rule === 'Constraint evaluator coverage')
  if (gaps.length > 0) lines.push(`!! ${gaps.length} unresolved data discrepancies affect this list.`)

  return lines.join('\n').trimEnd()
}
