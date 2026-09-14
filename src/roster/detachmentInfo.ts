/**
 * What a detachment actually gives an army — its enhancements and its
 * stratagems — for the roster editor to show beside its rules.
 *
 * The two halves of an enhancement live in different sources: the MFM mirror
 * lists a detachment's enhancements by name and price, BSData carries the rules
 * text, and nothing joins them but the name. `normaliseName` is the same
 * matcher the cross-source merge uses, so a curly apostrophe or a shouted name
 * does not lose the text.
 */

import { normaliseName } from '@/data/link/merge'
import type { Detachment, ParsedCatalogue } from '@/data/model'
import { forDetachment } from '@/stratagems/select'
import type { Stratagem } from '@/stratagems/types'

export type DetachmentEnhancement = {
  /** The BSData entry id, when the text was found. */
  id?: string
  name: string
  points?: number
  /** Empty when the sources disagree on the name and the text could not be found. */
  text: string
}

/** A detachment's enhancements, each with its rules text where one exists. */
export function detachmentEnhancements(
  detachment: Detachment,
  catalogue: ParsedCatalogue,
): DetachmentEnhancement[] {
  const byName = new Map(
    (catalogue.enhancements ?? []).map((ability) => [normaliseName(ability.name), ability]),
  )
  return detachment.enhancements.map((enhancement) => {
    const ability = byName.get(normaliseName(enhancement.name))
    return {
      ...(ability ? { id: ability.id } : {}),
      name: enhancement.name,
      ...(enhancement.points === undefined ? {} : { points: enhancement.points }),
      text: ability?.text ?? '',
    }
  })
}

/**
 * A detachment's own stratagems. The Core set is deliberately left out: it
 * belongs to every army and says nothing about this detachment, which is the
 * question the section answers.
 */
export function detachmentStratagems(
  detachment: Detachment,
  all: readonly Stratagem[] | undefined,
): Stratagem[] {
  if (!all) return []
  return forDetachment(all, [detachment.name]).filter((s) => !s.core)
}
