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
import { ruleTextFor } from '@/roster/detachmentRules'
import { abilitiesInArmy } from '@/roster/armyAbilities'
import { effectsFrom, type Effects } from './effects'
import { isBackReference, type GrantingRule, type WeaponGrant } from './grants'
import { rulesAboutMark, type Mark } from './marks'
import type { StatMod } from './mods'
import { activePhrases, situationsIn, type Situation } from './situations'
import type { Facts } from './conditions'
import type { ActiveRule, GameUnit, UnitStatus } from './types'
import { hostOf, livingModels, wholeUnitOf } from './attached'

/** The rules a detachment the army took grants to a unit it names. */
export function detachmentRulesFor(
  keywords: readonly string[],
  detachmentNames: readonly string[],
  catalogue: ParsedCatalogue | undefined,
) {
  return detachmentNames.flatMap((name) => {
    const detachment = catalogue?.detachments.find((d) => d.name === name)
    // Each clause reaches only the units it names (`ruleTextFor`): a Boyz-only
    // clause is not given to the Infantry another clause of the same rule names.
    return (detachment?.rules ?? []).flatMap((rule) => {
      const text = ruleTextFor(rule.text, keywords)
      return text === undefined ? [] : [{ rule: { ...rule, text }, detachmentName: name }]
    })
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
  return wholeUnitOf(unit, units)
    .filter((other) => other.id !== unit.id && !other.destroyed)
    .map((other) => ({
      id: other.id,
      name: other.name,
      sheet: sheets.get(other.entryId),
      enhancements: other.enhancements ?? [],
      marks: other.marks ?? [],
      statuses: other.statuses,
      inEffect: other.inEffect ?? [],
      models: livingModels([other]),
      // Leading only while the unit it joined is still standing.
      leading: Boolean(hostOf(other, units)),
    }))
}

/** One member of an attached unit, as much of it as the caller knows. */
export type Member = {
  /** The unit's id, when it is one in a game: how the viewed unit finds its host. */
  id?: string
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
  /** Models of it still alive; they count towards the whole unit's size. */
  models?: number
  /** It is a character leading the unit it joined (unknown when left out). */
  leading?: boolean
  /**
   * Datasheet names of the others it stands with, for the rules the data grants
   * only while a certain character is attached. Unknown when left out.
   */
  attachedNames?: readonly string[]
}

type Context = {
  catalogue: ParsedCatalogue | undefined
  detachmentNames: readonly string[]
  marks: readonly Mark[]
}

/**
 * A Stratagem used on the unit, an ability activated on it. They read like any
 * other rule — with one difference: a rule that offers a choice ("you can use
 * this ability. If you do, …") has that choice *made* by being put into effect,
 * so its back-reference condition is satisfied and nothing else can satisfy it.
 */
function effectsOfActive(member: Member, active: readonly string[], facts: Facts): Effects {
  const rules = (member.inEffect ?? []).map((rule) => ({
    name: rule.name,
    text: rule.text,
    source: rule.source,
  }))
  const { grants, mods } = effectsFrom(rules, active, facts)
  // Putting the rule into effect settles its "If you do", and its "Until the
  // end of the phase" is how long it lasts, which the game tracks itself
  // (duration.ts) — neither is left for the player to meet.
  const settled = <T extends { when?: string; met?: boolean }>(effect: T): T => {
    if (!effect.when || !(isBackReference(effect.when) || /^until\b/i.test(effect.when.trim()))) return effect
    const { when: _dropped, ...rest } = effect
    void _dropped
    return rest as T
  }
  return { grants: grants.map(settled), mods: mods.map(settled) }
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
    ...abilitiesInArmy(sheet?.abilities ?? [], detachmentNames, member.attachedNames).map((a) => ({
      name: a.name,
      text: a.text,
      source: a.kind === 'faction' ? 'Faction rule' : 'Datasheet',
    })),
    ...(member.enhancements ?? []).map((e) => ({
      name: e.name,
      text: (e.id ? byId.get(e.id) : undefined) ?? byName.get(e.name) ?? '',
      source: 'Enhancement',
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

/**
 * The rule as printed and the rule as used are the same rule: once it is in
 * effect, the copy still waiting on the player's choice is not a second
 * modifier, it is the same one answered. Saying both would put "+1 to hit*"
 * and "+1 to hit" side by side and leave the player counting.
 */
function merge(printed: Effects, activated: Effects): Effects {
  const settled = (rule: string, stat: string, value: string) =>
    activated.mods.some((m) => m.rule === rule && m.stat === stat && m.value === value)
  const answered = (rule: string, keyword: string) =>
    activated.grants.some((g) => g.rule === rule && g.keyword === keyword)
  return {
    mods: [
      ...printed.mods.filter((mod) => !(mod.when && settled(mod.rule, mod.stat, mod.value))),
      ...activated.mods,
    ],
    grants: [
      ...printed.grants.filter((grant) => !(grant.when && answered(grant.rule, grant.keyword))),
      ...activated.grants,
    ],
  }
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
  models,
  leading,
}: {
  unit: GameUnit
  sheet: Datasheet | undefined
  catalogue: ParsedCatalogue | undefined
  detachmentNames: readonly string[]
  marks?: readonly Mark[]
  attached?: readonly Member[]
  /** Living models in this unit alone, when `unit` carries no model list (the builder). */
  models?: number
  /** Whether this unit is leading another, when `unit` cannot say (the builder). */
  leading?: boolean
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
  // What the app can answer for itself: how many models are still alive, and
  // whether this model is leading a unit. A condition it can settle must never
  // be a toggle — the count changes as models die.
  // Rules count the whole attached unit — "while this unit contains 10 or
  // more models" is the bodyguard and its characters together — and each model
  // answers "is it leading" for itself, so a Leader's "while this model is
  // leading a unit" is live on the bodyguard's card exactly when it is true.
  const own = models ?? unit.models?.reduce((sum, group) => sum + group.alive, 0)
  const total =
    own === undefined || attached.some((m) => m.models === undefined)
      ? undefined
      : own + attached.reduce((sum, m) => sum + (m.models ?? 0), 0)
  const facts: Facts = {
    ...(total !== undefined ? { models: total } : {}),
    leading:
      leading ?? (Boolean(unit.leaderOf) && attached.some((m) => m.id === unit.leaderOf)),
  }
  const sheetNames = (members: readonly Member[]) =>
    members.flatMap((m) => (m.sheet ? [m.sheet.name] : []))
  const self: Member = {
    name: unit.name,
    sheet,
    attachedNames: sheetNames(attached),
    enhancements: unit.enhancements ?? [],
    marks: held,
    inEffect: unit.inEffect ?? [],
  }
  const printed = effectsFrom(rulesFor(self, context), active, facts)
  const activated = effectsOfActive(self, active, facts)
  const mine = merge(printed, activated)

  const grants = [...mine.grants]
  const mods = [...mine.mods]
  const seenGrants = new Set(mine.grants.map(grantKey))
  const seenMods = new Set(mine.mods.map(modKey))

  for (const member of attached) {
    // What the attached model's own rules do for it alone is on its own sheet;
    // here only what they do for the unit it is part of. Its conditions are
    // read with its own facts, not the viewed unit's.
    const theirFacts: Facts = {
      ...(facts.models !== undefined ? { models: facts.models } : {}),
      ...(member.leading !== undefined ? { leading: member.leading } : {}),
    }
    const theirs = merge(
      effectsFrom(
        rulesFor(
          {
            ...member,
            marks: held,
            attachedNames: sheetNames([self, ...attached.filter((m) => m !== member)]),
          },
          context,
        ),
        active,
        theirFacts,
      ),
      effectsOfActive(member, active, theirFacts),
    )
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
