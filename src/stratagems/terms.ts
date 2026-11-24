/**
 * The edition's move, shoot and fight types: "pulse jet move", "surge move",
 * "snap shooting". Rules name them in bold and say no more ("this unit can make
 * a **pulse jet move**"); what such a move is — how far, who may, what happens
 * after — is defined once, and BSData carries none of those definitions.
 * Wahapedia's stratagem export lists them in the same table, typed "Movement
 * Ability" / "Shooting Ability", so they are read from there.
 */

import { htmlToMarked } from './marked'
import { parsePipeCsv } from './parseCsv'

export type RuleTerm = {
  /** As printed: "PULSE JET MOVE". */
  name: string
  /** "Move", "Shoot" or "Fight" — the export's own word. */
  kind: string
  /** Marked text (see Marked): headings in `__…__`, bullets as "• ". */
  text: string
}

/** Spellings fold together: case, non-breaking hyphens, runs of spaces. */
const key = (s: string): string =>
  s
    .replace(/[‐‑‒–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** `Ability "Move"` → Move. */
const KIND = /^ability\s+["“]?([^"”]+)["”]?$/i

export function parseRuleTerms(csv: string): RuleTerm[] {
  const out = new Map<string, RuleTerm>()
  for (const row of parsePipeCsv(csv)) {
    const type = (row['type'] ?? '').trim()
    if (!/\bability$/i.test(type)) continue
    const kind = KIND.exec((row['phase'] ?? '').trim())?.[1]?.trim()
    const name = (row['name'] ?? '').replace(/[‐‑‒–]/g, '-').trim()
    // Each section (MAXIMUM DISTANCE, ELIGIBLE IF, …) sits in its own block.
    const text = htmlToMarked((row['description'] ?? '').replace(/<\/div>/gi, '<br>'))
    // The export lists some twice (an older copy beside the current one); the first stands.
    if (!kind || !name || !text || out.has(key(name))) continue
    out.set(key(name), { name, kind, text })
  }
  return [...out.values()]
}

/** The term a rule's bold words name, if any. */
export const termFor = (words: string, terms: readonly RuleTerm[]): RuleTerm | undefined => {
  const wanted = key(words)
  return terms.find((t) => key(t.name) === wanted)
}
