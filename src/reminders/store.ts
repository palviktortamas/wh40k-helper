/**
 * Reminder overrides and the master switch (spec §6.4). Overrides are keyed by
 * the rule's stable BSData id, so they survive data updates and apply to every
 * roster and game that uses the rule.
 */

import { db, getSetting, setSetting } from '@/data/db'
import type { Reminder, ReminderOverride, Trigger } from './types'

export const REMINDERS_ENABLED_KEY = 'reminders.enabled'

export const getRemindersEnabled = (): Promise<boolean> => getSetting<boolean>(REMINDERS_ENABLED_KEY, true)

export const setRemindersEnabled = (enabled: boolean): Promise<void> => setSetting(REMINDERS_ENABLED_KEY, enabled)

export async function getOverrides(): Promise<Map<string, ReminderOverride>> {
  const rows = await db.reminderOverrides.toArray()
  return new Map(rows.map((r) => [r.id, r]))
}

/** Merges a change into the override for one rule; a change back to the default is still recorded. */
export async function saveOverride(
  id: string,
  change: { enabled?: boolean; trigger?: Trigger; text?: string },
): Promise<ReminderOverride> {
  const current = await db.reminderOverrides.get(id)
  const next: ReminderOverride = { ...current, ...change, id, updatedAt: Date.now() }
  await db.reminderOverrides.put(next)
  return next
}

export const clearOverride = (id: string): Promise<void> => db.reminderOverrides.delete(id)

/** Applies an override to a reminder built from the defaults. */
export function withOverride(reminder: Reminder, override: ReminderOverride | undefined): Reminder {
  if (!override) return reminder
  return {
    ...reminder,
    ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
    ...(override.trigger !== undefined ? { trigger: override.trigger } : {}),
    ...(override.text !== undefined && override.text.trim() ? { text: override.text.trim() } : {}),
  }
}
