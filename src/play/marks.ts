/**
 * Marks — states a faction's own rules name, grant, and then refer back to.
 *
 * The core rules' statuses (Battle-shock, Advanced, Fell Back…) are a fixed
 * list the app knows by name. A codex invents its own: "that unit is **worked
 * up** until the start of your next turn", and then a dozen datasheets say
 * "while this unit is worked up, …". The *mechanism* is not faction-specific,
 * so the marks are discovered from the installed data rather than listed here —
 * a faction added tomorrow brings its own and works unchanged.
 *
 * The data's own convention does the discriminating: it bolds unit keywords in
 * CAPITALS (**ORKS INFANTRY**) and writes states in prose (**riled up**). So a
 * bold phrase that is not shouting is a state.
 */

import { plainText } from '@/reminders/heuristics'
import { ruleAppliesTo } from '@/roster/detachmentRules'
import type { Ability, ParsedCatalogue } from '@/data/model'

/** A state the installed data names. */
export type Mark = {
  /** Folded for comparison. */
  key: string
  /** As the rules write it, for the screen. */
  label: string
}

/**
 * States the core rules already model, which the app tracks itself — a codex
 * mentioning one of these is not inventing anything.
 */
const CORE_STATES = new Set([
  // The damaged profile is a wounds threshold the app already tracks itself.
  'damaged',
  'battle-shocked',
  'battle shocked',
  'advanced',
  'fell back',
  'engaged',
  'unengaged',
  'destroyed',
  'below half-strength',
  'below half strength',
])

const fold = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

/** A bold phrase that reads as a state rather than as a keyword or a stat. */
function stateFrom(token: string): Mark | undefined {
  const raw = token.trim()
  if (!raw) return undefined
  // Keywords and weapon abilities shout; stats and rules mechanics are short
  // and bracketed. A state is two or three ordinary words.
  if (raw === raw.toUpperCase()) return undefined
  if (/[[\]\d]/.test(raw)) return undefined
  const words = raw.split(/\s+/)
  if (words.length > 3) return undefined
  // "selected to shoot" is a moment in a rule, not a state a unit is left in.
  if (/^selected\b/i.test(raw)) return undefined
  const key = fold(raw)
  if (CORE_STATES.has(key)) return undefined
  return { key, label: key }
}

/** "… is/are **X**" — the shape of both granting and referring to a state. */
const MENTIONS = /\b(?:is|are|becomes?|become|no longer)\s+\*\*([^*]+)\*\*/gi

/**
 * Every state the installed data names, each once.
 *
 * A phrase only counts when the data both **sets** it somewhere and **reads**
 * it somewhere: a state nothing can put a unit into is a turn of phrase, and a
 * state nothing reacts to changes nothing. That pair is what separates a real
 * mechanic from prose — on the owner's data it keeps the codex's own states and
 * drops "damaged" (read but never set) and "busted" (set but never read).
 */
export function discoverMarks(catalogue: ParsedCatalogue): Mark[] {
  const candidates = new Map<string, Mark>()
  const texts: string[] = []
  for (const text of everyRuleText(catalogue)) {
    texts.push(text)
    for (const match of text.matchAll(MENTIONS)) {
      const mark = stateFrom(match[1] ?? '')
      if (mark && !candidates.has(mark.key)) candidates.set(mark.key, mark)
    }
  }

  const kept = [...candidates.values()].filter((mark) => {
    const set = texts.some((text) => grantedMarks(text, [mark]).length > 0)
    if (!set) return false
    const reader = new RegExp(`\\b(while|if|whilst)\\b[^.]{0,90}\\*\\*${escape(mark.label)}\\*\\*`, 'i')
    return texts.some((text) => reader.test(plainTextKeepingBold(text)))
  })
  return kept.sort((a, b) => a.label.localeCompare(b.label))
}

function* everyRuleText(catalogue: ParsedCatalogue): Generator<string> {
  for (const sheet of catalogue.datasheets) for (const a of sheet.abilities) yield `${a.name}. ${a.text}`
  for (const detachment of catalogue.detachments)
    for (const rule of detachment.rules ?? []) yield `${rule.name}. ${rule.text}`
  for (const rule of catalogue.rules ?? []) yield `${rule.name}. ${rule.text}`
  for (const e of catalogue.enhancements ?? []) yield `${e.name}. ${e.text}`
}

/** Who an ability puts a mark on. */
export type GrantScope =
  /** The unit whose datasheet this is. */
  | 'self'
  /** One or more units the player picks. */
  | 'chosen'
  /** Every unit the rule's keywords reach. */
  | 'army'

export type Grant = {
  mark: Mark
  scope: GrantScope
  /** How long it lasts, in the rules' own words, when they say. */
  until?: string
}

const UNTIL = /\b(until (?:the )?[^.;]{3,60}?)(?=[.;,]|$)/i
/** "you can select one friendly X unit", "select a number of friendly X units" */
const CHOOSES = /\bselect(?:ed)?\s+(?:a number of|one|up to|\d+)?\s*friendly\b/i
/** "this unit is X" — the rule is about the unit whose datasheet it is. */
const ITSELF = /\bthis unit\b[^.]{0,40}\b(?:is|are|becomes?)\s+\*\*/i

/**
 * The marks an ability *grants*, with who gets them. A rule that only reads a
 * mark ("while this unit is worked up…") grants nothing.
 */
export function grantedMarks(rawText: string, marks: readonly Mark[]): Grant[] {
  const text = plainTextKeepingBold(rawText)
  const known = new Map(marks.map((m) => [m.key, m]))
  const out: Grant[] = []

  for (const sentence of text.split(/(?<=[.;])\s+/)) {
    for (const match of sentence.matchAll(MENTIONS)) {
      const key = fold(match[1] ?? '')
      const mark = known.get(key)
      if (!mark || out.some((g) => g.mark.key === key)) continue
      // "while/if this unit is X" reads the state, it does not set it — but
      // only when that clause actually governs this mention. A rule can open
      // with an unrelated condition ("if this unit is on the battlefield, …")
      // and then grant the state, so the clause must run unbroken to here.
      const before = sentence.slice(0, match.index ?? 0)
      if (/\b(while|whilst|if)\b[^.,;]*$/i.test(before)) continue
      if (/\bno longer\b/i.test(match[0])) continue

      // A state belongs to a unit or a model; rules also do things to objective
      // markers and terrain, which are not states a unit can be in. Asked of
      // the whole rule, because its subject is often a line above: "That unit:
      // — Is no longer battle-shocked. — Is riled up until …".
      if (!/\b(units?|models?)\b/i.test(text)) continue

      // Who gets it is a property of the rule, not of the sentence that grants
      // it: an army rule names its audience once at the top and grants the
      // state three bullets later ("Friendly ORKS with this ability can: …
      // Become riled up"), so the sweep has to be read from the whole rule.
      const scope: GrantScope = CHOOSES.test(text)
        ? 'chosen'
        : ITSELF.test(sentence)
          ? 'self'
          : /\bfriendly\b/i.test(text)
            ? 'army'
            : 'self'
      const until = UNTIL.exec(sentence)?.[1]
      out.push({ mark, scope, ...(until ? { until: until.trim() } : {}) })
    }
  }
  return out
}

/**
 * `plainText` strips the bold marks, but here they are the signal that tells a
 * state from ordinary prose — so they are parked behind a marker that survives
 * the cleaning, and put back afterwards.
 */
const BOLD_MARKER = '@@bold@@'
const plainTextKeepingBold = (text: string): string =>
  plainText(text.split('**').join(BOLD_MARKER)).split(BOLD_MARKER).join('**')

/**
 * The rules that say what a mark *does* for one unit: its own abilities, and
 * the army and detachment rules whose keywords reach it. The rule that merely
 * grants the mark is left out — it is not an effect.
 *
 * `detachmentNames` are the detachments the army actually took. Without it
 * every detachment in the codex has its say, which reads as a unit having
 * abilities it was never given — pass the army's own whenever they are known.
 */
export function rulesAboutMark(
  catalogue: ParsedCatalogue,
  mark: Mark,
  keywords: readonly string[],
  datasheetId: string,
  detachmentNames?: readonly string[],
): Ability[] {
  const speaksAbout = (ability: Ability) => {
    const text = plainTextKeepingBold(`${ability.name}. ${ability.text}`)
    if (!new RegExp(`\\*\\*${escape(mark.label)}\\*\\*`, 'i').test(text)) return false
    // Granting a state is not an effect of being in it: the rule that riles a
    // unit up says nothing about what being riled up *does*. So a rule counts
    // as an effect only when it mentions the state somewhere that is not a
    // grant — which is exactly the judgement `grantedMarks` already makes.
    const mentions = [...text.matchAll(MENTIONS)].filter(
      (m) => fold(m[1] ?? '') === mark.key,
    ).length
    return mentions > grantedMarks(ability.text, [mark]).length
  }

  const own = (catalogue.datasheets.find((d) => d.id === datasheetId)?.abilities ?? []).filter(speaksAbout)
  const detachments = detachmentNames
    ? catalogue.detachments.filter((d) => detachmentNames.includes(d.name))
    : catalogue.detachments
  const shared = [...(catalogue.rules ?? []), ...detachments.flatMap((d) => d.rules ?? [])].filter(
    (rule) => speaksAbout(rule) && ruleAppliesTo(rule.text, keywords) !== false,
  )

  const seen = new Set<string>()
  return [...own, ...shared].filter((rule) => !seen.has(rule.id) && seen.add(rule.id))
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** An invulnerable save a rule grants, when it grants one. */
export function invulnerableFrom(text: string): number | undefined {
  const plain = plainText(text)
  const match = /\b(\d)\+\s*(?:InSv\b|invulnerable\s+save)/i.exec(plain)
  return match ? Number(match[1]) : undefined
}
