/**
 * Builds the reminders for a game from the frozen units and the parsed
 * catalogue (spec §6.4): each unit's datasheet abilities and enhancements,
 * the detachment's rules, and the army-wide rules every datasheet links to —
 * once, not per unit. Defaults come from the heuristics, then the owner's
 * overrides apply. Also decides which reminders show in the current phase.
 */

import type { Ability, ParsedCatalogue } from '@/data/model'
import type { Game, GameUnit, Phase } from '@/play/types'
import { infer } from './heuristics'
import { withOverride } from './store'
import type { Reminder, ReminderOverride, Trigger } from './types'

type Overrides = Map<string, ReminderOverride>

function fromAbility(
  ability: Ability,
  owner: Reminder['owner'],
  overrides: Overrides,
  extra: { ownerName?: string; unitId?: string } = {},
): Reminder {
  const inferred = infer(ability.name, ability.text)
  const base: Reminder = {
    id: ability.id,
    sourceName: ability.name,
    owner,
    ...(extra.ownerName ? { ownerName: extra.ownerName } : {}),
    ...(extra.unitId ? { unitId: extra.unitId } : {}),
    trigger: inferred.trigger,
    text: inferred.text,
    ...(inferred.once ? { once: inferred.once } : {}),
    enabled: inferred.enabled,
  }
  return withOverride(base, overrides.get(ability.id))
}

/** Every reminder a game can raise, enabled or not, in army → detachment → unit order. */
export function remindersForGame(game: Game, catalogue: ParsedCatalogue, overrides: Overrides): Reminder[] {
  const sheets = new Map(catalogue.datasheets.map((d) => [d.id, d]))
  const enhancements = new Map((catalogue.enhancements ?? []).map((e) => [e.id, e]))
  const army = new Map<string, Reminder>()
  const units: Reminder[] = []

  for (const unit of game.units) {
    if (unit.destroyed) continue
    const sheet = sheets.get(unit.entryId)
    for (const ability of sheet?.abilities ?? []) {
      if (ability.kind === 'faction' || ability.kind === 'core') {
        if (!army.has(ability.id)) army.set(ability.id, fromAbility(ability, 'army', overrides))
        continue
      }
      units.push(fromAbility(ability, 'unit', overrides, { ownerName: unit.name, unitId: unit.id }))
    }
    for (const taken of unit.enhancements ?? []) {
      const text = enhancements.get(taken.id)
      const ability: Ability = text ?? { id: taken.id, name: taken.name, kind: 'enhancement', text: '' }
      units.push(fromAbility(ability, 'unit', overrides, { ownerName: unit.name, unitId: unit.id }))
    }
  }

  const detachment = game.detachmentName
    ? catalogue.detachments.find((d) => d.name === game.detachmentName)
    : undefined
  const detachmentReminders = (detachment?.rules ?? []).map((r) =>
    fromAbility(r, 'detachment', overrides, { ownerName: detachment!.name }),
  )

  return [...army.values(), ...detachmentReminders, ...units]
}

/** For the settings screen: every rule in a catalogue, grouped, each once. */
export function remindersForCatalogue(
  catalogue: ParsedCatalogue,
  overrides: Overrides,
): { group: string; reminders: Reminder[] }[] {
  const groups: { group: string; reminders: Reminder[] }[] = []
  const army = new Map<string, Reminder>()
  const perSheet: { group: string; reminders: Reminder[] }[] = []
  for (const sheet of catalogue.datasheets) {
    const own: Reminder[] = []
    for (const ability of sheet.abilities) {
      if (ability.kind === 'faction' || ability.kind === 'core') {
        if (!army.has(ability.id)) army.set(ability.id, fromAbility(ability, 'army', overrides))
      } else own.push(fromAbility(ability, 'unit', overrides, { ownerName: sheet.name }))
    }
    if (own.length > 0) perSheet.push({ group: sheet.name, reminders: own })
  }
  if (army.size > 0) groups.push({ group: 'Army rules', reminders: [...army.values()] })
  for (const d of catalogue.detachments) {
    const rules = (d.rules ?? []).map((r) => fromAbility(r, 'detachment', overrides, { ownerName: d.name }))
    if (rules.length > 0) groups.push({ group: `Detachment: ${d.name}`, reminders: rules })
  }
  const enhancements = (catalogue.enhancements ?? []).map((e) => fromAbility(e, 'unit', overrides))
  if (enhancements.length > 0) groups.push({ group: 'Enhancements', reminders: enhancements })
  return [...groups, ...perSheet]
}

/** Which triggers a phase raises, on your turn and on the opponent's. */
const MINE: Record<Phase, Trigger[]> = {
  command: ['command_phase', 'start_of_battle', 'once_per_battle', 'once_per_turn', 'custom'],
  movement: ['movement_phase', 'on_arrival_from_reserves'],
  shooting: ['shooting_phase'],
  charge: ['charge_phase'],
  fight: ['fight_phase', 'end_of_turn'],
}
const THEIRS: Record<Phase, Trigger[]> = {
  command: ['opponent_turn'],
  movement: ['opponent_turn'],
  shooting: ['opponent_turn', 'when_targeted'],
  charge: ['opponent_turn', 'when_charged'],
  fight: ['opponent_turn', 'when_targeted', 'fight_phase'],
}

/** Whether a reminder belongs in this phase of this turn (start-of-battle only in round 1). */
export function showsNow(reminder: Reminder, game: Pick<Game, 'round' | 'phase' | 'turn'>): boolean {
  if (!reminder.enabled) return false
  const table = game.turn === 'me' ? MINE : THEIRS
  if (!table[game.phase].includes(reminder.trigger)) return false
  if (reminder.trigger === 'start_of_battle') return game.round === 1
  return true
}

const ownerKey = (r: Reminder) => r.unitId ?? r.owner

/** The key a tick is stored under: once-per-battle locks for the game, everything else per turn. */
export const doneKey = (reminder: Reminder, game: Pick<Game, 'round' | 'turn'>): string =>
  reminder.once === 'battle'
    ? `battle:${ownerKey(reminder)}:${reminder.id}`
    : `${game.round}:${game.turn}:${ownerKey(reminder)}:${reminder.id}`

/** Ticked this turn — or, once per battle, used at any point (the datasheet's own checkbox counts). */
export function isDone(reminder: Reminder, game: Game, unit?: GameUnit): boolean {
  if (game.remindersDone?.[doneKey(reminder, game)]) return true
  return reminder.once === 'battle' && Boolean(unit?.usedOnce.includes(reminder.id))
}
