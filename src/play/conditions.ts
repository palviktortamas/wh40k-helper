/**
 * Whether a rule's condition holds right now.
 *
 * A condition is the rule's own clause — "while this unit is riled up", "if
 * this unit made a charge move this turn" — and the states are what the player
 * has told the tracker: the faction states the unit is in and the situations it
 * is in (see marks.ts and situations.ts). A condition is met when it names one
 * of them.
 *
 * The one trap is negation. Half a codex is written "if this unit is **not**
 * battle-shocked", and a plain substring test turns every one of those live the
 * moment the unit *is* battle-shocked — the exact opposite of the rule. So a
 * mention that is negated does not count.
 */

/** "not battle-shocked", "isn't riled up", "no longer worked up". */
// The window is short on purpose: a negation that governs a mention sits right
// in front of it ("is not battle-shocked", "no longer worked up"). Widen it and
// an unrelated negation earlier in the clause swallows the mention that follows
// ("if this unit is not embarked and is worked up").
const NEGATED = /\b(?:not|never|no longer|cannot|can't|isn't|aren't|without)\b[^.;]{0,10}$/i

/**
 * What the app knows about the unit without being told. A condition it can
 * settle itself must never be a toggle: the model count changes as models die,
 * and asking the player to keep a switch in step with it is asking them to be
 * the bug.
 */
export type Facts = {
  /** Models still alive in the unit. */
  models?: number
  /** This model is attached to a unit as its Leader. */
  leading?: boolean
}

/** "while this unit contains 10 or more models" */
const MODELS = /\b(\d+)\s+or\s+more\s+models\b/i
/** "while this model is leading a unit" */
const LEADING = /\bis\s+leading\s+a\s+unit\b/i

export function conditionMet(
  when: string | undefined,
  states: readonly string[],
  facts: Facts = {},
): boolean {
  if (!when) return true
  const text = when.toLowerCase()

  const counted = MODELS.exec(text)
  if (counted && facts.models !== undefined && !NEGATED.test(text.slice(0, counted.index)))
    return facts.models >= Number(counted[1])
  const leads = LEADING.exec(text)
  if (leads && facts.leading !== undefined && !NEGATED.test(text.slice(0, leads.index)))
    return facts.leading

  return states.some((state) => {
    const needle = state.toLowerCase().trim()
    if (!needle) return false
    let at = text.indexOf(needle)
    while (at !== -1) {
      if (!NEGATED.test(text.slice(0, at))) return true
      at = text.indexOf(needle, at + needle.length)
    }
    return false
  })
}
