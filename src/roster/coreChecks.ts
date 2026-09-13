/**
 * Layer 2 of validation (spec §5.3): the 11th-edition core rules, checked
 * directly rather than through the catalogue's constraint graph.
 *
 * These are belt-and-braces. The datafiles encode most of this already, but the
 * core rules do not depend on a community datafile being right, and each message
 * names the rule it comes from so an error is actionable at the table.
 */

import type { EvaluationResult } from './evaluate'
import type { Roster, ValidationIssue } from './types'

/** Leaving this much unspent is legal but usually a mistake. */
const UNSPENT_WARNING_THRESHOLD = 50

export function coreChecks(roster: Roster, evaluation: EvaluationResult): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (evaluation.points > roster.pointsLimit) {
    issues.push({
      severity: 'error',
      message: `Army costs ${evaluation.points} pts, over the ${roster.pointsLimit} pt limit by ${
        evaluation.points - roster.pointsLimit
      }.`,
      rule: 'Core Rules — Muster Armies: points limit',
    })
  }

  if (roster.selections.length > 0) {
    if (!roster.warlordSelectionId) {
      issues.push({
        severity: 'error',
        message: 'No Warlord nominated. Exactly one Character must be your Warlord.',
        rule: 'Core Rules — Muster Armies: Warlord',
      })
    } else if (!findSelection(roster, roster.warlordSelectionId)) {
      issues.push({
        severity: 'error',
        message: 'The nominated Warlord is no longer in the army.',
        rule: 'Core Rules — Muster Armies: Warlord',
      })
    }

    if (!roster.detachmentId) {
      issues.push({
        severity: 'error',
        message: 'No detachment chosen. An army must have exactly one detachment.',
        rule: 'Core Rules — Muster Armies: detachment',
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

export function findSelection(roster: Roster, id: string) {
  const walk = (selections: Roster['selections']): Roster['selections'][number] | undefined => {
    for (const selection of selections) {
      if (selection.id === id) return selection
      const hit = walk(selection.selections)
      if (hit) return hit
    }
    return undefined
  }
  return walk(roster.selections)
}
