/**
 * Reminders (spec §6.4): every ability, enhancement, detachment rule and army
 * rule can carry reminder metadata — when it matters, whose it is, a one-line
 * text, and whether it is once-per-something. Defaults come from keyword
 * heuristics over the rule text; the owner can override each one.
 */

export type Trigger =
  | 'start_of_battle'
  | 'command_phase'
  | 'movement_phase'
  | 'shooting_phase'
  | 'charge_phase'
  | 'fight_phase'
  | 'when_charged'
  | 'when_targeted'
  | 'on_arrival_from_reserves'
  | 'end_of_turn'
  | 'opponent_turn'
  | 'once_per_battle'
  | 'once_per_turn'
  | 'custom'

export const TRIGGERS: readonly Trigger[] = [
  'start_of_battle',
  'command_phase',
  'movement_phase',
  'shooting_phase',
  'charge_phase',
  'fight_phase',
  'when_charged',
  'when_targeted',
  'on_arrival_from_reserves',
  'end_of_turn',
  'opponent_turn',
  'once_per_battle',
  'once_per_turn',
  'custom',
]

export const TRIGGER_LABELS: Record<Trigger, string> = {
  start_of_battle: 'Start of the battle',
  command_phase: 'Command phase',
  movement_phase: 'Movement phase',
  shooting_phase: 'Shooting phase',
  charge_phase: 'Charge phase',
  fight_phase: 'Fight phase',
  when_charged: 'When charged',
  when_targeted: 'When targeted',
  on_arrival_from_reserves: 'Arriving from Reserves',
  end_of_turn: 'End of your turn',
  opponent_turn: "Opponent's turn",
  once_per_battle: 'Any time, once per battle',
  once_per_turn: 'Any time, once per turn',
  custom: 'Custom (shown in the Command phase)',
}

export type ReminderOwner = 'unit' | 'detachment' | 'army'

export type Once = 'battle' | 'turn'

/** A reminder as shown at the table, after overrides. */
export type Reminder = {
  /** Stable id: the BSData rule / profile id, so overrides survive data updates. */
  id: string
  /** Where the rule text came from — the ability, rule or enhancement name. */
  sourceName: string
  owner: ReminderOwner
  /** The unit's name, or the detachment's; absent for army-wide rules. */
  ownerName?: string
  /** The game unit this belongs to, when it is a unit's. */
  unitId?: string
  trigger: Trigger
  text: string
  once?: Once
  enabled: boolean
}

/** What the owner changed about a reminder; anything absent keeps the default. */
export type ReminderOverride = {
  id: string
  enabled?: boolean
  trigger?: Trigger
  text?: string
  updatedAt: number
}

/** The heuristics' verdict on one piece of rule text. */
export type Inferred = {
  trigger: Trigger
  text: string
  once?: Once
  /** Passive rules with no recognisable moment stay off until the owner turns them on. */
  enabled: boolean
}
