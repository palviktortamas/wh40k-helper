/**
 * What the army's rules do to a unit's numbers, in one call.
 *
 * The weapon abilities they grant and the characteristics they change are read
 * by two readers of the same grammar, and every screen that shows a unit wants
 * both from the same list of rules — the detachments that name it, its own
 * abilities, its enhancements, the states it is in. `states` are the states the
 * unit is in right now, so a change that waits on one can say it is live.
 */

import { resolveGrants, weaponGrants, type GrantingRule, type WeaponGrant } from './grants'
import { resolveMods, statMods, type StatMod } from './mods'
import type { Facts } from './conditions'

export type Effects = { grants: WeaponGrant[]; mods: StatMod[] }

export const effectsFrom = (
  rules: readonly GrantingRule[],
  states: readonly string[] = [],
  /** What the app can answer without being told — the model count, and whether it leads. */
  facts: Facts = {},
): Effects => ({
  grants: resolveGrants(weaponGrants(rules), states, facts),
  mods: resolveMods(statMods(rules), states, facts),
})
