/**
 * Parses the Munitorum Field Manual mirror (YAML). This is the authoritative
 * source for points, Requisition Threshold bands, detachment points, Force
 * Dispositions, enhancement costs, and leader/support eligibility.
 */

import { parse as parseYaml } from 'yaml'
import type { Detachment, PricingBand } from '../model'
import { titleCase } from '@/missions/types'

export type MfmUnit = {
  name: string
  pricing: PricingBand[]
  leaderTo: string[]
  supportTo: string[]
}

export type MfmCatalogue = {
  name: string
  slug: string
  version: string
  firstSeen?: string
  units: MfmUnit[]
  detachments: Detachment[]
}

type RawPricing = {
  range?: string
  label?: string
  costs?: { models?: number; points?: number }[]
}

type RawUnit = {
  name?: string
  pricing?: RawPricing[]
  leaderTo?: string[]
  supportTo?: string[]
}

type RawDetachment = {
  name?: string
  dp?: number
  objectives?: string[]
  enhancements?: ({ name?: string; points?: number } | string)[]
}

type RawFile = {
  name?: string
  slug?: string
  version?: string | number
  firstSeen?: string
  units?: RawUnit[]
  detachments?: RawDetachment[]
}

/**
 * Interval notation from the mirror: "[1,3]" is the 1st-to-3rd copies of a
 * datasheet, "[4,)" is the 4th onwards. Anything unparseable falls back to an
 * open band from 1 rather than dropping the price.
 */
function parseRange(range: string | undefined): { from: number; to?: number } {
  const match = /^\[(\d+)\s*,\s*(\d+)?\s*[\])]$/.exec((range ?? '').trim())
  if (!match) return { from: 1 }
  const from = Number(match[1])
  const to = match[2] === undefined ? undefined : Number(match[2])
  return to === undefined ? { from } : { from, to }
}

export function parseMfm(yamlText: string): MfmCatalogue {
  const raw = parseYaml(yamlText) as RawFile

  const units: MfmUnit[] = (raw.units ?? [])
    .filter((u): u is RawUnit & { name: string } => typeof u.name === 'string')
    .map((u) => ({
      name: u.name,
      pricing: (u.pricing ?? []).map((p) => {
        const { from, to } = parseRange(p.range)
        return {
          ...(p.label ? { label: p.label } : {}),
          from,
          ...(to !== undefined ? { to } : {}),
          costs: (p.costs ?? [])
            .filter((c) => typeof c.models === 'number' && typeof c.points === 'number')
            .map((c) => ({ models: c.models!, points: c.points! })),
        } satisfies PricingBand
      }),
      leaderTo: u.leaderTo ?? [],
      supportTo: u.supportTo ?? [],
    }))

  const detachments: Detachment[] = (raw.detachments ?? [])
    .filter((d): d is RawDetachment & { name: string } => typeof d.name === 'string')
    .map((d) => ({
      name: d.name,
      ...(typeof d.dp === 'number' ? { dp: d.dp } : {}),
      // The mirror shouts them ("TAKE AND HOLD"), BSData title-cases them. An
      // army may hold several detachments and show their lists side by side, so
      // one casing is stored whichever source a value came from.
      forceDispositions: (d.objectives ?? []).map(titleCase),
      enhancements: (d.enhancements ?? []).map((e) =>
        typeof e === 'string'
          ? { name: e }
          : { name: e.name ?? '', ...(typeof e.points === 'number' ? { points: e.points } : {}) },
      ),
      sources: ['mfm'],
    }))

  return {
    name: raw.name ?? '',
    slug: raw.slug ?? '',
    version: String(raw.version ?? ''),
    ...(raw.firstSeen ? { firstSeen: raw.firstSeen } : {}),
    units,
    detachments,
  }
}
