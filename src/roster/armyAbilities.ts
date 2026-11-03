import type { Ability } from '@/data/model'

/**
 * A datasheet's abilities as this army has them: a rule the data grants only
 * with a detachment (`onlyWith`) is dropped unless the army holds one of those.
 * The datasheet browser, which has no army, lists them all and says so.
 */
export function abilitiesInArmy(abilities: readonly Ability[], detachmentNames: readonly string[]): Ability[] {
  return abilities.filter((a) => !a.onlyWith || a.onlyWith.some((name) => detachmentNames.includes(name)))
}
