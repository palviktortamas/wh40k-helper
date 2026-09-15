/**
 * Situations — the things that happened to a unit this turn, which its rules
 * then react to.
 *
 * The core rules name a handful of them (a unit charged, advanced, fell back,
 * is embarked, arrived from reserves, is battle-shocked) and a codex conditions
 * on them constantly: "if this unit made a charge move this turn, +1 A". The
 * app already tracked most as statuses — and did nothing with them: the rule
 * kept its `*` and its grey number whatever the player ticked.
 *
 * Two jobs here. Which situations a *particular* unit's rules react to, so the
 * table offers those and not a wall of toggles that change nothing; and the
 * phrases each one is written in, so switching it on makes those conditions
 * live wherever the effects are read.
 *
 * The vocabulary is the core rules', not any faction's — the same kind of
 * keyword matching the reminder heuristics use, and it works unchanged on a
 * codex added tomorrow.
 */

import type { UnitStatus } from './types'

export type Situation = {
  /** The status the app stores it as. */
  status: UnitStatus
  label: string
  /** How the rules write it; matched against a condition, lower-cased. */
  phrases: readonly string[]
}

export const SITUATIONS: readonly Situation[] = [
  {
    status: 'charged',
    label: 'Charged',
    phrases: ['made a charge move', 'charge move this turn', 'charged this turn', 'ends a charge move'],
  },
  {
    status: 'advanced',
    label: 'Advanced',
    phrases: ['advance move', 'advance/fall-back', 'advanced this turn', 'made an advance'],
  },
  {
    status: 'fellBack',
    label: 'Fell back',
    phrases: ['fall-back move', 'advance/fall-back', 'fell back', 'fallen back'],
  },
  { status: 'embarked', label: 'Embarked', phrases: ['embarked within', 'is embarked', 'while embarked'] },
  {
    status: 'arrived',
    label: 'Arrived',
    phrases: ['arrives from', 'arrived from', 'arrives as reinforcements', 'set up as reinforcements'],
  },
  {
    status: 'battleShocked',
    label: 'Battle-shocked',
    phrases: ['is battle-shocked', 'are battle-shocked', 'while battle-shocked'],
  },
]

const has = (text: string, phrase: string) => text.includes(phrase)

/**
 * The situations the given rule texts react to, in the order above. A unit
 * whose rules never mention one is offered nothing for it — the toggles have
 * to be the ones that change something, or nobody reads them.
 */
export function situationsIn(texts: readonly string[]): Situation[] {
  const folded = texts.map((text) => text.toLowerCase())
  return SITUATIONS.filter((situation) =>
    folded.some((text) => situation.phrases.some((phrase) => has(text, phrase))),
  )
}

/**
 * What the switched-on situations mean to a condition: the phrases that, found
 * in a rule's "while/if…" clause, mean the rule is in force right now.
 */
export const activePhrases = (statuses: readonly UnitStatus[]): string[] =>
  SITUATIONS.filter((situation) => statuses.includes(situation.status)).flatMap(
    (situation) => situation.phrases,
  )
