/**
 * Which units are one unit at the table.
 *
 * A character attached to a bodyguard is part of it — but only while the
 * bodyguard is on the table. The roster keeps the link (`leaderOf`) for the
 * whole game so that bringing the bodyguard back restores it; whether it is
 * *in force* is derived here from the host being alive, and every place that
 * asks "is this character leading?" must ask through these functions.
 */

import type { GameUnit } from './types'

/** The unit this one is effectively attached to: its host, while the host stands. */
export function hostOf(unit: GameUnit, units: readonly GameUnit[]): GameUnit | undefined {
  if (!unit.leaderOf) return undefined
  return units.find((u) => u.id === unit.leaderOf && !u.destroyed)
}

/**
 * Every unit that is part of the same attached unit as `unit` — the bodyguard
 * and the characters standing with it, `unit` itself included (even if it has
 * been destroyed, so an action on it never drops it). Destroyed characters
 * are left out unless `withCasualties` — Starting Strength counts them.
 */
export function wholeUnitOf(
  unit: GameUnit,
  units: readonly GameUnit[],
  withCasualties = false,
): GameUnit[] {
  const host = hostOf(unit, units)
  const hostId = host?.id ?? unit.id
  const hostStands = units.some((u) => u.id === hostId && !u.destroyed)
  return units.filter(
    (u) =>
      u.id === unit.id ||
      ((withCasualties || !u.destroyed) &&
        (u.id === hostId || (u.leaderOf === hostId && hostStands))),
  )
}

/** Models alive across the whole attached unit — what the rules count as "the unit". */
export const livingModels = (units: readonly GameUnit[]): number =>
  units.reduce((sum, u) => sum + u.models.reduce((n, g) => n + g.alive, 0), 0)

/** Starting Strength of the whole attached unit, for "below half-strength". */
export const startingStrength = (units: readonly GameUnit[]): number =>
  units.reduce((sum, u) => sum + u.models.reduce((n, g) => n + g.total, 0), 0)
