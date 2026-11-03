import type { Ability } from '@/data/model'

/** "Some Unit [Crucible]" and "Some Unit" are the same datasheet to a rule that names one. */
const plainName = (name: string) => name.replace(/\s*\[[^\]]+\]\s*$/, '').trim().toLowerCase()

/**
 * A datasheet's abilities as this army has them: a rule the data grants only
 * with a detachment (`onlyWith`) is dropped unless the army holds one of those.
 * The datasheet browser, which has no army, lists them all and says so.
 *
 * A rule the data grants only while a character is attached (`onlyWithAttached`)
 * is dropped too — but only when the caller says who is attached
 * (`attachedNames`, the datasheet names of the characters attached to the unit;
 * an empty list means none). Left out, those rules are kept, as before, so a
 * caller that cannot tell yet does not lose rules.
 */
export function abilitiesInArmy(
  abilities: readonly Ability[],
  detachmentNames: readonly string[],
  attachedNames?: readonly string[],
): Ability[] {
  const attached = attachedNames?.map(plainName)
  return abilities.filter(
    (a) =>
      (!a.onlyWith || a.onlyWith.some((name) => detachmentNames.includes(name))) &&
      (!a.onlyWithAttached ||
        !attached ||
        (a.onlyWithAttached.length === 0
          ? attached.length > 0
          : a.onlyWithAttached.some((name) => attached.includes(plainName(name))))),
  )
}
