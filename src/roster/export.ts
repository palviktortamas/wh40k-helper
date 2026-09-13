/**
 * Plain-text roster export (spec §5.1): readable at the table, pasteable into a
 * message, no app required to read it.
 */

import type { CatalogueGraph } from './resolve'
import type { Roster, Selection } from './types'
import type { Validation } from './store'
import { WARLORD_CATEGORY } from './vocabulary'

/** Collapses a selection's children into "2x Rokkit launcha, 9x Choppa". Counts are per copy of the parent. */
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
  const walk = (node: Selection, multiplier: number) => {
    for (const child of node.selections) {
      const total = child.count * multiplier
      if (child.type === 'model') out.push({ name: child.name, count: total, loadout: summarise(child) })
      walk(child, total)
    }
  }
  walk(selection, 1)
  return out
}

export function exportRosterText(
  roster: Roster,
  graph: CatalogueGraph,
  validation: Validation,
  catalogueName: string,
): string {
  const warlordCategory = [...graph.categories.values()].find((c) => c.name === WARLORD_CATEGORY)?.id
  const isWarlordMarker = (selection: Selection) =>
    warlordCategory !== undefined &&
    (graph.resolve(selection.entryId)?.categoryIds.includes(warlordCategory) ?? false)
  const lines: string[] = []
  lines.push(roster.name)
  lines.push(`${catalogueName} — ${validation.points}/${roster.pointsLimit} pts`)
  if (validation.detachment) {
    lines.push(`Detachment: ${validation.detachment.name} (${validation.detachment.dp} DP)`)
  }
  lines.push('')

  const unitLine = (unit: Selection, indent: string) => {
    const points = validation.unitPoints[unit.id]
    const size = models(unit).reduce((sum, m) => sum + m.count, 0)
    const warlord = validation.warlordSelectionId === unit.id ? ' [WARLORD]' : ''
    lines.push(
      `${indent}${unit.name}${size > 1 ? ` (${size})` : ''}${points ? ` — ${points} pts` : ''}${warlord}`,
    )
    for (const model of models(unit)) {
      lines.push(`${indent}  ${model.count}x ${model.name}${model.loadout ? `: ${model.loadout}` : ''}`)
    }
    // Upgrades hanging directly off the unit — enhancements and the like. The
    // Warlord upgrade is already shown as the [WARLORD] tag.
    for (const child of unit.selections) {
      if (child.type === 'upgrade' && !isWarlordMarker(child)) lines.push(`${indent}  ${child.name}`)
    }
  }

  // Leaders print inside the unit they lead, as the spec asks (§5.1).
  const attached = roster.selections.filter((u) => u.attachedTo)
  for (const unit of roster.selections) {
    if (unit.attachedTo && roster.selections.some((u) => u.id === unit.attachedTo)) continue
    unitLine(unit, '')
    for (const leader of attached.filter((l) => l.attachedTo === unit.id)) {
      lines.push('  Led by:')
      unitLine(leader, '    ')
    }
    lines.push('')
  }

  if (validation.errors.length > 0) {
    lines.push(`!! ${validation.errors.length} validation errors — this list is not legal.`)
  }
  // Say plainly when the validator could not read part of the data (spec §4.1
  // reserves "discrepancy" for source disagreements, so this is worded apart).
  const gaps = validation.warnings.filter((w) => w.rule === 'Constraint evaluator coverage')
  if (gaps.length > 0) lines.push(`!! ${gaps.length} validation gaps: parts of the data could not be checked.`)

  return lines.join('\n').trimEnd()
}
