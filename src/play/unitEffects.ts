/**
 * Everything the army's rules do to one unit: the weapon abilities they grant
 * and the characteristics they change.
 *
 * The sources are the same wherever a unit is shown — the detachments the army
 * took that name it, its own datasheet and faction abilities, its enhancements,
 * the states it is in — so the army list, the unit editor and the opened
 * datasheet read from one place and can never disagree.
 *
 * A unit and the characters attached to it are one unit at the table, so what a
 * Leader's enhancement gives "this unit" is given to the bodyguard too, and the
 * other way round. What a rule gives "this model" or "the bearer" stays with the
 * model that carries it — which is the distinction `subject` carries.
 */

import type { Datasheet, ParsedCatalogue } from '@/data/model'
import { ruleAppliesTo } from '@/roster/detachmentRules'
import { effectsFrom, type Effects } from './effects'
import type { GrantingRule, WeaponGrant } from './grants'
import { rulesAboutMark, type Mark } from './marks'
import type { StatMod } from './mods'
import { activePhrases, situationsIn, type Situation } from './situations'
import type { ActiveRule, GameUnit, UnitStatus } from './types'

/** The rules a detachment the army took grants to a unit it names. */
export function detachmentRulesFor(
  keywords: readonly string[],
  detachmentNames: readonly string[],
  catalogue: ParsedCatalogue | undefined,
) {
  return detachmentNames.flatMap((name) => {
    const detachment = catalogue?.detachments.find((d) => d.name === name)
    return (detachment?.rules ?? [])
      .filter((r) => ruleAppliesTo(r.text, keywords) !== false)
      .map((rule) => ({ rule, detachmentName: name }))
  })
}

/**
 * The rest of the unit this one is part of: for a bodyguard, the characters
 * attached to it; for a character, the unit it joined *and* the other
 * characters on it — a Leader's enhancement reaches the Support character
 * beside it, because at the table they are one unit.
 */
export function attachedFamily(
  unit: GameUnit,
  units: readonly GameUnit[],
  sheets: Map<string, Datasheet>,
): Member[] {
  const hostId = unit.leaderOf ?? unit.id
  return units
    .filter((other) => other.id !== unit.id && !other.destroyed && (other.id === hostId || other.leaderOf === hostId))
    .map((other) => ({
      name: other.name,
      sheet: sheets.get(other.entryId),
      enhancements: other.enhancements ?? [],
      marks: other.marks ?? [],
      statuses: other.statuses,
      inEffect: other.inEffect ?? [],
    }))
}

/** One member of an attached unit, as much of it as the caller knows. */
export type Member = {
  /** What the roster calls it, for "…· Warboss" on the chip. */
  name: string
  sheet: Datasheet | undefined
  /** Enhancements it carries, by catalogue id or by name — whichever the caller has. */
  enhancements?: readonly { id?: string; name: string }[]
  /** States it is in. */
  marks?: readonly string[]
  /** Situations it is in — it charged, it advanced (see situations.ts). */
  statuses?: readonly UnitStatus[]
  /** Rules the player has put into effect on it — a Stratagem, an ability. */
  inEffect?: readonly ActiveRule[]
}

type Context = {
  catalogue: ParsedCatalogue | undefined
  detachmentNames: readonly string[]
  marks: readonly Mark[]
}

/** Every rule that speaks about one member: detachment, datasheet, enhancement, state. */
function rulesFor(member: Member, context: Context): GrantingRule[] {
  const { catalogue, detachmentNames, marks } = context
  const sheet = member.sheet
  const keywords = sheet ? [...sheet.keywords, ...sheet.factionKeywords] : []
  const byId = new Map((catalogue?.enhancements ?? []).map((e) => [e.id, e.text]))
  const byName = new Map((catalogue?.enhancements ?? []).map((e) => [e.name, e.text]))
  const held = member.marks ?? []
  return [
    ...detachmentRulesFor(keywords, detachmentNames, catalogue).map(({ rule, detachmentName }) => ({
      name: rule.name,
      text: rule.text,
      source: detachmentName,
    })),
    ...(sheet?.abilities ?? []).map((a) => ({
      name: a.name,
      text: a.text,
      source: a.kind === 'faction' ? 'Faction rule' : 'Datasheet',
    })),
    ...(member.enhancements ?? []).map((e) => ({
      name: e.name,
      text: (e.id ? byId.get(e.id) : undefined) ?? byName.get(e.name) ?? '',
      source: 'Enhancement',
    })),
    // A Stratagem used on the unit is a rule about the unit for as long as it
    // lasts, and reads like any other.
    ...(member.inEffect ?? []).map((rule) => ({
      name: rule.name,
      text: rule.text,
      source: rule.source,
    })),
    ...(catalogue && sheet
      ? marks
          .filter((mark) => held.includes(mark.key))
          .flatMap((mark) =>
            rulesAboutMark(catalogue, mark, keywords, sheet.id, detachmentNames).map((rule) => ({
              name: rule.name,
              text: rule.text,
              source: mark.label,
            })),
          )
      : []),
  ]
}

/**
 * The situations this unit's own rules react to — and only those. A toggle
 * that changes nothing for the unit in front of you is noise; a unit whose
 * detachment conditions half its rules on having charged needs that toggle
 * where the thumb is. Read from every rule that reaches the unit, its family's
 * included, because they are one unit.
 */
export function situationsForUnit(input: {
  unit: GameUnit
  sheet: Datasheet | undefined
  catalogue: ParsedCatalogue | undefined
  detachmentNames: readonly string[]
  marks?: readonly Mark[]
  attached?: readonly Member[]
}): Situation[] {
  const context: Context = {
    catalogue: input.catalogue,
    detachmentNames: input.detachmentNames,
    marks: input.marks ?? [],
  }
  const members: Member[] = [
    {
      name: input.unit.name,
      sheet: input.sheet,
      enhancements: input.unit.enhancements ?? [],
      marks: input.unit.marks ?? [],
    },
    ...(input.attached ?? []),
  ]
  return situationsIn(members.flatMap((member) => rulesFor(member, context)).map((rule) => rule.text))
}

const grantKey = (g: WeaponGrant) => `${g.keyword}|${g.kind}|${g.when ?? ''}`
const modKey = (m: StatMod) => `${m.stat}|${m.op}|${m.value}|${m.target}|${m.when ?? ''}`

/**
 * `marks` are the states the installed data names, discovered once per
 * catalogue by the caller; only the ones a unit is actually in are read, so
 * this stays cheap enough to run for every card in an army list.
 *
 * `attached` are the characters joined to this unit (or, when the unit shown
 * *is* the character, the unit it has joined). Only what their rules give the
 * whole unit is taken, and it says whose it is.
 */
export function effectsForUnit({
  unit,
  sheet,
  catalogue,
  detachmentNames,
  marks = [],
  attached = [],
}: {
  unit: GameUnit
  sheet: Datasheet | undefined
  catalogue: ParsedCatalogue | undefined
  detachmentNames: readonly string[]
  marks?: readonly Mark[]
  attached?: readonly Member[]
}): Effects {
  const context: Context = { catalogue, detachmentNames, marks }
  // A state belongs to the *unit*, and a unit is the bodyguard and every
  // character attached to it — one unit at the table, whatever the app stores
  // them as. So a mob that is riled up makes its Leader riled up, and the 5+
  // invulnerable the state grants is the Leader's too. Read from the family as
  // well as from the unit's own list, so a game already in progress (where the
  // state may sit on one member only) reads right as well.
  const held = [...new Set([...(unit.marks ?? []), ...attached.flatMap((m) => m.marks ?? [])])]
  // …and so does a situation: the mob charged, so the Leader in it charged.
  // The phrases are what a rule's condition is actually written in, which is
  // how switching "Charged" on makes "if this unit made a charge move" live.
  const situations = [
    ...new Set([...(unit.statuses ?? []), ...attached.flatMap((m) => m.statuses ?? [])]),
  ]
  const active = [...held, ...activePhrases(situations)]
  const own = effectsFrom(
    rulesFor(
      {
        name: unit.name,
        sheet,
        enhancements: unit.enhancements ?? [],
        marks: held,
        inEffect: unit.inEffect ?? [],
      },
      context,
    ),
    active,
  )

  const grants = [...own.grants]
  const mods = [...own.mods]
  const seenGrants = new Set(own.grants.map(grantKey))
  const seenMods = new Set(own.mods.map(modKey))

  for (const member of attached) {
    // What the attached model's own rules do for it alone is on its own sheet;
    // here only what they do for the unit it is part of.
    const theirs = effectsFrom(rulesFor({ ...member, marks: held }, context), active)
    for (const grant of theirs.grants) {
      if (grant.subject !== 'unit' || seenGrants.has(grantKey(grant))) continue
      seenGrants.add(grantKey(grant))
      grants.push({ ...grant, source: `${grant.source} · ${member.name}` })
    }
    for (const mod of theirs.mods) {
      if (mod.subject !== 'unit' || seenMods.has(modKey(mod))) continue
      seenMods.add(modKey(mod))
      mods.push({ ...mod, source: `${mod.source} · ${member.name}` })
    }
  }

  return { grants, mods }
}
