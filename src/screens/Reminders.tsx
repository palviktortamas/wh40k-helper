import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, type CatalogueRecord } from '@/data/db'
import { remindersForCatalogue } from '@/reminders/derive'
import {
  clearOverride,
  getOverrides,
  getRemindersEnabled,
  saveOverride,
  setRemindersEnabled,
} from '@/reminders/store'
import { TRIGGERS, TRIGGER_LABELS, type Reminder, type ReminderOverride, type Trigger } from '@/reminders/types'
import './Rosters.css'
import './Reminders.css'

/**
 * Settings → Reminders (spec §6.4): every rule in an installed faction with the
 * trigger and text the heuristics guessed, each one switchable, re-timed and
 * re-worded. Overrides are keyed by the rule's id, so they outlive data updates.
 */
export function Reminders() {
  const [catalogues, setCatalogues] = useState<CatalogueRecord[] | null>(null)
  const [catalogueId, setCatalogueId] = useState<string>('')
  const [overrides, setOverrides] = useState<Map<string, ReminderOverride>>(new Map())
  const [enabled, setEnabled] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void db.catalogues.toArray().then((rows) => {
      setCatalogues(rows)
      setCatalogueId((id) => id || rows[0]?.id || '')
    })
    void getOverrides().then(setOverrides)
    void getRemindersEnabled().then(setEnabled)
  }, [])

  const catalogue = catalogues?.find((c) => c.id === catalogueId)
  const groups = useMemo(
    () => (catalogue ? remindersForCatalogue(catalogue.parsed, overrides) : []),
    [catalogue, overrides],
  )
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? groups
        .map((g) => ({
          group: g.group,
          reminders: g.reminders.filter(
            (r) => g.group.toLowerCase().includes(needle) || r.sourceName.toLowerCase().includes(needle) || r.text.toLowerCase().includes(needle),
          ),
        }))
        .filter((g) => g.reminders.length > 0)
    : groups

  const change = async (id: string, patch: { enabled?: boolean; trigger?: Trigger; text?: string }) => {
    const next = await saveOverride(id, patch)
    setOverrides((m) => new Map(m).set(id, next))
  }
  const reset = async (id: string) => {
    await clearOverride(id)
    setOverrides((m) => {
      const next = new Map(m)
      next.delete(id)
      return next
    })
  }

  if (catalogues === null) return <p>Loading…</p>

  return (
    <section className="rosters remindersSettings">
      <Link className="sheet__back tap" to="/settings">
        ‹ Settings
      </Link>
      <h2>Reminders</h2>
      <p className="muted">
        What the app nudges you about during a game, and when. The defaults are guessed from the rules text;
        change any of them here. Passive rules start switched off.
      </p>
      <label className="remindersSettings__master">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked)
            void setRemindersEnabled(e.target.checked)
          }}
        />
        Show reminders during games
      </label>

      {catalogues.length === 0 ? (
        <p>
          No faction installed yet — do that under <Link to="/data">Data</Link>.
        </p>
      ) : (
        <>
          <div className="remindersSettings__controls">
            {catalogues.length > 1 && (
              <select value={catalogueId} onChange={(e) => setCatalogueId(e.target.value)} aria-label="Faction">
                {catalogues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parsed.name}
                  </option>
                ))}
              </select>
            )}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search units, rules, text"
              aria-label="Search reminders"
            />
          </div>
          {shown.length === 0 && <p className="muted">Nothing matches.</p>}
          {shown.map((g) => (
            <details key={g.group} open={Boolean(needle) || g.reminders.length <= 3 && g.group.startsWith('Army')}>
              <summary>
                {g.group}
                <span className="muted">
                  {g.reminders.filter((r) => r.enabled).length}/{g.reminders.length} on
                </span>
              </summary>
              {g.reminders.map((r) => (
                <ReminderRow
                  key={r.id}
                  reminder={r}
                  overridden={overrides.has(r.id)}
                  onChange={(patch) => void change(r.id, patch)}
                  onReset={() => void reset(r.id)}
                />
              ))}
            </details>
          ))}
        </>
      )}
    </section>
  )
}

function ReminderRow({
  reminder,
  overridden,
  onChange,
  onReset,
}: {
  reminder: Reminder
  overridden: boolean
  onChange: (patch: { enabled?: boolean; trigger?: Trigger; text?: string }) => void
  onReset: () => void
}) {
  const [text, setText] = useState(reminder.text)
  useEffect(() => setText(reminder.text), [reminder.text])
  return (
    <div className={`reminderRow ${reminder.enabled ? '' : 'reminderRow--off'}`}>
      <input
        type="checkbox"
        checked={reminder.enabled}
        aria-label={`${reminder.sourceName}: remind me`}
        onChange={(e) => onChange({ enabled: e.target.checked })}
      />
      <span className="reminderRow__name">
        {reminder.sourceName}
        {reminder.once === 'battle' && <span className="chip"> once per battle</span>}
        {overridden && <span className="chip"> edited</span>}
      </span>
      <div className="reminderRow__fields">
        <select
          value={reminder.trigger}
          aria-label={`${reminder.sourceName}: when`}
          onChange={(e) => onChange({ trigger: e.target.value as Trigger })}
        >
          {TRIGGERS.map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={text}
          aria-label={`${reminder.sourceName}: reminder text`}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text.trim() && text.trim() !== reminder.text) onChange({ text: text.trim() })
          }}
        />
        {overridden && (
          <button type="button" className="button button--quiet reminderRow__reset" onClick={onReset}>
            Reset to default
          </button>
        )}
      </div>
    </div>
  )
}
