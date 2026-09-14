/**
 * Everything the army's rules do to one unit at the table: the weapon abilities
 * they grant and the characteristics they change.
 *
 * The sources are the same wherever a unit is shown — the detachments the army
 * took that name it, its own datasheet and faction abilities, its enhancements,
 * and the rules of the states it is in — so the army list and the opened
 * datasheet read from one place and can never disagree.
 */

import type { Datasheet, ParsedCatalogue } from '@/data/model'
import { ruleAppliesTo } from '@/roster/detachmentRules'
import { effectsFrom, type Effects } from './effects'
import type { GrantingRule } from './grants'
import { rulesAboutMark, type Mark } from './marks'
import type { GameUnit } from './types'

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
 * `marks` are the states the installed data names, discovered once per
 * catalogue by the caller; only the ones this unit is actually in are read, so
 * this stays cheap enough to run for every card in an army list.
 */
export function effectsForUnit({
  unit,
  sheet,
  catalogue,
  detachmentNames,
  marks = [],
}: {
  unit: GameUnit
  sheet: Datasheet | undefined
  catalogue: ParsedCatalogue | undefined
  detachmentNames: readonly string[]
  marks?: readonly Mark[]
}): Effects {
  const keywords = sheet ? [...sheet.keywords, ...sheet.factionKeywords] : []
  const enhancementText = new Map((catalogue?.enhancements ?? []).map((e) => [e.id, e.text]))
  const held = unit.marks ?? []
  const markRules = catalogue
    ? marks
        .filter((mark) => held.includes(mark.key))
        .flatMap((mark) =>
          rulesAboutMark(catalogue, mark, keywords, unit.entryId, detachmentNames).map((rule) => ({
            name: rule.name,
            text: rule.text,
            source: mark.label,
          })),
        )
    : []
  const rules: GrantingRule[] = [
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
    ...(unit.enhancements ?? []).map((e) => ({
      name: e.name,
      text: enhancementText.get(e.id) ?? '',
      source: 'Enhancement',
    })),
    ...markRules,
  ]
  return effectsFrom(rules, held)
}
