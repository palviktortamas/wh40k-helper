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

export function conditionMet(when: string | undefined, states: readonly string[]): boolean {
  if (!when) return true
  const text = when.toLowerCase()
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
