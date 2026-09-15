import { useMemo, useState } from 'react'
import type { ParsedCatalogue } from '@/data/model'
import type { GameAction } from '@/play/actions'
import { PHASE_LABELS, type Game } from '@/play/types'
import { doneKey, isDone, remindersForGame, showsNow } from '@/reminders/derive'
import { discoverMarks, grantedMarks, type Grant } from '@/play/marks'
import { DURATIONS } from '@/play/duration'
import { ruleAppliesTo } from '@/roster/detachmentRules'
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
  anchorId,
}: {
  game: Game
  catalogue: ParsedCatalogue
  overrides: Map<string, ReminderOverride>
  enabled: boolean
  onToggleEnabled: () => void
  dispatch: (action: GameAction) => void
  /** Id for the game screen's jump rail. */
  anchorId?: string
}) {
  const all = useMemo(() => remindersForGame(game, catalogue, overrides), [game.units, game.detachmentNames, catalogue, overrides])

  // A rule that puts a state on a unit gets a way to actually do it: the app
  // knows which states the data names and who each rule reaches.
  const marks = useMemo(() => discoverMarks(catalogue), [catalogue])
  const abilityText = useMemo(() => {
    const byId = new Map<string, string>()
    for (const sheet of catalogue.datasheets) for (const a of sheet.abilities) byId.set(a.id, a.text)
    for (const d of catalogue.detachments) for (const r of d.rules ?? []) byId.set(r.id, r.text)
    for (const r of catalogue.rules ?? []) byId.set(r.id, r.text)
    for (const e of catalogue.enhancements ?? []) byId.set(e.id, e.text)
    return byId
  }, [catalogue])
  const keywordsOf = useMemo(() => {
    const byEntry = new Map<string, string[]>()
    for (const sheet of catalogue.datasheets)
      byEntry.set(sheet.id, [...sheet.keywords, ...sheet.factionKeywords])
    return byEntry
  }, [catalogue])
  const grantsOf = (reminder: Reminder) =>
    marks.length === 0 ? [] : grantedMarks(abilityText.get(reminder.id) ?? '', marks)
  const now = all.filter((r) => showsNow(r, game))
  const groups = new Map<string, Reminder[]>()
  for (const r of now) {
    const key = r.owner === 'army' ? 'Army' : (r.ownerName ?? (r.owner === 'detachment' ? 'Detachment' : 'Unit'))
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const title = `${game.turn === 'me' ? PHASE_LABELS[game.phase] : `Opponent's ${PHASE_LABELS[game.phase]}`} phase`

  return (
    <section id={anchorId} className="reminders" aria-label="Reminders for this phase">
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
                    {grantsOf(r).map((grant) => (
                      <MarkGrant
                        key={grant.mark.key}
                        grant={grant}
                        game={game}
                        source={r.sourceName}
                        ruleText={abilityText.get(r.id) ?? ''}
                        keywordsOf={keywordsOf}
                        self={r.unitId}
                        dispatch={dispatch}
                      />
                    ))}
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


/**
 * The control that actually applies a state a rule grants. Which units a rule
 * reaches is read from its own keywords, so nothing here knows a faction.
 */
function MarkGrant({
  grant,
  game,
  source,
  ruleText,
  keywordsOf,
  self,
  dispatch,
}: {
  grant: Grant
  game: Game
  source: string
  ruleText: string
  keywordsOf: Map<string, string[]>
  self: string | undefined
  dispatch: (action: GameAction) => void
}) {
  const [chosen, setChosen] = useState('')
  // The rule's own wording wins; where it says nothing, the player's choice.
  const [lasts, setLasts] = useState('')
  const until = grant.until ?? (lasts || undefined)
  const reaches = (unit: (typeof game.units)[number]) =>
    ruleAppliesTo(ruleText, keywordsOf.get(unit.entryId) ?? []) !== false
  const candidates = game.units.filter((u) => !u.destroyed && reaches(u))
  const already = (id: string) => game.units.find((u) => u.id === id)?.marks?.includes(grant.mark.key)

  if (grant.scope === 'army') {
    const targets = candidates.filter((u) => !already(u.id)).map((u) => u.id)
    const held = candidates.filter((u) => already(u.id)).map((u) => u.id)
    return (
      <div className="reminders__grant">
        <button
          className="button button--quiet"
          disabled={targets.length === 0}
          onClick={() =>
            dispatch({
              type: 'applyMark',
              unitIds: targets,
              mark: grant.mark.key,
              label: grant.mark.label,
              source,
              ...(until ? { until } : {}),
            })
          }
        >
          {targets.length === 0
            ? `Every unit is already ${grant.mark.label}`
            : `Make all ${targets.length} ${grant.mark.label}`}
        </button>
        {/* A state applied to the whole army has to come off the whole army
            too: a rule can end early, or the tap can simply have been a
            mistake, and taking it off unit by unit is twenty taps. */}
        {held.length > 0 && (
          <button
            className="button button--quiet"
            onClick={() =>
              dispatch({ type: 'removeMark', unitIds: held, mark: grant.mark.key, label: grant.mark.label })
            }
          >
            No longer {grant.mark.label} ({held.length})
          </button>
        )}
        <Lasts grant={grant} value={lasts} onChange={setLasts} />
      </div>
    )
  }

  // "This unit is …" needs no picker when the reminder already belongs to one.
  if (grant.scope === 'self' && self) {
    const on = already(self)
    return (
      <div className="reminders__grant">
        <button
          className="button button--quiet"
          onClick={() =>
            dispatch({
              type: 'toggleMark',
              unitId: self,
              mark: grant.mark.key,
              label: grant.mark.label,
              ...(until ? { until } : {}),
            })
          }
        >
          {on ? `No longer ${grant.mark.label}` : `Now ${grant.mark.label}`}
        </button>
        <Lasts grant={grant} value={lasts} onChange={setLasts} />
      </div>
    )
  }

  const held = candidates.filter((u) => already(u.id)).map((u) => u.id)
  return (
    <div className="reminders__grant">
      <label className="reminders__pick">
        <span className="muted">Make {grant.mark.label}:</span>
        <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">— choose a unit —</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {already(u.id) ? ` (already ${grant.mark.label})` : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button button--quiet"
        disabled={!chosen || Boolean(already(chosen))}
        onClick={() => {
          dispatch({
            type: 'applyMark',
            unitIds: [chosen],
            mark: grant.mark.key,
            label: grant.mark.label,
            source,
            ...(until ? { until } : {}),
          })
          setChosen('')
        }}
      >
        Apply
      </button>
      {held.length > 0 && (
        <button
          className="button button--quiet"
          onClick={() =>
            dispatch({ type: 'removeMark', unitIds: held, mark: grant.mark.key, label: grant.mark.label })
          }
        >
          No longer {grant.mark.label} ({held.length})
        </button>
      )}
      <Lasts grant={grant} value={lasts} onChange={setLasts} />
    </div>
  )
}

/**
 * How long it lasts: the rule's words when it gives them, the player's pick
 * when it does not. Either way the state comes off by itself at that moment.
 */
function Lasts({
  grant,
  value,
  onChange,
}: {
  grant: Grant
  value: string
  onChange: (value: string) => void
}) {
  if (grant.until) return <span className="muted reminders__until">{grant.until}</span>
  return (
    <label className="reminders__lasts">
      <span className="muted">lasts</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {DURATIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
