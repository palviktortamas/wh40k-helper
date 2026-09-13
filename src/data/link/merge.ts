/**
 * Cross-links BSData and the MFM mirror, and records where they disagree.
 *
 * Per spec §4.1 the join is by normalised name + faction, with an alias table
 * for the cases normalisation cannot reach. Records that exist in only one
 * source are reported as `unmatched` rather than silently dropped — the missing
 * detachments in Appendix A.3 are exactly that case.
 */

import type { ParsedCatalogue, Datasheet, Detachment, PricingBand } from '../model'
import type { MfmCatalogue } from '../mfm/parse'
import type { SourceId } from '../sources'

/**
 * Normalises a name for matching: the MFM title-cases ("Kult Of Speed"), uses
 * curly apostrophes, and suffixes enhancements with "(Upgrade)", while BSData
 * tags variants with a bracketed suffix ("… [Legends]") the mirror omits.
 */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((?:upgrade|enhancement)\)/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export type DiscrepancyField = 'points' | 'detachmentPoints' | 'forceDispositions'

export type Discrepancy = {
  /** Stable key so a user override survives data updates. */
  key: string
  subject: string
  field: DiscrepancyField
  values: { source: SourceId; value: string }[]
  /** Which source the app used, by the precedence rules in spec §4.1. */
  chosen: SourceId
}

export type Unmatched = {
  kind: 'datasheet' | 'detachment'
  name: string
  presentIn: SourceId[]
}

export type MergeReport = {
  discrepancies: Discrepancy[]
  unmatched: Unmatched[]
  matchedDatasheets: number
  matchedDetachments: number
}

const sameSet = (a: string[], b: string[]) => {
  const na = [...new Set(a.map(normaliseName))].sort()
  const nb = [...new Set(b.map(normaliseName))].sort()
  return na.length === nb.length && na.every((v, i) => v === nb[i])
}

/**
 * Applies MFM data onto the BSData catalogue in place and returns what did not
 * line up. MFM wins on points and Force Dispositions; BSData keeps constraints.
 */
export function mergeMfm(catalogue: ParsedCatalogue, mfm: MfmCatalogue): MergeReport {
  const discrepancies: Discrepancy[] = []
  const unmatched: Unmatched[] = []

  const mfmUnits = new Map(mfm.units.map((u) => [normaliseName(u.name), u]))
  const usedUnits = new Set<string>()
  let matchedDatasheets = 0

  for (const sheet of catalogue.datasheets) {
    const key = normaliseName(sheet.name)
    const match = mfmUnits.get(key)
    if (!match) {
      // A datasheet imported from a linked library (Legends fortifications, a
      // shared library's other factions) is not in this faction's mirror by design.
      if (!sheet.library) unmatched.push({ kind: 'datasheet', name: sheet.name, presentIn: ['bsdata'] })
      continue
    }
    usedUnits.add(key)
    matchedDatasheets++
    applyUnit(sheet, match, discrepancies)
  }

  for (const unit of mfm.units) {
    if (!usedUnits.has(normaliseName(unit.name)))
      unmatched.push({ kind: 'datasheet', name: unit.name, presentIn: ['mfm'] })
  }

  const mfmDetachments = new Map(mfm.detachments.map((d) => [normaliseName(d.name), d]))
  const usedDetachments = new Set<string>()
  let matchedDetachments = 0

  for (const detachment of catalogue.detachments) {
    const key = normaliseName(detachment.name)
    const match = mfmDetachments.get(key)
    if (!match) {
      if (!detachment.library) unmatched.push({ kind: 'detachment', name: detachment.name, presentIn: ['bsdata'] })
      continue
    }
    usedDetachments.add(key)
    matchedDetachments++
    applyDetachment(detachment, match, discrepancies)
  }

  for (const detachment of mfm.detachments) {
    if (!usedDetachments.has(normaliseName(detachment.name)))
      unmatched.push({ kind: 'detachment', name: detachment.name, presentIn: ['mfm'] })
  }

  return { discrepancies, unmatched, matchedDatasheets, matchedDetachments }
}

function applyUnit(
  sheet: Datasheet,
  mfm: { name: string; pricing: PricingBand[]; leaderTo: string[]; supportTo: string[] },
  discrepancies: Discrepancy[],
): void {
  sheet.sources = [...new Set([...sheet.sources, 'mfm' as SourceId])]
  sheet.pricing = mfm.pricing
  if (mfm.leaderTo.length > 0) sheet.leaderTo = mfm.leaderTo
  if (mfm.supportTo.length > 0) sheet.supportTo = mfm.supportTo

  // Compare the first band's cheapest entry against the BSData base cost: that
  // is the number a roster shows before modifiers, so a mismatch is visible.
  const band = mfm.pricing?.[0]
  const cheapest = band?.costs.reduce<number | undefined>(
    (min, c) => (min === undefined || c.points < min ? c.points : min),
    undefined,
  )
  if (
    cheapest !== undefined &&
    sheet.basePoints !== undefined &&
    cheapest !== sheet.basePoints
  ) {
    discrepancies.push({
      key: `points:${sheet.id}`,
      subject: sheet.name,
      field: 'points',
      values: [
        { source: 'mfm', value: String(cheapest) },
        { source: 'bsdata', value: String(sheet.basePoints) },
      ],
      chosen: 'mfm',
    })
  }
}

function applyDetachment(
  detachment: Detachment,
  mfm: Detachment,
  discrepancies: Discrepancy[],
): void {
  detachment.sources = [...new Set([...detachment.sources, 'mfm' as SourceId])]
  detachment.enhancements = mfm.enhancements

  if (mfm.dp !== undefined && detachment.dp !== undefined && mfm.dp !== detachment.dp) {
    discrepancies.push({
      key: `dp:${detachment.name}`,
      subject: detachment.name,
      field: 'detachmentPoints',
      values: [
        { source: 'mfm', value: String(mfm.dp) },
        { source: 'bsdata', value: String(detachment.dp) },
      ],
      chosen: 'mfm',
    })
  }
  if (mfm.dp !== undefined) detachment.dp = mfm.dp

  if (
    mfm.forceDispositions.length > 0 &&
    !sameSet(mfm.forceDispositions, detachment.forceDispositions)
  ) {
    discrepancies.push({
      key: `fd:${detachment.name}`,
      subject: detachment.name,
      field: 'forceDispositions',
      values: [
        { source: 'mfm', value: mfm.forceDispositions.join(', ') },
        { source: 'bsdata', value: detachment.forceDispositions.join(', ') },
      ],
      chosen: 'mfm',
    })
    detachment.forceDispositions = mfm.forceDispositions
  }
}
