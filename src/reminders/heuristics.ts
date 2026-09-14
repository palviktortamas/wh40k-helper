/**
 * Keyword heuristics over rule text (spec §6.4). Generic on purpose: they read
 * the game's own phase vocabulary ("in your Shooting phase", "once per battle",
 * "selected to charge") and nothing faction-specific. They only produce
 * defaults — the owner overrides per ability in Settings → Reminders.
 */

import type { Inferred, Once, Trigger } from './types'

const TAGS = /<[^>]+>/g
const SPACES = /\s+/g

/** Rule text may carry HTML from a rules-text source; reminders are plain. */
export const plainText = (text: string): string =>
  text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(TAGS, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // Some sources mark keywords in bold with markdown asterisks.
    .replace(/\*\*/g, '')
    .replace(SPACES, ' ')
    .trim()

const MAX_TEXT = 140

/** The first sentence, cut to a glanceable length. */
export function shortText(text: string): string {
  const plain = plainText(text)
  if (!plain) return ''
  const sentence = plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain
  const chosen = sentence.length < 24 && plain.length > sentence.length ? plain : sentence
  return chosen.length > MAX_TEXT ? `${chosen.slice(0, MAX_TEXT - 1).trimEnd()}…` : chosen
}

/**
 * A rule names a **moment** when it says when to act — "in your Shooting
 * phase", "each time this unit is selected to fight", "when an enemy unit
 * declares a charge". It merely uses a phase's **vocabulary** when it changes
 * something continuously — "ranged attacks that target this unit have -1 D".
 *
 * Only a moment is a trigger. Matching vocabulary was what put a passive
 * modifier into every Shooting phase, and a rule's *duration* ("until the end
 * of the turn") into End of turn.
 *
 * Ordered: the first match wins, so a stated phase ("in your Shooting phase")
 * is tried before the looser moments that a long rule may also mention.
 */
/**
 * A rule that opens by naming its phase means that phase, whatever it goes on
 * to mention — "In your Shooting phase, …, until the end of the turn" is a
 * Shooting phase rule, not an End of turn one. Tested against the rule's own
 * text, where the opening clause really is the opening clause.
 */
const STATED_PHASE: [RegExp, Trigger][] = [
  [/^[^.]{0,70}\b(?:in|at the start of|at the end of|during) (?:your|the|each|each player'?s) command phase\b/i, 'command_phase'],
  [/^[^.]{0,70}\b(?:in|at the start of|at the end of|during) (?:your|the|each) movement phase\b/i, 'movement_phase'],
  [/^[^.]{0,70}\b(?:in|at the start of|at the end of|during) (?:your|the|each) shooting phase\b/i, 'shooting_phase'],
  [/^[^.]{0,70}\b(?:in|at the start of|at the end of|during) (?:your|the|each) charge phase\b/i, 'charge_phase'],
  [/^[^.]{0,70}\b(?:in|at the start of|at the end of|during) (?:your|the|each) fight phase\b/i, 'fight_phase'],
]

const TRIGGER_RULES: [RegExp, Trigger][] = [
  [/\b(start of the battle|before the (first )?battle round|during deployment|after both players have deployed|at the start of the first battle round|set up .* in reserves)/i, 'start_of_battle'],
  [/\b(arrives? from (strategic )?reserves|set up (on the battlefield )?as reinforcements|arrives? as reinforcements|deep strike|when this unit is set up on the battlefield)/i, 'on_arrival_from_reserves'],
  [/\b(is charged|are charged|declares? a charge against|charges? (this|a friendly)|when an enemy unit .{0,40}charges|heroic intervention|ends a charge move within)/i, 'when_charged'],
  [/\b(selected as the target|is targeted|are targeted|targets? (this|a friendly) (unit|model)|each time an attack (targets|is allocated))/i, 'when_targeted'],
  // A *duration* is not a moment: "until the end of the turn" says how long an
  // effect lasts, not when to do anything.
  [/\b(?<!until the )(end of your turn|end of the turn|at the end of each turn|end of your opponent'?s turn)/i, 'end_of_turn'],
  [/\b(your opponent'?s (turn|command|movement|shooting|charge|fight) phase|in your opponent'?s turn|during (your|the) opponent'?s|enemy (unit'?s )?(shooting|charge|fight) phase|in the enemy)/i, 'opponent_turn'],

  // Moments inside a phase, for rules that never name the phase outright.
  [/\b(battle-?shock test|at the start of (?:your|the) command phase)/i, 'command_phase'],
  [/\b(selected to move|selected to make an? (?:advance|normal|fall.?back|advance\/fall-back)|makes? a normal move|is selected to (?:advance|fall back)|when this unit advances|disembark move)/i, 'movement_phase'],
  [/\b(selected to shoot|has shot|makes? ranged attacks|overwatch)/i, 'shooting_phase'],
  // "eligible to declare a charge" describes the state a move leaves a unit
  // in; it is not a moment in the Charge phase.
  [/\b(selected to charge|(?<!eligible to )declares? a charge|makes? a charge (?:move|roll))/i, 'charge_phase'],
  [/\b(selected to fight|fights? first|pile.?in|consolidat)/i, 'fight_phase'],
]

/**
 * A rule that belongs to building the list rather than playing the game. These
 * are settled before the first turn and can never be acted on at the table, so
 * they are noise in a phase panel.
 *
 * Deliberately narrow. A passive rule is *not* useless — "attacks that target
 * this unit have -1 to wound" is exactly what you need reminding of the moment
 * you are shot at — so only rules that are about army composition are dropped.
 */
const LIST_BUILDING =
  /\b(muster armies|mustering your army|army roster|army composition|can be attached to the following|this model can be attached to|points value of your army)\b/i

/** A rule whose entire content is granting a keyword or a battlefield role. */
const ONLY_A_KEYWORD_GRANT =
  /^[-\s•]*(?:friendly\s+)?[A-Za-z' ]{0,40}\b(?:units?|models?)\s+(?:have|has|gains?)\s+[A-Z][A-Z'\- ]{2,}\.?$/

// "Once per battle" and "once per battle round" differ by one word and by a
// whole game: a once-per-round ability filed as once-per-battle disappears
// after its first use and never returns.
const ONCE_BATTLE = /\bonce per battle\b(?!\s+round)/i
const ONCE_TURN = /\bonce per (turn|battle round|phase)\b/i

/**
 * An ability that fires when a model dies is not something to remember — it
 * happens on its own, and it would otherwise surface in whatever phase its
 * text happens to name ("…have made their disembark moves"). It starts off;
 * the owner can switch it on in Settings → Reminders like any other.
 */
const ON_DESTRUCTION = /\beach time (?:a|this) (?:model|unit)\b[^.]{0,80}\bis destroyed\b/i

export function inferOnce(text: string): Once | undefined {
  if (ONCE_BATTLE.test(text)) return 'battle'
  if (ONCE_TURN.test(text)) return 'turn'
  return undefined
}

export function inferTrigger(text: string, ownText = text): Trigger {
  const plainOwn = plainText(ownText)
  for (const [pattern, trigger] of STATED_PHASE) if (pattern.test(plainOwn)) return trigger
  for (const [pattern, trigger] of TRIGGER_RULES) if (pattern.test(text)) return trigger
  return 'custom'
}

/**
 * Defaults for one rule. The name takes part in the match ("Waaagh!" alone
 * says nothing, but "War Cry (Once per battle)" does). A once-per-battle rule
 * with no phase of its own is an "any time, once" reminder; a rule with
 * neither a moment nor a limit is passive and starts disabled.
 */
/**
 * The clause a rule's reminder should quote: the one that says when to act.
 *
 * A rule can open with an aside that belongs to list-building — "Friendly
 * WARBIKERS units have BATTLELINE." — and carry its real content in the next
 * bullet. Quoting the first sentence then showed the aside and nothing else,
 * which reads as a reminder that reminds you of nothing.
 */
function momentClause(rawText: string, trigger: Trigger): string | undefined {
  if (trigger === 'custom') return undefined
  const clauses = plainText(rawText)
    .split(/(?<=[.;:])\s+|\s+(?=[-•]\s)/)
    .map((clause) => clause.replace(/^[-•]\s*/, '').trim())
    .filter((clause) => clause.length > 12)
  return clauses.find((clause) => inferTrigger(clause, clause) === trigger)
}

export function infer(name: string, rawText: string): Inferred {
  const text = plainText(`${name}. ${rawText}`)
  const once = inferOnce(text)
  let trigger = inferTrigger(text, rawText)
  if (trigger === 'custom' && once === 'battle') trigger = 'once_per_battle'
  if (trigger === 'custom' && once === 'turn') trigger = 'once_per_turn'
  return {
    trigger,
    text: shortText(momentClause(rawText, trigger) ?? rawText) || plainText(name),
    ...(once ? { once } : {}),
    // Enabled when there is a moment to act on and the rule is about playing
    // rather than list-building. A passive that changes what happens at that
    // moment still earns its place.
    enabled:
      trigger !== 'custom' &&
      !ON_DESTRUCTION.test(text) &&
      !LIST_BUILDING.test(text) &&
      !ONLY_A_KEYWORD_GRANT.test(plainText(rawText)),
  }
}
