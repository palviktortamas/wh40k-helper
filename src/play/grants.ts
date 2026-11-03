/**
 * Weapon abilities a *rule* grants, rather than the datasheet printing them.
 *
 * A weapon's own keywords come from its profile, but half of what a weapon
 * actually does at the table is written elsewhere: a detachment says "friendly
 * X units' melee attacks have [SUSTAINED HITS 1]", the faction rule says the
 * same of a state, and the unit's own ability says it "if this unit made a
 * charge move this turn". Reading the datasheet alone therefore shows a
 * strictly weaker weapon than the one being rolled.
 *
 * Nothing here knows a faction: the sources write these grants in one
 * grammar — "<scope> [melee|ranged] attacks have **[ABILITY]**" — with the
 * condition, when there is one, in the clause before it. That grammar is what
 * this reads. Anything else a rule does (+1 to hit, re-rolls) is left to the
 * rule's own text, which the unit sheet already shows in full.
 */

import { plainText } from '@/reminders/heuristics'
import { normalizeMarks } from '@/stratagems/marked'
import { conditionMet, type Facts } from './conditions'

export type GrantKind = 'ranged' | 'melee' | 'any'

/**
 * Who the grant is for. A unit and the characters attached to it are one unit
 * at the table: an ability given to "this unit" reaches all of them, one given
 * to "this model" or "the bearer" does not.
 */
export type GrantSubject = 'unit' | 'model'

export type WeaponGrant = {
  /** The ability as the rules write it: "SUSTAINED HITS 1". */
  keyword: string
  /** Which half of the datasheet it lands on; "any" when the rule names neither. */
  kind: GrantKind
  subject: GrantSubject
  /** The rule that grants it. */
  rule: string
  /** Where that rule came from, for the chip: a detachment's name, "Waaagh!", … */
  source: string
  /** The clause it hangs on — "if this unit made a charge move this turn" — when it has one. */
  when?: string
  /** That clause is a state the unit is in right now, so the ability is live. */
  met?: boolean
  /**
   * The condition is about the *target* of the attack ("attacks that target a
   * MONSTER unit"), which changes with every attack and which no state the
   * player ticks can settle. So it is shown as conditional and never as live.
   */
  against?: boolean
}

export type GrantingRule = { name: string; text: string; source: string }

/**
 * "… attacks have [X]" — with the half of the datasheet named, when it is.
 * Also the spelled-out form the older books use: "Ranged weapons equipped by
 * models in the bearer's unit have the [IGNORES COVER] ability."
 */
const HAVE = /\b(?:(melee|ranged)\s+)?(?:attacks?|weapons?)\b[^.;]{0,70}?\s(?:have|gain)\b([^.;]*)/gi
/** Every bracketed ability in the tail of such a phrase. */
const ABILITY = /\[([^\]]+)\]/g
/** Where the first bracketed ability of a clause starts, bold marks and all. */
const ABILITY_START = /(?:\*\*)?\[/

/**
 * A condition reads as a subordinate clause before the grant: "While a unit is
 * worked up, …", "In the Fight phase, if …". A scope phrase ("Friendly X
 * units'") is not one — it says *who*, and the unit sheet only ever shows
 * grants that already apply to the unit in front of you.
 */
const CONDITION = /^(?:while|when|whenever|if|after|until|each time|in|on|unless|during)\b/i

/**
 * "this unit", "this model", "the bearer", "the bearer's unit" — who a rule is
 * about. The *nearest* one before the effect is the one that governs it: "if
 * this unit made a charge move this turn, **this model's** melee attacks have
 * +3 A" is the model's, however the condition opens. A clause that names
 * nobody is about the unit, which is how army-wide rules are written.
 */
const SUBJECT = /\b(?:this|that)\s+(unit|model)s?\b|\bthe\s+bearer(?:'?’?s\s+(unit))?/gi

/** The subject a piece of text names, if it names one at all. */
export const subjectIn = (text: string): GrantSubject | undefined => {
  let subject: GrantSubject | undefined
  for (const match of unbold(text).matchAll(SUBJECT)) {
    if (match[2]) subject = 'unit'
    else if (match[1]) subject = match[1].toLowerCase() === 'unit' ? 'unit' : 'model'
    else subject = 'model'
  }
  return subject
}

/**
 * Read what comes before the effect first; some forms name the owner after it
 * ("Ranged weapons equipped by the bearer have …"), and a bulleted rule names
 * it once in the heading above ("this model's melee attacks have: - +3 A").
 */
export const subjectOf = (before: string, clause = '', heading?: GrantSubject): GrantSubject =>
  subjectIn(before) ?? subjectIn(clause) ?? heading ?? 'unit'

/**
 * `plainText` drops the bold marks, but the sources use them to say which word
 * is a keyword, a state or a **characteristic** — so they are parked behind a
 * marker that survives the cleaning and put back afterwards.
 */
const BOLD_MARKER = '@@bold@@'
export const plainTextKeepingBold = (text: string): string =>
  // A keyword spelt ^^X^^ is the same keyword as **X**, so it must stay bold.
  plainText(normalizeMarks(text).split('**').join(BOLD_MARKER)).split(BOLD_MARKER).join('**')

/** Bold marks are for the reader of the rule, not for the reader of the app. */
export const unbold = (text: string): string => text.replace(/\*\*/g, '')

/** Rules are written as prose, as bullet lists, or as both at once. */
export const clausesOf = (text: string): string[] =>
  plainTextKeepingBold(text)
    .split(/(?<=[.;:])\s+|\s+[-–—•]\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean)

/**
 * "If you do" points back at the choice the rule just offered ("you can use
 * this ability. If you do, …"). It *is* a condition — the ability is optional,
 * and its effect must not be printed as though it were always on — but it is a
 * condition about the player rather than about the battlefield, so the thing
 * that satisfies it is the player putting the rule into effect on the unit
 * (see unitEffects.ts). Nothing else can ever meet it.
 */
export const isBackReference = (when: string): boolean =>
  /^if (?:you|it|they) (?:do|did|does)(?: so)?$/i.test(when.trim())

/** The condition in front of a grant or a modifier, if the clause carries one. */
export function conditionOf(prefix: string): string | undefined {
  const trimmed = prefix.trim().replace(/[,\s]+$/, '')
  if (!trimmed) return undefined
  // The grant's own subject ("that unit's", "this unit's") is the tail of the
  // prefix, after the last comma; what comes before it is the condition.
  const cut = trimmed.lastIndexOf(',')
  const candidate = (cut === -1 ? trimmed : trimmed.slice(0, cut)).trim().replace(/[,\s]+$/, '')
  if (!candidate || !CONDITION.test(candidate)) return undefined
  return unbold(candidate)
}

/** A bullet's own marker, which is not part of what it says. */
export const stripBullet = (clause: string): string => clause.replace(/^[-–—•]\s*/, '')

/**
 * "attacks that target a MONSTER/VEHICLE unit", "…that targets the closest
 * eligible target" — the thing the attack is aimed at, as a condition. Asked of
 * the text in front of the effect. A bare "a unit" is every attack there is, so
 * it is no condition at all; attacks aimed at *this* unit are somebody else's
 * effect and are ruled out by the callers before they ask.
 */
const TARGETS = /\btargets?\s+((?:an?|the|one|each|any|that)\b[^,;]*)/i
const ANY_UNIT = /^(?:an?\s+)?(?:enemy\s+)?units?$/i
export function targetCondition(before: string): string | undefined {
  const found = TARGETS.exec(unbold(before))
  if (!found) return undefined
  const noun = found[1]!.trim().replace(/\s+(?:have|has|gain)\s*:?$/i, '').replace(/[:\s]+$/, '')
  if (!noun || ANY_UNIT.test(noun)) return undefined
  return `attacks that target ${noun}`
}

/** A target condition the condition already says is not said twice. */
export const withTarget = (when: string | undefined, target: string | undefined): string | undefined => {
  if (!target) return when
  const noun = target.slice('attacks that target '.length)
  return when?.includes(noun) ? when : joinWhen(when, target)
}

/** Two conditions that must both hold, said once each. */
export const joinWhen = (...parts: (string | undefined)[]): string | undefined => {
  const kept = parts.filter((part): part is string => Boolean(part))
  const unique = kept.filter((part, at) => !kept.some((other, i) => i < at && other.includes(part)))
  return unique.length > 0 ? unique.join('; ') : undefined
}

/**
 * The condition a clause opens with, for a following sentence that says
 * "Instead, …" and so holds on the same terms: "Each time the bearer's unit
 * Advances, do not make an Advance roll for it. Instead, add 6" to its Move."
 */
export function leadingCondition(clause: string): string | undefined {
  const comma = clause.indexOf(',')
  if (comma === -1) return undefined
  const first = clause.slice(0, comma).trim()
  return CONDITION.test(first) ? unbold(first) : undefined
}

/**
 * Every weapon ability the given rules grant. Callers pass only the rules that
 * already speak about the unit in hand — the detachment rules that name it,
 * its own abilities, the states it is in — so scope is not re-decided here.
 */
export function weaponGrants(rules: readonly GrantingRule[]): WeaponGrant[] {
  const out: WeaponGrant[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    // A clause ending in a colon is a heading the bullets under it belong to —
    // "While a unit is worked up: - … - that unit's ranged attacks have […]" —
    // so the condition lives one clause above the grant.
    let heading: string | undefined
    let headingSubject: GrantSubject | undefined
    // "This unit's ranged attacks have: - [X]. - If …, [Y]." — the grant is the
    // heading, and the abilities are the bullets under it, each with its own
    // condition. Set while such a heading is open.
    let listed:
      | { kind: GrantKind; subject: GrantSubject; when: string | undefined; target: string | undefined }
      | undefined
    const push = (
      keyword: string,
      kind: GrantKind,
      subject: GrantSubject,
      when: string | undefined,
      against = false,
    ) => {
      const key = `${rule.name}|${keyword}|${kind}`
      if (!keyword || seen.has(key)) return
      seen.add(key)
      out.push({
        keyword,
        kind,
        subject,
        rule: rule.name,
        source: rule.source,
        ...(when ? { when } : {}),
        ...(against ? { against } : {}),
      })
    }
    for (const raw of clausesOf(rule.text)) {
      const clause = stripBullet(raw)
      if (clause.endsWith(':')) {
        heading = conditionOf(clause.slice(0, -1))
        headingSubject = subjectIn(clause)
        listed = undefined
      }
      let granted = false
      for (const match of clause.matchAll(HAVE)) {
        granted = true
        const kind = (match[1]?.toLowerCase() as GrantKind | undefined) ?? 'any'
        // The target of the attack is a condition too, but not one a state settles.
        const target = targetCondition(match[0].slice(0, match[0].length - (match[2]?.length ?? 0)))
        const own = conditionOf(clause.slice(0, match.index)) ?? heading
        const when = withTarget(own, target)
        const subject = subjectOf(clause.slice(0, match.index), clause, headingSubject)
        const tail = (match[2] ?? '').trim()
        if (clause.endsWith(':') && tail === ':') listed = { kind, subject, when: own, target }
        for (const ability of tail.matchAll(ABILITY)) push(ability[1]!.trim(), kind, subject, when, Boolean(target))
      }
      if (granted || !listed) continue
      // A bullet under the heading: its abilities, on its own condition or the heading's.
      const first = clause.search(ABILITY_START)
      if (first === -1) continue
      const when = withTarget(conditionOf(clause.slice(0, first)) ?? listed.when, listed.target)
      for (const ability of clause.slice(first).matchAll(ABILITY))
        push(ability[1]!.trim(), listed.kind, listed.subject, when, Boolean(listed.target))
    }
  }
  return out
}

/**
 * Marks the grants whose condition is a state the unit is *already* in. A
 * faction state grants "[ASSAULT] while this unit is riled up"; once the unit
 * is riled up that is not a caveat any more, and the table should say so.
 */
export const resolveGrants = (
  grants: readonly WeaponGrant[],
  activeStates: readonly string[],
  facts: Facts = {},
): WeaponGrant[] =>
  grants.map((grant) =>
    grant.when && !grant.against && conditionMet(grant.when, activeStates, facts)
      ? { ...grant, met: true }
      : grant,
  )

/** The grants that land on one weapon profile. */
export const grantsFor = (grants: readonly WeaponGrant[], kind: 'ranged' | 'melee'): WeaponGrant[] =>
  grants.filter((g) => g.kind === 'any' || g.kind === kind)
