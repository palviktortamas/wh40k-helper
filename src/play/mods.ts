/**
 * Characteristics a *rule* changes — the other half of what the datasheet does
 * not print.
 *
 * An enhancement says "This unit has 4+ **Sv**", a detachment says "+3\" **R**
 * while this unit is riled up", a datasheet ability says "this model's melee
 * attacks have +1 **D**". None of it reaches the stat line or the weapons
 * table, so the numbers a player reads are the printed ones and the army they
 * paid points for is invisible.
 *
 * Like the weapon-ability grants next door, this reads the one grammar the
 * sources use and nothing else. Two signals keep it honest:
 *
 * - the characteristic must be **bold** in the source, which is how the data
 *   marks a characteristic rather than an ordinary number ("11+ models") —
 *   with either marker, since the datasheets bold with `**` and the stratagem
 *   export with `__`;
 * - a unit characteristic is taken only when the clause's subject is this very
 *   unit, so "a TRANSPORT unit this unit is embarked within has +2\" M" does
 *   not quietly speed up the passenger.
 *
 * Weapon characteristics need no such check: R/A/BS/WS/S/AP/D are weapon
 * characteristics wherever they appear, and the clause says which half of the
 * datasheet they land on.
 */

import {
  clausesOf,
  conditionOf,
  joinWhen,
  leadingCondition,
  stripBullet,
  subjectIn,
  subjectOf,
  targetCondition,
  unbold,
  withTarget,
  type GrantingRule,
} from './grants'
import { conditionMet, type Facts } from './conditions'

/** Where a modifier lands. */
export type ModTarget = 'unit' | 'ranged' | 'melee' | 'any'

/**
 * Who the rule is about. A unit and the characters attached to it are one unit
 * at the table, so a change written for "this unit" reaches all of them, while
 * one written for "this model" or "the bearer" stays with the character that
 * carries it.
 */
export type ModSubject = 'unit' | 'model'

/**
 * Which weapons a modifier is for, when the rule says: "[PSYCHIC] attacks have
 * +1 S" (a keyword), "this unit's Scavenged Shivs weapons have +1 A" (a name),
 * "ranged attacks (excluding [TORRENT] attacks)" (everything but a keyword).
 * A modifier with none of these is for every weapon of its half.
 */
export type WeaponFilter = { keyword?: string; except?: string; name?: string }

/** A weapon as the table knows it, for matching a filter. */
export type WeaponRef = { name: string; keywords: readonly string[] }

export type StatMod = {
  /** The characteristic, folded to the app's own spelling: M, T, SV, W, LD, OC, INVSV, R, A, BS, WS, S, AP, D. */
  stat: string
  /** `set` — "4+ Sv"; `delta` — "+2\" M". */
  op: 'delta' | 'set'
  /** As the rule writes it: "+2\"", "-1", "4+". */
  value: string
  target: ModTarget
  subject: ModSubject
  rule: string
  source: string
  /** The clause it hangs on, when it has one. */
  when?: string
  /** That clause is a state the unit is in right now. */
  met?: boolean
  /** Only these weapons. */
  weapon?: WeaponFilter
  /**
   * The condition is about what the attack is aimed at, or what it is aimed
   * against ("4+ invulnerable save against ranged attacks"): different for every
   * attack, so no state the player ticks can make it hold. Shown as conditional.
   */
  against?: boolean
  /**
   * "…add 3 instead": when this one holds it replaces the rule's other change
   * to the same characteristic instead of stacking on it.
   */
  instead?: boolean
}

/** The characteristics of a unit, by the token the data prints. */
const UNIT_STATS: Record<string, string> = {
  m: 'M',
  t: 'T',
  sv: 'SV',
  w: 'W',
  ld: 'LD',
  oc: 'OC',
  insv: 'INVSV',
}

/** The characteristics of a weapon. */
const WEAPON_STATS: Record<string, string> = {
  r: 'R',
  range: 'R',
  a: 'A',
  bs: 'BS',
  ws: 'WS',
  s: 'S',
  ap: 'AP',
  d: 'D',
}

/**
 * "+1 to **hit rolls**" — the commonest thing a rule gives, and not a
 * characteristic: a modifier to the roll. It is kept as its own kind rather
 * than folded into BS/WS, because a +1 to hit and a better Ballistic Skill are
 * not the same thing and the app must not claim they are. It shows beside the
 * weapons it applies to, named.
 *
 * The bold marks are optional here, unlike a characteristic's: "+1 to hit
 * rolls" cannot mean anything else, there is no "11+ models" to be fooled by,
 * and the sources mark it three different ways — `**`, `__`, and one rule that
 * closes the bold a star short.
 */
const ROLL = /([+\-−]\d+)\s*to\s*[*_]{0,2}(hit|wound)\s+rolls?[*_]{0,2}/gi
const ROLL_STATS: Record<string, string> = { hit: 'HIT', wound: 'WOUND' }

/** "+2\" **M**", "-1 **T**" — a change to whatever characteristic follows. */
const DELTA =
  /([+\-−]\d+"?)\s*([*_]{2}[A-Za-z]{1,5}[*_]{2}(?:\s*(?:,|,?\s+and)\s*[*_]{2}[A-Za-z]{1,5}[*_]{2})*)/g
/** One characteristic of a list: "**A**, **WS** and **S**". */
const BOLD_STAT = /[*_]{2}([A-Za-z]{1,5})[*_]{2}/g
/** "4+ **Sv**", "5+ **InSv**" — a characteristic set outright. */
const SET = /\b(\d\+)\s*[*_]{2}([A-Za-z]{1,5})[*_]{2}/g

/**
 * The same changes, spelled out the way the older books (and the codex text a
 * mirror carries) write them: "Add 2 to the Attacks characteristic of melee
 * weapons equipped by the bearer", "improve the Armour Penetration
 * characteristic of that attack by 1".
 */
const PROSE = /\b(add|subtract|improve|worsen)\b([^.;:]*?)\b(move|toughness|save|invulnerable save|wounds|leadership|objective control|attacks|strength|armour penetration|ballistic skill|weapon skill|damage|range)\s+characteristic\b([^.;:]*)/gi
const PROSE_STATS: Record<string, string> = {
  move: 'M',
  toughness: 'T',
  save: 'SV',
  'invulnerable save': 'INVSV',
  wounds: 'W',
  leadership: 'LD',
  'objective control': 'OC',
  attacks: 'A',
  strength: 'S',
  'armour penetration': 'AP',
  'ballistic skill': 'BS',
  'weapon skill': 'WS',
  damage: 'D',
  range: 'R',
}

/**
 * Armour, not a weapon of ours: "attacks that target this unit have -1 AP",
 * "each time an attack is allocated to this model, subtract 1 from the Damage
 * characteristic of that attack".
 */
const INCOMING = /\battacks?\b[^.;]*(?:\btargets?\s+(?:this|that|your|the bearer)\b|\ballocated\b)/i
/** An aura hands a characteristic to whoever stands near, not to the model with it. */
const AURA = /\bwithin\s+\d+"/i
/** "While a friendly X unit is within 6\" of this model, that unit has …" — for the others. */
const AURA_FOR_OTHERS = /friendly[^.;]*within\s+\d+"\s*of\s+(?:this|the bearer)/i
/** "+2 A for each model embarked" cannot be printed as one number. */
const COUNTED = /\bfor (?:each|every)\b|\bmaximum of\b/i
/** The clause has to be speaking about the unit in hand at all. */
// "your unit" is how a Stratagem addresses the player about the unit it is
// used on; the datasheets say "this unit" and the older text "the bearer".
const SELF_MENTION = /\b(?:this|that|your)\s+(?:unit|model)s?\b|\bthe\s+bearer\b|\bbearer'?’?s\b/i
const SOMEBODY_ELSE = /\benemy\b/i
/** Words that open a clause without saying anything about when it holds. */
const CONNECTIVE = /^(?:in addition|instead|and|also|then)$/i

/** "melee attacks have", "ranged weapons" — which half of the datasheet. */
const ATTACKS = /\b(melee|ranged)\s+(?:attacks?|weapons?)\b/i

/**
 * The clause's subject is the unit in front of you. The first noun phrase is
 * the subject; a rule that speaks about somebody else names them first.
 */
// "Your unit" is the subject a Stratagem uses for the unit it is used on.
const SELF = /^\W*(?:this|that|the|your)\s+(?:unit|model|bearer)|^\W*the\s+bearer/i


const subjectIsSelf = (clause: string): boolean => {
  const plain = unbold(clause)
  // Anything before the last comma is the condition, not the subject.
  const cut = plain.lastIndexOf(',')
  const subject = cut === -1 ? plain : plain.slice(cut + 1)
  if (!SELF.test(subject.trim())) return false
  // "While a friendly X unit is within 6" of this model, that unit has …" is
  // about whoever is standing there, not about the model with the aura.
  return !(/^\W*that\b/i.test(subject.trim()) && AURA.test(plain.slice(0, Math.max(cut, 0))))
}

/**
 * Said of *our* unit's attacks, "that target that unit" is the target the rule
 * had us pick a sentence earlier, not an attack coming at us.
 */
const OUR_ATTACKS_AT_THAT =
  /\b(?:(?:this|that|your)\s+(?:unit|model)|the\s+bearer)['’]s\s+(?:\w+\s+)?attacks?\s+that\s+targets?\s+that\b/i
const isIncoming = (text: string): boolean => INCOMING.test(text) && !OUR_ATTACKS_AT_THAT.test(text)

/** "(excluding [TORRENT] attacks)" */
const EXCLUDING = /\(?\bexcluding\s+\[([^\]]+)\]\s+(?:attacks?|weapons?)\)?/i
/** "[PSYCHIC] attacks", "[PSYCHIC] weapons" */
const KEYWORD_ATTACKS = /\[([^\]]+)\]\s+(?:attacks?|weapons?)\b/i
/** "this unit's Scavenged Shivs weapons" — the owner, then the weapon's own name. */
const NAMED_WEAPON =
  /(?:(?:[Tt]his|[Tt]hat)\s+(?:unit|model)|[Tt]he\s+bearer)['’]s\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)*)\s+weapons?\b/

/** Which weapons the text in front of an effect confines it to, if it does. */
function weaponFilterOf(text: string): WeaponFilter | undefined {
  const plain = unbold(text)
  const filter: WeaponFilter = {}
  const except = EXCLUDING.exec(plain)
  if (except) filter.except = except[1]!.trim()
  const keyword = KEYWORD_ATTACKS.exec(except ? plain.replace(EXCLUDING, ' ') : plain)
  if (keyword) filter.keyword = keyword[1]!.trim()
  const named = NAMED_WEAPON.exec(plain)
  if (named && !/^(?:Melee|Ranged)$/i.test(named[1]!)) filter.name = named[1]!
  return Object.keys(filter).length > 0 ? filter : undefined
}

const folded = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s$/, '')

/** Whether a modifier's weapon filter lets this weapon through. No filter lets all through. */
export function appliesToWeapon(mod: { weapon?: WeaponFilter }, weapon?: WeaponRef): boolean {
  const filter = mod.weapon
  if (!filter) return true
  if (!weapon) return false
  const has = (keyword: string) => {
    const want = keyword.toLowerCase()
    return weapon.keywords.some((k) => k.toLowerCase() === want || k.toLowerCase().startsWith(`${want} `))
  }
  if (filter.keyword && !has(filter.keyword)) return false
  if (filter.except && has(filter.except)) return false
  if (filter.name && !folded(weapon.name).startsWith(folded(filter.name))) return false
  return true
}

/** The things a heading says about the attacks in the bullets under it. */
type Heading = { kind?: ModTarget | undefined; weapon?: WeaponFilter | undefined; target?: string | undefined }

/** Words that make a "heading" only a pseudo-heading inside a list ("Or:"). */
const LIST_CONNECTIVE = /^\W*(?:or|and|also|otherwise|in addition)\W*:$/i
/** "4+ InSv against ranged attacks" — what the change holds against. */
const AGAINST = /\bagainst\s+(?:(?:melee|ranged)\s+)?attacks?\b/i

/** The stats that are a weapon's, and the roll modifiers that go with them. */
const WEAPONISH = new Set([...Object.values(WEAPON_STATS), 'HIT', 'WOUND'])
/** The characteristics that are a roll on one die; improving them lowers the number. */
const SKILLS = new Set(['BS', 'WS', 'SV', 'INVSV'])

/** Every characteristic the given rules change. Callers pass only rules that already speak about this unit. */
export function statMods(rules: readonly GrantingRule[]): StatMod[] {
  const out: StatMod[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    let heading: string | undefined
    let headingSubject: ModSubject | undefined
    // What the heading above a bullet list says about the attacks it lists:
    // "This unit's melee attacks have:" makes every bullet a melee one.
    let under: Heading = {}
    let incomingHeading = false
    let previous = ''
    for (const raw of clausesOf(rule.text)) {
      // A bullet's "- " is its marker, not part of what it says: left on, it
      // hides the condition the bullet opens with.
      const clause = stripBullet(raw)
      const bulleted = clause !== raw
      const prior = previous
      previous = clause
      if (clause.endsWith(':')) {
        heading = conditionOf(clause.slice(0, -1))
        headingSubject = subjectIn(clause)
        if (!LIST_CONNECTIVE.test(clause)) {
          under = {
            kind: ATTACKS.exec(clause)?.[1]?.toLowerCase() as ModTarget | undefined,
            weapon: weaponFilterOf(clause),
            target: targetCondition(clause),
          }
          incomingHeading = isIncoming(clause)
        }
      } else if (!bulleted && !prior.endsWith(':')) {
        under = {}
        incomingHeading = false
      }
      // Armour and counted modifiers are real, but they are not this unit's
      // weapons and they are not one number — the rule's own text carries them.
      if (incomingHeading || isIncoming(clause) || COUNTED.test(clause)) continue

      const kind: ModTarget = (ATTACKS.exec(clause)?.[1]?.toLowerCase() as ModTarget | undefined) ?? under.kind ?? 'any'

      const take = (
        stat: string,
        op: 'delta' | 'set',
        value: string,
        target: ModTarget,
        at: number,
        subject: ModSubject,
      ) => {
        const prefix = clause.slice(0, at)
        const found = conditionOf(prefix)
        // "In addition" is a connective, not a condition; printing it as one
        // would claim the change is conditional when it is not.
        let when = found && CONNECTIVE.test(found) ? heading : (found ?? heading)
        // "Instead, until the end of the phase, add 6" to its Move" holds on the
        // same terms as the sentence it replaces a part of.
        if (!when && /^\W*instead\b/i.test(prefix)) when = leadingCondition(prior)
        // An aura is written on the model that projects it and is about whoever
        // stands in it, so it never changes that model's own characteristics.
        if (when && AURA_FOR_OTHERS.test(when)) return
        // A penalty the enemy suffers ("While an enemy unit is engaged with
        // only X: when shooting that enemy unit, those attacks have -1 to hit")
        // is not ours, however it is bulleted.
        const plainPrefix = unbold(prefix)
        const tail = plainPrefix.slice(plainPrefix.lastIndexOf(',') + 1).trim()
        if (when && /\benemy\b/i.test(when) && tail && !SELF_MENTION.test(tail)) return
        const weaponish = WEAPONISH.has(stat)
        const aimed = weaponish ? (targetCondition(prefix) ?? under.target) : undefined
        const trailing = AGAINST.exec(clause.slice(at))?.[0]
        when = withTarget(when, aimed)
        when = joinWhen(when, trailing)
        const weapon = weaponish ? (weaponFilterOf(prefix) ?? under.weapon) : undefined
        const key = `${rule.name}|${stat}|${op}|${value}|${target}|${when ?? ''}|${JSON.stringify(weapon ?? {})}`
        if (seen.has(key)) return
        seen.add(key)
        const instead =
          /\binstead\b/i.test(clause) &&
          out.some(
            (m) => m.rule === rule.name && m.stat === stat && m.op === op && m.target === target && !m.instead,
          )
        out.push({
          stat,
          op,
          value,
          target,
          subject,
          rule: rule.name,
          source: rule.source,
          ...(when ? { when } : {}),
          ...(aimed || trailing ? { against: true } : {}),
          ...(weapon ? { weapon } : {}),
          ...(instead ? { instead } : {}),
        })
      }

      for (const [pattern, op] of [
        [DELTA, 'delta'],
        [SET, 'set'],
      ] as const) {
        for (const match of clause.matchAll(pattern)) {
          const value = (match[1] ?? '').replace('−', '-')
          // "+1 **A** and **S**" is one change written for two or three characteristics.
          const tokens = op === 'delta' ? [...(match[2] ?? '').matchAll(BOLD_STAT)].map((t) => t[1]) : [match[2]]
          for (const token of tokens) {
            if (!token) continue
            const weapon = WEAPON_STATS[token.toLowerCase()]
            const unit = UNIT_STATS[token.toLowerCase()]
            if (!weapon && !unit) continue
            // A weapon characteristic is one wherever it is written; a unit's is
            // only this unit's when the clause is about this unit.
            if (!weapon && !subjectIsSelf(clause.slice(0, match.index))) continue
            take(
              weapon ?? unit!,
              op,
              value,
              weapon ? kind : 'unit',
              match.index,
              subjectOf(clause.slice(0, match.index), clause, headingSubject),
            )
          }
        }
      }

      // Roll modifiers. Like a weapon characteristic they need no subject test
      // — "+1 to hit rolls" is about the attacks the clause names — but the
      // clause must still be about our attacks and not about incoming ones,
      // which isIncoming has already ruled out above.
      for (const match of clause.matchAll(ROLL)) {
        const stat = ROLL_STATS[(match[2] ?? '').toLowerCase()]
        if (!stat) continue
        take(
          stat,
          'delta',
          (match[1] ?? '').replace('−', '-'),
          kind,
          match.index,
          subjectOf(clause.slice(0, match.index), clause, headingSubject),
        )
      }

      // The spelled-out grammar. Its subject is a whole phrase ("models in the
      // bearer's unit"), so it is enough that the clause speaks about us and
      // about nobody else.
      if (!SELF_MENTION.test(clause) || SOMEBODY_ELSE.test(clause)) continue
      for (const match of clause.matchAll(PROSE)) {
        const stat = PROSE_STATS[(match[3] ?? '').toLowerCase()]
        if (!stat) continue
        const verb = match[1]?.toLowerCase()
        const amount = /(\d+)\s*("?)/.exec(
          verb === 'improve' || verb === 'worsen' ? (match[4] ?? '') : (match[2] ?? ''),
        )
        if (!amount) continue
        // A better skill is a *lower* number: "improve the Weapon Skill
        // characteristic by 1" takes a 3+ to 2+, the opposite of a plain "+1".
        // (AP is the other way about: its "+1" already means one better.)
        const lowers = SKILLS.has(stat) && (verb === 'improve' || verb === 'worsen')
        const sign = lowers
          ? verb === 'improve'
            ? '-'
            : '+'
          : verb === 'subtract' || verb === 'worsen'
            ? '-'
            : '+'
        // The spelled-out grammar names who it is for *after* the change
        // ("…of models in the bearer's unit"), so the whole clause is read.
        take(
          stat,
          'delta',
          `${sign}${amount[1]}${amount[2] ?? ''}`,
          WEAPON_STATS[stat.toLowerCase()] ? kind : 'unit',
          match.index,
          subjectOf(clause, clause, headingSubject),
        )
      }
    }
  }
  return out
}

/** A modifier in force right now: unconditional, or its condition already met. */
export const isLive = (mod: StatMod): boolean => !mod.when || mod.met === true

/** Marks the modifiers whose condition is a state the unit is already in. */
export const resolveMods = (
  mods: readonly StatMod[],
  activeStates: readonly string[],
  facts: Facts = {},
): StatMod[] =>
  mods.map((mod) =>
    // A condition on the target never holds "now": it is different every attack.
    mod.when && !mod.against && conditionMet(mod.when, activeStates, facts) ? { ...mod, met: true } : mod,
  )

/**
 * A modifier to the hit roll, as the skill cell reads it.
 *
 * A "+1 to hit" is not a better Ballistic Skill — it modifies the roll, and the
 * two come apart when several modifiers meet. But what a player reads off the
 * table is the number they roll against, and a 5+ with +1 to hit *is* rolled
 * against 4+; leaving the cell at 5+ with a note underneath is the arithmetic
 * this app exists to do. So the cell shows the modified number, marked as a
 * change and named under the table, while the modifier itself stays a HIT
 * modifier everywhere else.
 *
 * Better is *lower*, which is why the sign flips.
 */
export function skillMods(
  mods: readonly StatMod[],
  kind: 'ranged' | 'melee',
  weapon?: WeaponRef,
): StatMod[] {
  const stat = kind === 'ranged' ? 'BS' : 'WS'
  return mods
    .filter(
      (mod) =>
        mod.stat === 'HIT' && (mod.target === kind || mod.target === 'any') && appliesToWeapon(mod, weapon),
    )
    .map((mod) => ({
      ...mod,
      stat,
      value: mod.value.startsWith('-') ? `+${mod.value.slice(1)}` : `-${mod.value.replace('+', '')}`,
    }))
}

/** Characteristics that are a roll on one die: never better than 2+, never worse than 6+. */
const ROLLED = new Set(['BS', 'WS', 'SV', 'INVSV'])

/** The modifiers that land on one characteristic of one thing. */
export const modsFor = (
  mods: readonly StatMod[],
  target: ModTarget,
  stat: string,
  weapon?: WeaponRef,
): StatMod[] =>
  mods.filter(
    (mod) =>
      mod.stat === stat &&
      // A melee weapon has no range to add to.
      !(stat === 'R' && target === 'melee') &&
      (target === 'unit' ? mod.target === 'unit' : mod.target === target || mod.target === 'any') &&
      appliesToWeapon(mod, weapon),
  )

/** A printed characteristic split into its number and whatever decorates it. */
const NUMERIC = /^([+-]?\d+)("|\+)?$/
/** "D6", "2D6", "D6+3": a die, perhaps with a flat number beside it. */
const DICE = /^(\d*D\d+)(?:([+-])(\d+))?$/i

/** The least a characteristic can be, however much is taken from it. */
const FLOOR: Record<string, number> = { M: 0, OC: 0, T: 1, W: 1, A: 0, S: 1, D: 1, R: 0 }

export type Applied = {
  value: string
  /** A rule changed it, so it is not the printed number any more. */
  changed: boolean
  /** …and it is a change that ends: a condition holds now but need not later. */
  temporary: boolean
  /**
   * Changes that would apply if their condition held, and do not right now.
   * The value is left alone for these — a 5+ invulnerable save the unit only
   * has while it is riled up must not read as an invulnerable save — but they
   * are worth saying, so the screen marks the characteristic and names them.
   */
  pending: StatMod[]
}

/**
 * The value to print for a characteristic once the rules have had their say.
 *
 * A save is set, not added to, and the best one wins. AP is written as a
 * negative and improved by "+1", which is the rules' own convention rather
 * than arithmetic. A value that is not a number at all (D6) keeps its text
 * with the change written after it, rather than being invented.
 */
export function applyMod(printed: string | undefined, mods: readonly StatMod[]): Applied {
  let value = printed ?? '—'
  // "Melee" has no range, and a range modifier has nothing to say about it.
  if (mods[0]?.stat === 'R' && !/^\d/.test(value))
    return { value, changed: false, temporary: false, pending: [] }
  const pending = mods.filter((mod) => !isLive(mod))
  const live = mods.filter(isLive)
  if (live.length === 0) return { value, changed: false, temporary: false, pending }
  const isAp = live[0]!.stat === 'AP'
  const stat = live[0]!.stat

  for (const mod of live.filter((m) => m.op === 'set')) {
    const next = Number.parseInt(mod.value, 10)
    const now = Number.parseInt(value, 10)
    // A save is better the lower it is; anything else set is simply set.
    value = Number.isFinite(now) && Number.isFinite(next) && next > now ? value : mod.value
  }

  // "…add 3 instead": a change that holds replaces the rule's other change to
  // this characteristic rather than stacking on it.
  const replacing = new Set(live.filter((m) => m.instead).map((m) => m.rule))
  const deltas = live.filter((m) => m.op === 'delta' && (m.instead || !replacing.has(m.rule)))
  if (deltas.length > 0) {
    const parts = NUMERIC.exec(value)
    const sum = deltas.reduce((total, mod) => total + (Number.parseInt(mod.value, 10) || 0), 0)
    const unit = deltas.map((mod) => (mod.value.endsWith('"') ? '"' : '')).find(Boolean) ?? ''
    const dice = DICE.exec(value)
    if (!parts) {
      // "N/A" is what a weapon that does not roll to hit prints; a modifier to
      // that roll does nothing to it, and must not invent a number. A die takes
      // the number beside it ("2D6" + 1 is "2D6+1", not "3D6").
      if (dice && !ROLLED.has(stat)) {
        const flat = (dice[2] === '-' ? -1 : 1) * Number(dice[3] ?? 0) + sum
        value = flat === 0 ? dice[1]! : `${dice[1]}${flat > 0 ? '+' : '-'}${Math.abs(flat)}${unit}`
      }
    } else if (isAp) {
      // "+1 AP" means one better, and better AP is further from zero.
      const magnitude = Math.max(0, Math.abs(Number(parts[1])) + sum)
      value = magnitude === 0 ? '0' : `-${magnitude}`
    } else if (ROLLED.has(stat)) {
      // One die, so the printed number stays between 2+ and 6+ however many
      // modifiers pile on.
      value = `${Math.min(6, Math.max(2, Number(parts[1]) + sum))}${parts[2] || unit}`
    } else {
      value = `${Math.max(FLOOR[stat] ?? -Infinity, Number(parts[1]) + sum)}${parts[2] || unit}`
    }
  }

  return {
    value,
    changed: value !== (printed ?? '—'),
    temporary: live.some((mod) => Boolean(mod.when)),
    pending,
  }
}
