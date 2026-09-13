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
 * Ordered: the first pattern that matches wins, so the specific ("selected to
 * charge") is listed before the general ("Charge phase"), and the opponent's
 * moments before your own phases.
 */
const TRIGGER_RULES: [RegExp, Trigger][] = [
  [/\b(start of the battle|before the (first )?battle round|during deployment|after both players have deployed|at the start of the first battle round|set up .* in reserves)/i, 'start_of_battle'],
  [/\b(arrives? from (strategic )?reserves|set up (on the battlefield )?as reinforcements|arrives? as reinforcements|deep strike|when this unit is set up on the battlefield)/i, 'on_arrival_from_reserves'],
  [/\b(is charged|are charged|declares? a charge against|charges? (this|a friendly)|when an enemy unit .{0,40}charges|heroic intervention|ends a charge move within)/i, 'when_charged'],
  [/\b(selected as the target|is targeted|are targeted|targeted by|targets? (this|a friendly) (unit|model)|each time an attack (targets|is allocated))/i, 'when_targeted'],
  [/\b(end of your turn|end of the turn|at the end of each turn|end of your opponent'?s turn)/i, 'end_of_turn'],
  [/\b(your opponent'?s (turn|command|movement|shooting|charge|fight) phase|in your opponent'?s turn|during (your|the) opponent'?s|enemy (unit'?s )?(shooting|charge|fight) phase|in the enemy)/i, 'opponent_turn'],
  [/\b((in|at the start of|at the end of|during) (your|each|the|each player'?s) command phase|battle-?shock test|command phase)/i, 'command_phase'],
  [/\b((in|during) (your|the) movement phase|normal move|advances?\b|falls? back|movement phase)/i, 'movement_phase'],
  [/\b((in|during) (your|the) shooting phase|selected to shoot|ranged (attack|weapon)s?|shooting phase|makes? ranged attacks|overwatch)/i, 'shooting_phase'],
  [/\b((in|during) (your|the) charge phase|selected to charge|declares? a charge|charge (move|roll|phase)|made a charge move this turn)/i, 'charge_phase'],
  [/\b((in|during) (your|the) fight phase|selected to fight|melee (attack|weapon)s?|fights? first|fight phase|pile.?in|consolidat)/i, 'fight_phase'],
]

const ONCE_BATTLE = /\bonce per battle\b/i
const ONCE_TURN = /\bonce per (turn|battle round|phase)\b/i

export function inferOnce(text: string): Once | undefined {
  if (ONCE_BATTLE.test(text)) return 'battle'
  if (ONCE_TURN.test(text)) return 'turn'
  return undefined
}

export function inferTrigger(text: string): Trigger {
  for (const [pattern, trigger] of TRIGGER_RULES) if (pattern.test(text)) return trigger
  return 'custom'
}

/**
 * Defaults for one rule. The name takes part in the match ("Waaagh!" alone
 * says nothing, but "War Cry (Once per battle)" does). A once-per-battle rule
 * with no phase of its own is an "any time, once" reminder; a rule with
 * neither a moment nor a limit is passive and starts disabled.
 */
export function infer(name: string, rawText: string): Inferred {
  const text = plainText(`${name}. ${rawText}`)
  const once = inferOnce(text)
  let trigger = inferTrigger(text)
  if (trigger === 'custom' && once === 'battle') trigger = 'once_per_battle'
  if (trigger === 'custom' && once === 'turn') trigger = 'once_per_turn'
  return {
    trigger,
    text: shortText(rawText) || plainText(name),
    ...(once ? { once } : {}),
    enabled: trigger !== 'custom',
  }
}
