/**
 * Which stratagems a game can use, and when. Pure functions over the imported
 * set; the Core Rules facts they encode (verified 2026-09-13 against the 11th
 * edition Core Rules): every army has the Core Stratagems, each detachment
 * adds its own, each Stratagem may be used once per phase, and a unit may be the
 * target of only one Stratagem per phase.
 */

import { normaliseName } from '@/data/link/merge'
import { ruleAppliesTo } from '@/roster/detachmentRules'
import { PHASE_LABELS, type Phase, type Side } from '@/play/types'
import type { Stratagem } from './types'

/**
 * The Core set plus the stratagems of every detachment the army took — an 11e
 * army may hold several at once, and each brings its own.
 */
export function forDetachment(all: readonly Stratagem[], detachmentNames: readonly string[]): Stratagem[] {
  const wanted = new Set(detachmentNames.map(normaliseName))
  return all.filter((s) => s.core || wanted.has(normaliseName(s.detachment)))
}

/** Whether a stratagem's printed turn and phase match the current moment. */
export function appliesNow(stratagem: Stratagem, phase: Phase, turn: Side): boolean {
  const t = stratagem.turn.toLowerCase()
  const turnOk = t.includes('either') || (turn === 'me' ? t.startsWith('your') : t.startsWith('opponent'))
  if (!turnOk) return false
  const p = stratagem.phase.toLowerCase()
  return p.includes('any') || p.includes(PHASE_LABELS[phase].toLowerCase())
}

/** Stratagems whose TARGET line names one of this unit's keywords (or any friendly unit). */
export function forUnit(list: readonly Stratagem[], keywords: readonly string[]): Stratagem[] {
  return list.filter((s) => ruleAppliesTo(s.target, keywords) !== false)
}

/** The per-phase "used" key; a Stratagem is once per phase (Core Rules). */
export const stratagemUseKey = (id: string, round: number, turn: Side, phase: Phase): string =>
  `${round}:${turn}:${phase}:${id}`
