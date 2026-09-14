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

import type { EvaluationResult } from './evaluate'
import type { CatalogueGraph } from './resolve'
import type { Roster, ValidationIssue } from './types'
import { EPIC_HERO_CATEGORY } from './vocabulary'
import { attachmentKind } from './attachment'

/** Leaving this much unspent is legal but usually a mistake. */
const UNSPENT_WARNING_THRESHOLD = 50

export function coreChecks(
  roster: Roster,
  evaluation: EvaluationResult,
  graph: CatalogueGraph,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

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
