import { useMemo } from 'react'
import type { ParsedCatalogue } from '@/data/model'
import type { GameAction } from '@/play/actions'
import { PHASE_LABELS, type Game } from '@/play/types'
import { doneKey, isDone, remindersForGame, showsNow } from '@/reminders/derive'
import type { Reminder, ReminderOverride } from '@/reminders/types'
import './Reminders.css'

/**
 * "Reminders for this phase" (spec §6.4): the enabled reminders whose trigger
 * matches the current phase and turn, grouped by owner, each a checkbox. A
 * once-per-battle reminder locks for the rest of the game and is the same
 * fact as the datasheet's "used" checkbox. Glanceable, never modal.
 */
export function GameReminders({
  game,
  catalogue,
  overrides,
  enabled,
  onToggleEnabled,
  dispatch,
}: {
  game: Game
  catalogue: ParsedCatalogue
  overrides: Map<string, ReminderOverride>
  enabled: boolean
  onToggleEnabled: () => void
  dispatch: (action: GameAction) => void
}) {
  const all = useMemo(() => remindersForGame(game, catalogue, overrides), [game.units, game.detachmentName, catalogue, overrides])
  const now = all.filter((r) => showsNow(r, game))
  const groups = new Map<string, Reminder[]>()
  for (const r of now) {
    const key = r.owner === 'army' ? 'Army' : (r.ownerName ?? (r.owner === 'detachment' ? 'Detachment' : 'Unit'))
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const title = `${game.turn === 'me' ? PHASE_LABELS[game.phase] : `Opponent's ${PHASE_LABELS[game.phase]}`} phase`

  return (
    <section className="reminders" aria-label="Reminders for this phase">
      <div className="reminders__head">
        <h3 className="play__heading">
          Reminders <span className="muted">— {title}</span>
        </h3>
        <button className="button button--quiet reminders__mute" onClick={onToggleEnabled} aria-pressed={!enabled}>
          {enabled ? 'Silence' : 'Unmute'}
        </button>
      </div>
      {!enabled ? (
        <p className="muted reminders__empty">Reminders are silenced for this device.</p>
      ) : now.length === 0 ? (
        <p className="muted reminders__empty">Nothing to remember this phase.</p>
      ) : (
        [...groups.entries()].map(([owner, list]) => (
          <div key={owner} className="reminders__group">
            <strong className="reminders__owner">{owner}</strong>
            <ul>
              {list.map((r) => {
                const unit = r.unitId ? game.units.find((u) => u.id === r.unitId) : undefined
                const done = isDone(r, game, unit)
                const key = doneKey(r, game)
                return (
                  <li key={`${r.unitId ?? r.owner}:${r.id}`}>
                    <label className={`reminders__item ${done ? 'reminders__item--done' : ''}`}>
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() =>
                          dispatch({
                            type: 'checkReminder',
                            key,
                            label: r.sourceName,
                            ...(r.unitId ? { unitId: r.unitId, abilityId: r.id } : {}),
                            ...(r.once ? { once: r.once } : {}),
                          })
                        }
                      />
                      <span className="reminders__body">
                        <span className="reminders__name">
                          {r.sourceName}
                          {r.once === 'battle' && <span className="chip">{done ? 'used' : 'once per battle'}</span>}
                          {r.once === 'turn' && <span className="chip">once per turn</span>}
                          {r.trigger === 'on_arrival_from_reserves' && unit && !unit.statuses.some((s) => s === 'reserves' || s === 'deepStrike') && (
                            <span className="chip muted">on the table</span>
                          )}
                        </span>
                        {r.text && r.text !== r.sourceName && <span className="reminders__text">{r.text}</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
