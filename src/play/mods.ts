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
 *   marks a characteristic rather than an ordinary number ("11+ models");
 * - a unit characteristic is taken only when the clause's subject is this very
 *   unit, so "a TRANSPORT unit this unit is embarked within has +2\" M" does
 *   not quietly speed up the passenger.
 *
 * Weapon characteristics need no such check: R/A/BS/WS/S/AP/D are weapon
 * characteristics wherever they appear, and the clause says which half of the
 * datasheet they land on.
 */

import { clausesOf, conditionOf, subjectIn, subjectOf, unbold, type GrantingRule } from './grants'

/** Where a modifier lands. */
export type ModTarget = 'unit' | 'ranged' | 'melee' | 'any'

/**
 * Who the rule is about. A unit and the characters attached to it are one unit
 * at the table, so a change written for "this unit" reaches all of them, while
 * one written for "this model" or "the bearer" stays with the character that
 * carries it.
 */
export type ModSubject = 'unit' | 'model'

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

/** "+2\" **M**", "-1 **T**" — a change to whatever characteristic follows. */
const DELTA = /([+\-−]\d+"?)\s*\*\*([A-Za-z]{1,5})\*\*(?:\s+and\s+\*\*([A-Za-z]{1,5})\*\*)?/g
/** "4+ **Sv**", "5+ **InSv**" — a characteristic set outright. */
const SET = /\b(\d\+)\s*\*\*([A-Za-z]{1,5})\*\*/g

/**
 * The same changes, spelled out the way the older books (and the codex text a
 * mirror carries) write them: "Add 2 to the Attacks characteristic of melee
 * weapons equipped by the bearer", "improve the Armour Penetration
 * characteristic of that attack by 1".
 */
const PROSE = /\b(add|subtract|improve)\b([^.;:]*?)\b(move|toughness|save|invulnerable save|wounds|leadership|objective control|attacks|strength|armour penetration|ballistic skill|weapon skill|damage|range)\s+characteristic\b([^.;:]*)/gi
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
const INCOMING = /\battacks?\b[^.;]*(?:\btargets?\s+(?:this|that|the bearer)\b|\ballocated\b)/i
/** An aura hands a characteristic to whoever stands near, not to the model with it. */
const AURA = /\bwithin\s+\d+"/i
/** "While a friendly X unit is within 6\" of this model, that unit has …" — for the others. */
const AURA_FOR_OTHERS = /friendly[^.;]*within\s+\d+"\s*of\s+(?:this|the bearer)/i
/** "+2 A for each model embarked" cannot be printed as one number. */
const COUNTED = /\bfor (?:each|every)\b|\bmaximum of\b/i
/** The clause has to be speaking about the unit in hand at all. */
const SELF_MENTION = /\b(?:this|that)\s+(?:unit|model)\b|\bthe\s+bearer\b|\bbearer'?’?s\b/i
const SOMEBODY_ELSE = /\benemy\b/i
/** Words that open a clause without saying anything about when it holds. */
const CONNECTIVE = /^(?:in addition|instead|and|also|then)$/i

/** "melee attacks have", "ranged weapons" — which half of the datasheet. */
const ATTACKS = /\b(melee|ranged)\s+(?:attacks?|weapons?)\b/i

/**
 * The clause's subject is the unit in front of you. The first noun phrase is
 * the subject; a rule that speaks about somebody else names them first.
 */
const SELF = /^\W*(?:this|that|the)\s+(?:unit|model|bearer)|^\W*the\s+bearer/i


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

/** Every characteristic the given rules change. Callers pass only rules that already speak about this unit. */
export function statMods(rules: readonly GrantingRule[]): StatMod[] {
  const out: StatMod[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    let heading: string | undefined
    let headingSubject: ModSubject | undefined
    for (const clause of clausesOf(rule.text)) {
      if (clause.endsWith(':')) {
        heading = conditionOf(clause.slice(0, -1))
        headingSubject = subjectIn(clause)
      }
      // Armour and counted modifiers are real, but they are not this unit's
      // weapons and they are not one number — the rule's own text carries them.
      if (INCOMING.test(clause) || COUNTED.test(clause)) continue

      const take = (
        stat: string,
        op: 'delta' | 'set',
        value: string,
        target: ModTarget,
        at: number,
        subject: ModSubject,
      ) => {
        const found = conditionOf(clause.slice(0, at)) ?? heading
        // "In addition" is a connective, not a condition; printing it as one
        // would claim the change is conditional when it is not.
        const when = found && CONNECTIVE.test(found) ? undefined : found
        // An aura is written on the model that projects it and is about whoever
        // stands in it, so it never changes that model's own characteristics.
        if (target === 'unit' && when && AURA_FOR_OTHERS.test(when)) return
        const key = `${rule.name}|${stat}|${op}|${value}|${target}`
        if (seen.has(key)) return
        seen.add(key)
        out.push({
          stat,
          op,
          value,
          target,
          subject,
          rule: rule.name,
          source: rule.source,
          ...(when ? { when } : {}),
        })
      }

      for (const [pattern, op] of [
        [DELTA, 'delta'],
        [SET, 'set'],
      ] as const) {
        for (const match of clause.matchAll(pattern)) {
          const value = (match[1] ?? '').replace('−', '-')
          // "+1 **A** and **S**" is one change written for two characteristics.
          for (const token of [match[2], match[3]]) {
            if (!token) continue
            const weapon = WEAPON_STATS[token.toLowerCase()]
            const unit = UNIT_STATS[token.toLowerCase()]
            if (!weapon && !unit) continue
            // A weapon characteristic is one wherever it is written; a unit's is
            // only this unit's when the clause is about this unit.
            if (!weapon && !subjectIsSelf(clause.slice(0, match.index))) continue
            const target: ModTarget = weapon
              ? ((ATTACKS.exec(clause)?.[1]?.toLowerCase() as ModTarget | undefined) ?? 'any')
              : 'unit'
            take(
              weapon ?? unit!,
              op,
              value,
              target,
              match.index,
              subjectOf(clause.slice(0, match.index), clause, headingSubject),
            )
          }
        }
      }

      // The spelled-out grammar. Its subject is a whole phrase ("models in the
      // bearer's unit"), so it is enough that the clause speaks about us and
      // about nobody else.
      if (!SELF_MENTION.test(clause) || SOMEBODY_ELSE.test(clause)) continue
      for (const match of clause.matchAll(PROSE)) {
        const stat = PROSE_STATS[(match[3] ?? '').toLowerCase()]
        if (!stat) continue
        const amount = /(\d+)\s*("?)/.exec(match[1]?.toLowerCase() === 'improve' ? (match[4] ?? '') : (match[2] ?? ''))
        if (!amount) continue
        const sign = match[1]?.toLowerCase() === 'subtract' ? '-' : '+'
        const target: ModTarget = WEAPON_STATS[stat.toLowerCase()]
          ? ((ATTACKS.exec(clause)?.[1]?.toLowerCase() as ModTarget | undefined) ?? 'any')
          : 'unit'
        // The spelled-out grammar names who it is for *after* the change
        // ("…of models in the bearer's unit"), so the whole clause is read.
        take(
          stat,
          'delta',
          `${sign}${amount[1]}${amount[2] ?? ''}`,
          target,
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
export const resolveMods = (mods: readonly StatMod[], activeStates: readonly string[]): StatMod[] =>
  mods.map((mod) =>
    mod.when && activeStates.some((state) => mod.when!.toLowerCase().includes(state.toLowerCase()))
      ? { ...mod, met: true }
      : mod,
  )

/** The modifiers that land on one characteristic of one thing. */
export const modsFor = (mods: readonly StatMod[], target: ModTarget, stat: string): StatMod[] =>
  mods.filter(
    (mod) =>
      mod.stat === stat &&
      (target === 'unit'
        ? mod.target === 'unit'
        : mod.target === target || mod.target === 'any'),
  )

/** A printed characteristic split into its number and whatever decorates it. */
const NUMERIC = /^([+-]?\d+)(.*)$/

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
  const pending = mods.filter((mod) => !isLive(mod))
  const live = mods.filter(isLive)
  if (live.length === 0) return { value, changed: false, temporary: false, pending }
  const isAp = live[0]!.stat === 'AP'

  for (const mod of live.filter((m) => m.op === 'set')) {
    const next = Number.parseInt(mod.value, 10)
    const now = Number.parseInt(value, 10)
    // A save is better the lower it is; anything else set is simply set.
    value = Number.isFinite(now) && Number.isFinite(next) && next > now ? value : mod.value
  }

  const deltas = live.filter((m) => m.op === 'delta')
  if (deltas.length > 0) {
    const parts = NUMERIC.exec(value)
    const sum = deltas.reduce((total, mod) => total + (Number.parseInt(mod.value, 10) || 0), 0)
    const unit = deltas.map((mod) => (mod.value.endsWith('"') ? '"' : '')).find(Boolean) ?? ''
    if (!parts) {
      value = `${value}${sum >= 0 ? '+' : ''}${sum}${unit}`
    } else if (isAp) {
      // "+1 AP" means one better, and better AP is further from zero.
      const magnitude = Math.max(0, Math.abs(Number(parts[1])) + sum)
      value = magnitude === 0 ? '0' : `-${magnitude}`
    } else {
      value = `${Number(parts[1]) + sum}${parts[2] || unit}`
    }
  }

  return {
    value,
    changed: value !== (printed ?? '—'),
    temporary: live.some((mod) => Boolean(mod.when)),
    pending,
  }
}
