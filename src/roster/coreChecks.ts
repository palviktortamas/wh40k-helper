/**
 * Layer 2 of validation (spec §5.3): the 11th-edition core rules, checked
 * directly rather than through the catalogue's constraint graph.
 *
 * These are belt-and-braces. The datafiles encode most of this already, but the
 * core rules do not depend on a community datafile being right, and each message
 * names the rule it comes from so an error is actionable at the table. Where the
 * data has demonstrably checked the same thing, the duplicate is skipped so one
 * mistake yields one message.
 */

import type { Datasheet } from '@/data/model'
import type { EvaluationResult } from './evaluate'
import type { CatalogueGraph } from './resolve'
import type { Roster, ValidationIssue } from './types'
import { EPIC_HERO_CATEGORY } from './vocabulary'
import { attachmentKind } from './attachment'

/** Leaving this much unspent is legal but usually a mistake. */
const UNSPENT_WARNING_THRESHOLD = 50

/**
 * Models in a unit that could carry wargear and carry none. A model whose
 * datasheet gives it no choices (its weapons are printed, not selected) is not
 * unarmed — it simply has nothing to choose, so only models whose entry offers
 * something count.
 */
function unarmedModels(
  unit: Roster['selections'][number],
  graph: CatalogueGraph,
): { name: string; count: number }[] {
  const found = new Map<string, number>()
  const walk = (node: Roster['selections'][number]) => {
    for (const child of node.selections) {
      if (child.type === 'model') {
        const entry = graph.resolve(child.entryId)
        const offersSomething = Boolean(entry && (entry.entries.length > 0 || entry.groups.length > 0))
        if (offersSomething && child.selections.length === 0)
          found.set(child.name, (found.get(child.name) ?? 0) + child.count)
      }
      walk(child)
    }
  }
  walk(unit)
  return [...found].map(([name, count]) => ({ name, count }))
}

/**
 * The sizes a datasheet actually comes in, from the price list the sources
 * publish: "3 models … 80 pts, 6 models … 160 pts" *is* the statement that the
 * unit comes in threes and sixes. The constraint graph cannot say it — BSData
 * writes that squad as a 3-to-6 group, so four and five pass every check, cost
 * the six-model price, and field one model short with nothing said.
 *
 * Absent on a device that has not downloaded the points mirror, in which case
 * there is nothing to compare against and nothing is claimed.
 */
const sizesOf = (sheet: Datasheet | undefined): number[] =>
  (sheet?.pricing?.[0]?.costs ?? []).map((cost) => cost.models).filter((n) => n > 0)

const listSizes = (sizes: readonly number[]): string =>
  sizes.length === 1 ? `${sizes[0]}` : `${sizes.slice(0, -1).join(', ')} or ${sizes[sizes.length - 1]}`

export function coreChecks(
  roster: Roster,
  evaluation: EvaluationResult,
  graph: CatalogueGraph,
  /** The installed datasheets, when the caller has them: only the size check needs them. */
  sheets: readonly Datasheet[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const sheetOf = new Map(sheets.map((sheet) => [sheet.id, sheet]))

  if (evaluation.points > roster.pointsLimit && !evaluation.pointsLimitChecked) {
    issues.push({
      severity: 'error',
      message: `Army costs ${evaluation.points} pts, over the ${roster.pointsLimit} pt limit by ${
        evaluation.points - roster.pointsLimit
      }.`,
      rule: 'Core Rules — Muster Armies: points limit',
    })
  }

  if (roster.selections.length > 0) {
    if (!evaluation.warlordSelectionId) {
      if (!evaluation.warlordChecked)
        issues.push({
        severity: 'error',
          message: 'No Warlord nominated. Exactly one Character must be your Warlord.',
          rule: 'Core Rules — Muster Armies: Warlord',
        })
    } else if (!evaluation.characterSelectionIds.includes(evaluation.warlordSelectionId)) {
      issues.push({
        severity: 'error',
        selectionId: evaluation.warlordSelectionId,
        message: 'The Warlord must be a Character.',
        rule: 'Core Rules — Muster Armies: Warlord',
      })
    }

    // How many detachments an army may take is the Detachment Points budget's
    // business, and the data enforces that; all this layer insists on is that
    // an army has one at all.
    if (evaluation.detachments.length === 0) {
      issues.push({
        severity: 'error',
        message: 'No detachment chosen. An army must have at least one detachment.',
        rule: 'Core Rules — Muster Armies: detachment',
      })
    }

    // Epic Heroes are unique. The data caps each at one already; this catches
    // a catalogue that forgot.
    const epicHero = [...graph.categories.values()].find((c) => c.name === EPIC_HERO_CATEGORY)?.id
    if (epicHero) {
      const seen = new Map<string, number>()
      for (const unit of roster.selections) {
        const entry = graph.resolve(unit.entryId)
        if (!entry?.categoryIds.includes(epicHero)) continue
        seen.set(entry.id, (seen.get(entry.id) ?? 0) + unit.count)
      }
      for (const [entryId, count] of seen) {
        if (count <= 1) continue
        const alreadyReported = evaluation.issues.some(
          (i) => i.selectionId && roster.selections.some((u) => u.id === i.selectionId && u.entryId === entryId),
        )
        if (alreadyReported) continue
        issues.push({
          severity: 'error',
          message: `${graph.resolve(entryId)?.name ?? 'An Epic Hero'} is an Epic Hero and may be included only once.`,
          rule: 'Core Rules — Muster Armies: Epic Heroes',
        })
      }
    }

    // A model that can carry wargear and carries none is a model that will
    // roll no dice. The data's own minimums usually catch it as an error, but
    // not always — and "Boyz #2 has 6 models with nothing to fight with" is
    // the sentence that actually gets it fixed.
    for (const unit of roster.selections) {
      const empty = unarmedModels(unit, graph)
      if (empty.length === 0) continue
      issues.push({
        severity: 'warning',
        selectionId: unit.id,
        message: `${unit.name}: ${empty
          .map(({ name, count }) => `${count}× ${name}`)
          .join(', ')} ${empty.length === 1 && empty[0]!.count === 1 ? 'has' : 'have'} no weapons or wargear chosen.`,
        rule: 'Housekeeping',
      })
    }

    // A unit one model short of a size the datasheet offers.
    for (const unit of roster.selections) {
      const sizes = sizesOf(sheetOf.get(unit.entryId))
      if (sizes.length === 0) continue
      const models = unit.selections
        .filter((s) => s.type === 'model')
        .reduce((sum, s) => sum + s.count, 0)
      if (models === 0 || sizes.includes(models)) continue
      issues.push({
        severity: 'warning',
        selectionId: unit.id,
        message: `${unit.name} has ${models} models; the datasheet comes in ${listSizes(sizes)}.`,
        rule: 'Core Rules — Unit composition',
      })
    }

    // A character that can join a unit but has not is legal, but usually an
    // oversight. Leaders and Support characters attach under different rules,
    // so the message has to name the right one.
    for (const unit of roster.selections) {
      const entry = graph.resolve(unit.entryId)
      if (!entry || unit.attachedTo) continue
      const kind = attachmentKind(entry)
      if (!kind) continue
      issues.push({
        severity: 'warning',
        selectionId: unit.id,
        message:
          kind.key === 'leader'
            ? `${unit.name} has the Leader ability but is not attached to a unit.`
            : `${unit.name} is a ${kind.label} character but is not attached to a unit.`,
        rule: `Core Rules — ${kind.label}`,
      })
    }
  }

  const unspent = roster.pointsLimit - evaluation.points
  if (unspent > UNSPENT_WARNING_THRESHOLD && roster.selections.length > 0) {
    issues.push({
      severity: 'warning',
      message: `${unspent} pts unspent.`,
      rule: 'Housekeeping',
    })
  }

  // A gap in the evaluator would otherwise look like a clean roster, which is
  // worse than saying so plainly.
  const gaps = [...new Set(evaluation.unsupported)]
  for (const gap of gaps.slice(0, 5)) {
    issues.push({
      severity: 'warning',
      message: `Validation gap: ${gap}`,
      rule: 'Constraint evaluator coverage',
    })
  }

  return issues
}
