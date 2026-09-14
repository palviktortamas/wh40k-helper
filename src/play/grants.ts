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

export type GrantKind = 'ranged' | 'melee' | 'any'

export type WeaponGrant = {
  /** The ability as the rules write it: "SUSTAINED HITS 1". */
  keyword: string
  /** Which half of the datasheet it lands on; "any" when the rule names neither. */
  kind: GrantKind
  /** The rule that grants it. */
  rule: string
  /** Where that rule came from, for the chip: a detachment's name, "Waaagh!", … */
  source: string
  /** The clause it hangs on — "if this unit made a charge move this turn" — when it has one. */
  when?: string
  /** That clause is a state the unit is in right now, so the ability is live. */
  met?: boolean
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

/**
 * A condition reads as a subordinate clause before the grant: "While a unit is
 * worked up, …", "In the Fight phase, if …". A scope phrase ("Friendly X
 * units'") is not one — it says *who*, and the unit sheet only ever shows
 * grants that already apply to the unit in front of you.
 */
const CONDITION = /^(?:while|when|whenever|if|after|until|each time|in|on|unless|during)\b/i

/**
 * `plainText` drops the bold marks, but the sources use them to say which word
 * is a keyword, a state or a **characteristic** — so they are parked behind a
 * marker that survives the cleaning and put back afterwards.
 */
const BOLD_MARKER = '@@bold@@'
export const plainTextKeepingBold = (text: string): string =>
  plainText(text.split('**').join(BOLD_MARKER)).split(BOLD_MARKER).join('**')

/** Bold marks are for the reader of the rule, not for the reader of the app. */
export const unbold = (text: string): string => text.replace(/\*\*/g, '')

/** Rules are written as prose, as bullet lists, or as both at once. */
export const clausesOf = (text: string): string[] =>
  plainTextKeepingBold(text)
    .split(/(?<=[.;:])\s+|\s+[-–—•]\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean)

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
    for (const clause of clausesOf(rule.text)) {
      if (clause.endsWith(':')) heading = conditionOf(clause.slice(0, -1))
      for (const match of clause.matchAll(HAVE)) {
        const kind = (match[1]?.toLowerCase() as GrantKind | undefined) ?? 'any'
        const when = conditionOf(clause.slice(0, match.index)) ?? heading
        for (const ability of (match[2] ?? '').matchAll(ABILITY)) {
          const keyword = ability[1]!.trim()
          if (!keyword) continue
          const key = `${rule.name}|${keyword}|${kind}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ keyword, kind, rule: rule.name, source: rule.source, ...(when ? { when } : {}) })
        }
      }
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
): WeaponGrant[] =>
  grants.map((grant) =>
    grant.when && activeStates.some((state) => grant.when!.toLowerCase().includes(state.toLowerCase()))
      ? { ...grant, met: true }
      : grant,
  )

/** The grants that land on one weapon profile. */
export const grantsFor = (grants: readonly WeaponGrant[], kind: 'ranged' | 'melee'): WeaponGrant[] =>
  grants.filter((g) => g.kind === 'any' || g.kind === kind)
