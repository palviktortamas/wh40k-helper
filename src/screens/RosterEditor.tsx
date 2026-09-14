import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import { getSetting, setSetting } from '@/data/db'
import type { Datasheet, Detachment, ParsedCatalogue } from '@/data/model'
import { instantiate } from '@/roster/defaults'
import {
  availableDetachmentOptions,
  getRoster,
  graphFor,
  isToggle,
  moveSelection,
  normaliseRoster,
  removeUnit,
  replaceSelection,
  saveRoster,
  validate,
  withBattleSize,
  withDetachmentToggled,
  withToggle,
  withWarlord,
  type Validation,
} from '@/roster/store'
import { exportRosterText } from '@/roster/export'
import { unitNames } from '@/roster/naming'
import { detachmentEnhancements, detachmentStratagems } from '@/roster/detachmentInfo'
import { getStratagemSet } from '@/stratagems/store'
import type { StratagemSet } from '@/stratagems/types'
import { attachmentKind, attachmentsOf, capacityOf, heldOfKind, kindOfAssociation } from '@/roster/attachment'
import { POINTS_PRESETS, walkSelections, type Roster, type Selection } from '@/roster/types'
import type { CatalogueGraph, ResolvedEntry } from '@/roster/resolve'
import { groupByRole, roleKey, roleOf } from '@/roster/roles'
import { WARLORD_CATEGORY } from '@/roster/vocabulary'
import { COST_TYPE } from '@/data/bsdata/schema'
import { OptionTree, UnitEditor, rulesAboutUnit, type AttachedUnit } from './UnitEditor'
import { effectsFrom } from '@/play/effects'
import type { StatMod } from '@/play/mods'
import { scrollToTop } from './scrollToTop'
import { StatStrip } from './StatStrip'
import { Marked } from './Marked'
import { shortText } from '@/reminders/heuristics'
import './Rosters.css'
import './Units.css'

/**
 * Which way the unit list is arranged; remembered per device (IndexedDB settings).
 * `role`: grouped by battlefield role with full cards; `compact`: grouped, one line per unit —
 * for a 2000-point army on a phone; `order`: the flat list in the owner's order with arrows.
 */
type UnitsView = 'role' | 'compact' | 'order'
const VIEW_KEY = 'rosters.unitsView'

export function RosterEditor() {
  const { rosterId } = useParams<{ rosterId: string }>()
  const [roster, setRoster] = useState<Roster | null>(null)
  const [catalogue, setCatalogue] = useState<CatalogueRecord | null>(null)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<UnitsView>('role')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** Imported stratagems, so a detachment can show what it actually grants. */
  const [stratagems, setStratagems] = useState<StratagemSet | null>(null)

  useEffect(() => {
    if (!rosterId) return
    void getRoster(rosterId).then(async (r) => {
      if (!r) {
        setRoster(null)
        return
      }
      const record = (await getCatalogue(r.catalogueId)) ?? null
      setCatalogue(record)
      // Bring older rosters up to the current shape before anything reads them.
      const normalised = record ? normaliseRoster(r, graphFor(record)) : r
      if (normalised !== r) void saveRoster(normalised)
      setRoster(normalised)
    })
    void getSetting<UnitsView>(VIEW_KEY, 'role').then(setView)
    void getStratagemSet().then((set) => setStratagems(set ?? null))
  }, [rosterId])

  // Opening the unit editor or the picker should land at the top, not wherever
  // the list behind them was scrolled to.
  useEffect(() => {
    scrollToTop(document.querySelector('.rosters'))
  }, [editing, picking])

  const changeView = (next: UnitsView) => {
    setView(next)
    void setSetting(VIEW_KEY, next)
  }

  const graph = useMemo(() => (catalogue ? graphFor(catalogue) : null), [catalogue])
  const sheets = useMemo(
    () => new Map<string, Datasheet>((catalogue?.parsed.datasheets ?? []).map((d) => [d.id, d])),
    [catalogue],
  )

  const update = useCallback((next: Roster) => {
    setRoster(next)
    // Autosave on every change (spec §7, data safety).
    void saveRoster(next)
  }, [])

  const validation: Validation | null = useMemo(
    () => (roster && graph ? validate(roster, graph) : null),
    [roster, graph],
  )

  if (!roster || !catalogue || !graph || !validation) return <p>Loading…</p>

  const detachments = availableDetachmentOptions(roster, graph, validation)
  const detachmentConfigIds = new Set(detachments.map((d) => d.configEntryId))
  const chosenEntryIds = new Set(validation.detachments.map((d) => d.entryId))
  /** The parsed records behind the chosen entries, for their rules and dispositions. */
  const chosen: Detachment[] = validation.detachments.flatMap(
    (d) => catalogue.parsed.detachments.find((p) => p.name === d.name) ?? [],
  )
  const dpLimit = validation.detachmentPointsLimit
  const dpLeft = dpLimit === undefined ? undefined : dpLimit - validation.detachmentPoints
  const dispositions = [...new Set(chosen.flatMap((d) => d.forceDispositions))]

  // Adding does not close the picker: a list usually wants three of something,
  // and reopening between each was the whole complaint. The owner closes it.
  /** How many of each datasheet the roster holds — the picker's running count. */
  const picked = new Map<string, number>()
  for (const unit of roster.selections) picked.set(unit.entryId, (picked.get(unit.entryId) ?? 0) + 1)

  const addUnit = (entry: ResolvedEntry) => {
    update({ ...roster, selections: [...roster.selections, instantiate(entry)] })
  }

  const editingSelection = editing ? roster.selections.find((s) => s.id === editing) : undefined

  if (editingSelection) {
    /**
     * The editor asks before every increment: would this push a `max` in the
     * data over? Compared on the count of "at most" errors inside this unit, so
     * an unrelated existing error never blocks a legal change (spec §5.2).
     */
    const capErrors = (v: Validation, unit: Selection) =>
      v.issues.filter(
        (i) =>
          i.severity === 'error' &&
          i.rule.startsWith('BattleScribe constraint') &&
          /at most/i.test(i.message) &&
          belongsTo(i.selectionId, unit),
      ).length
    const tryChange = (nextUnit: Selection): string | undefined => {
      const next = { ...roster, selections: replaceSelection(roster.selections, nextUnit.id, nextUnit) }
      return capErrors(validate(next, graph), nextUnit) > capErrors(validation, editingSelection)
        ? 'At the limit the data allows for this option.'
        : undefined
    }
    return (
      <UnitEditor
        selection={editingSelection}
        graph={graph}
        validation={validation}
        sheet={sheets.get(editingSelection.entryId)}
        displayName={unitNames(roster).get(editingSelection.id) ?? editingSelection.name}
        attached={attachedTo(roster, graph, catalogue.parsed, sheets, validation, editingSelection.id)}
        detachments={chosen}
        catalogue={catalogue.parsed}
        role={roleOf(graph, editingSelection.entryId)}
        onBack={() => setEditing(null)}
        onChange={(next) =>
          update({ ...roster, selections: replaceSelection(roster.selections, editing!, next) })
        }
        tryChange={tryChange}
      />
    )
  }

  if (picking) {
    return (
      <UnitPicker
        graph={graph}
        validation={validation}
        sheets={sheets}
        onPick={addUnit}
        onDone={() => setPicking(false)}
        counts={picked}
        total={roster.selections.length}
        catalogueName={catalogue.name}
      />
    )
  }

  const unitById = new Map(roster.selections.map((u) => [u.id, u]))
  // Copies of one datasheet are told apart by number; the owner may rename any.
  const names = unitNames(roster)
  const enhancementIds = new Set((catalogue.parsed.enhancements ?? []).map((e) => e.id))
  const errorCount = validation.errors.length
  const warningCount = validation.warnings.length
  const over = validation.points > roster.pointsLimit
  const ratio = Math.min(1, validation.points / Math.max(1, roster.pointsLimit))

  // The card shows the stat line the unit actually has: an enhancement's save,
  // a detachment's +1, the same numbers the editor and the table show.
  const modsOf = (unit: Selection): StatMod[] => {
    const sheet = sheets.get(unit.entryId)
    return sheet ? effectsFrom(rulesAboutUnit(sheet, unit, chosen, catalogue.parsed)).mods : []
  }

  const cardFor = (unit: Selection, index: number, nested = false) => (
    <UnitCard
      key={unit.id}
      unit={unit}
      index={index}
      total={roster.selections.length}
      roster={roster}
      graph={graph}
      validation={validation}
      sheet={sheets.get(unit.entryId)}
      role={roleOf(graph, unit.entryId)}
      unitById={unitById}
      names={names}
      enhancementIds={enhancementIds}
      mods={modsOf(unit)}
      showArrows={view === 'order'}
      compact={view === 'compact'}
      nested={nested}
      leaders={view !== 'order' ? roster.selections.filter((l) => l.attachedTo === unit.id) : []}
      renderLeader={(leader) => cardFor(leader, roster.selections.indexOf(leader), true)}
      onEdit={() => setEditing(unit.id)}
      update={update}
    />
  )

  // By role: attached leaders ride inside the unit they lead, as at the table,
  // and count towards that group's points.
  const groups =
    view === 'order'
      ? []
      : groupByRole(
          roster.selections.filter((u) => !(u.attachedTo && unitById.has(u.attachedTo))),
          (u) => roleOf(graph, u.entryId),
        )
  const groupPoints = (units: Selection[]) =>
    units.reduce(
      (sum, unit) =>
        sum +
        (validation.unitPoints[unit.id] ?? 0) +
        roster.selections
          .filter((l) => l.attachedTo === unit.id)
          .reduce((s, l) => s + (validation.unitPoints[l.id] ?? 0), 0),
      0,
    )

  return (
    <section className="rosters editor">
      <Link className="sheet__back tap" to="/rosters">
        ‹ Rosters
      </Link>

      <input
        className="rosters__title"
        value={roster.name}
        onChange={(e) => update({ ...roster, name: e.target.value })}
        aria-label="Roster name"
      />

      {/* What is pinned is only what you glance at while editing: legality,
          points, the meter. Everything else about the army scrolls with the
          page — a widget that changes height while stuck fights the scroll. */}
      <div className={`summary ${over ? 'summary--over' : ''}`}>
        <div className="summary__row">
          <span className={`badge ${validation.legal ? 'badge--ok' : 'badge--error'}`}>
            {validation.legal ? '✓ Legal' : `✕ ${errorCount} error${errorCount === 1 ? '' : 's'}`}
          </span>
          <span className="summary__points">
            <strong>{validation.points}</strong>
            <span className="muted"> / {roster.pointsLimit} pts</span>
          </span>
          <span className="summary__facts muted">
            {roster.selections.length} unit{roster.selections.length === 1 ? '' : 's'}
            {validation.detachmentPoints > 0 ? ` · ${validation.detachmentPoints} DP` : ''}
            {validation.enhancements > 0
              ? ` · ${validation.enhancements} enhancement${validation.enhancements === 1 ? '' : 's'}`
              : ''}
          </span>
        </div>
        <div className={`meter ${over ? 'meter--over' : ''}`} aria-hidden="true">
          <div className="meter__fill" style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>

      <p className="summary__detachment muted">
        {catalogue.name}
        {chosen.length > 0 ? ` · ${chosen.map((d) => d.name).join(' + ')}` : ' · no detachment chosen'}
        {dispositions.length > 0 ? ` · ${dispositions.join(' / ')}` : ''}
      </p>
      {groups.length > 1 && (
        <nav className="summary__jump" aria-label="Jump to a unit group">
          {groups.map((g) => (
            <a key={g.id} href={`#${g.id}`} className={`summary__jumpLink role--${g.key}`}>
              <span className="role-tag">{g.heading}</span>
              <span className="muted">{g.items.length}</span>
            </a>
          ))}
        </nav>
      )}

      <div className="rosters__controls">
        <label>
          Limit
          <select
            value={roster.pointsLimit}
            onChange={(e) =>
              update(withBattleSize({ ...roster, pointsLimit: Number(e.target.value) }, graph))
            }
          >
            {POINTS_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Twelve detachments is a long list to scroll past once the choice is
          made, so it folds away and the summary carries the answer. */}
      <details className="config detachments" open={chosen.length === 0}>
        <summary>
          <span className="detachments__title">Detachments</span>
          <span className="detachments__summary muted">
            {chosen.length > 0 ? chosen.map((d) => d.name).join(' + ') : 'none chosen'}
          </span>
          <span
            className={`detachments__budget ${dpLeft !== undefined && dpLeft < 0 ? 'detachments__budget--over' : ''}`}
          >
            {validation.detachmentPoints}
            {dpLimit === undefined ? '' : ` / ${dpLimit}`} DP
          </span>
        </summary>
        <ul className="detachments__list">
          {detachments.map((option) => {
            const cost = option.entry.costs[COST_TYPE.detachmentPoints] ?? 0
            const on = chosenEntryIds.has(option.entry.id)
            // Over budget is not an error to discover after the fact: an option
            // that cannot be afforded is shown, disabled, with the reason.
            const unaffordable = !on && dpLeft !== undefined && cost > dpLeft
            return (
              <li key={option.entry.linkId ?? option.entry.id}>
                <label className={`toggle ${unaffordable ? 'toggle--blocked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={unaffordable}
                    onChange={(e) =>
                      update(withDetachmentToggled(roster, graph, option.entry.id, e.target.checked))
                    }
                  />
                  <span className="toggle__name">{option.entry.name}</span>
                  <span className="muted detachments__cost">{cost} DP</span>
                  {unaffordable && <span className="muted detachments__blocked">over budget</span>}
                </label>
              </li>
            )
          })}
        </ul>
        {detachments.length === 0 && (
          <p className="muted">This catalogue offers no detachments the army can take.</p>
        )}
      </details>

      {chosen.map((d) => {
        const rules = d.rules ?? []
        const enhancements = detachmentEnhancements(d, catalogue.parsed)
        const strats = detachmentStratagems(d, stratagems?.stratagems)
        if (rules.length + enhancements.length + strats.length === 0) return null
        return (
          <details className="config detachment" key={d.name}>
            <summary>
              {d.name} <span className="muted">— what it gives you</span>
            </summary>

            {rules.length > 0 && (
              <>
                <h3 className="detachment__head">
                  Rule{rules.length === 1 ? '' : 's'}
                </h3>
                <ul className="abilities">
                  {rules.map((rule) => (
                    <li key={rule.id} className="abilities__item">
                      <div className="abilities__head">
                        {rule.name}
                        <span className="rule-chip rule-chip--detachment">{d.name}</span>
                      </div>
                      <p className="abilities__text">
                        <Marked text={rule.text} />
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="muted detachment__hint">
                  Units this rule names show it on their datasheet in the editor and at the table.
                </p>
              </>
            )}

            {enhancements.length > 0 && (
              <>
                <h3 className="detachment__head">Enhancements ({enhancements.length})</h3>
                <ul className="abilities">
                  {enhancements.map((e) => (
                    <li key={e.id ?? e.name} className="abilities__item">
                      <div className="abilities__head">
                        {e.name}
                        {e.points !== undefined && <span className="muted"> {e.points} pts</span>}
                        <span className="rule-chip rule-chip--enhancement">Enhancement</span>
                      </div>
                      {e.text ? (
                        <p className="abilities__text">
                          <Marked text={e.text} />
                        </p>
                      ) : (
                        <p className="muted abilities__text">
                          No rules text in the installed data.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="muted detachment__hint">
                  Take one on a Character in its own editor; the army may hold two in all.
                </p>
              </>
            )}

            {strats.length > 0 ? (
              <>
                <h3 className="detachment__head">Stratagems ({strats.length})</h3>
                <ul className="abilities">
                  {strats.map((s) => (
                    <li key={s.id} className="abilities__item">
                      <div className="abilities__head">
                        {s.name}
                        <span className="rule-chip rule-chip--detachment">{s.cp} CP</span>
                      </div>
                      <p className="muted detachment__when">
                        {s.turn} · {s.phase}
                        {s.category ? ` · ${s.category}` : ''}
                      </p>
                      {/* Which units it can be used on is the thing you check
                          when building a list, so it is spelled out here. */}
                      {s.target && (
                        <p className="abilities__text">
                          <span className="muted">Target: </span>
                          <Marked text={s.target} />
                        </p>
                      )}
                      {s.when && (
                        <p className="abilities__text">
                          <span className="muted">When: </span>
                          <Marked text={s.when} />
                        </p>
                      )}
                      {s.effect && (
                        <p className="abilities__text">
                          <span className="muted">Effect: </span>
                          <Marked text={s.effect} />
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              stratagems === null && (
                <p className="muted detachment__hint">
                  Stratagems are not imported yet — load them on the Data screen to see this
                  detachment's.
                </p>
              )
            )}
          </details>
        )
      })}

      <details className="config">
        <summary>Army configuration</summary>
        <p className="muted">
          The battle size follows the points limit. Everything else here is the data's own roster
          setup, including the Force Disposition Play Mode needs.
        </p>
        <ul className="toggles">
          {graph.configurationEntryIds
            .map((id) => graph.resolve(id))
            .filter((e): e is ResolvedEntry => Boolean(e) && isToggle(e!))
            .filter(
              (e) =>
                roster.configuration.some((s) => s.entryId === e.id) ||
                validation.isEntryAvailable(undefined, e),
            )
            .map((e) => {
              const on = roster.configuration.some((s) => s.entryId === e.id)
              return (
                <li key={e.id}>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(ev) => update(withToggle(roster, graph, e.id, ev.target.checked))}
                    />
                    {e.name}
                  </label>
                </li>
              )
            })}
        </ul>
        {roster.configuration
          .filter((config) => !detachmentConfigIds.has(config.entryId))
          .filter((config) => {
            const entry = graph.resolve(config.entryId)
            return entry && !isToggle(entry)
          })
          .map((config) => {
            const entry = graph.resolve(config.entryId)
            if (!entry) return null
            return (
              <div key={config.id} className="config__entry">
                <h3>{config.name}</h3>
                <OptionTree
                  parent={config}
                  entry={entry}
                  root={config}
                  rootOnChange={(next) =>
                    update({
                      ...roster,
                      configuration: replaceSelection(roster.configuration, config.id, next),
                    })
                  }
                  validation={validation}
                />
              </div>
            )
          })}
      </details>

      {validation.issues.length > 0 && (
        <details className="config issues__wrap" open={errorCount > 0}>
          <summary>
            {errorCount > 0 ? `✕ ${errorCount} error${errorCount === 1 ? '' : 's'}` : ''}
            {errorCount > 0 && warningCount > 0 ? ' · ' : ''}
            {warningCount > 0 ? `⚠ ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}
          </summary>
          <ul className="issues">
            {validation.issues.map((issue, index) => (
              <li key={index} className={`issues__item issues__item--${issue.severity}`}>
                <span className="issues__mark">{issue.severity === 'error' ? '✕' : '⚠'}</span>
                <span>
                  {issue.message}
                  <span className="issues__rule">{issue.rule}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="rosters__controls editor__toolbar">
        <button className="button" onClick={() => setPicking(true)}>
          + Add unit
        </button>
        <button
          className="button button--quiet"
          onClick={async () => {
            const text = exportRosterText(roster, graph, validation, catalogue.name)
            try {
              await navigator.clipboard.writeText(text)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch {
              // Clipboard is blocked in some mobile contexts; showing the text
              // is more useful than an error the user cannot act on.
              alert(text)
            }
          }}
        >
          {copied ? 'Copied' : 'Export text'}
        </button>
        <div className="segmented" role="group" aria-label="Arrange units">
          <button className={view === 'role' ? 'segmented--on' : ''} aria-pressed={view === 'role'} onClick={() => changeView('role')}>
            Cards
          </button>
          <button className={view === 'compact' ? 'segmented--on' : ''} aria-pressed={view === 'compact'} onClick={() => changeView('compact')}>
            Compact
          </button>
          <button className={view === 'order' ? 'segmented--on' : ''} aria-pressed={view === 'order'} onClick={() => changeView('order')}>
            My order
          </button>
        </div>
      </div>

      {roster.selections.length === 0 ? (
        <p className="muted">No units yet.</p>
      ) : view === 'order' ? (
        <ul className="units">{roster.selections.map((unit, index) => cardFor(unit, index))}</ul>
      ) : (
        groups.map((group) => {
          const open = !collapsed.has(group.id)
          return (
            <section key={group.id} id={group.id} className={`unitgroup role--${group.key}`}>
              {/* The heading folds the group: a 2000-point army is read one role at a time. */}
              <button
                className="unitgroup__head unitgroup__head--button"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((c) => {
                    const next = new Set(c)
                    if (next.has(group.id)) next.delete(group.id)
                    else next.add(group.id)
                    return next
                  })
                }
              >
                <h3>
                  <span className="unitgroup__chevron" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>{' '}
                  {group.heading}
                </h3>
                <span className="unitgroup__sum">
                  {group.items.length} · {groupPoints(group.items)} pts
                </span>
              </button>
              {open && (
                <ul className={`units ${view === 'compact' ? 'units--compact' : ''}`}>
                  {group.items.map((unit) => cardFor(unit, roster.selections.indexOf(unit)))}
                </ul>
              )}
            </section>
          )
        })
      )}
    </section>
  )
}

/** True when an issue's selection lies anywhere inside this unit. */
function belongsTo(selectionId: string | undefined, unit: Selection): boolean {
  if (!selectionId) return false
  if (unit.id === selectionId) return true
  return unit.selections.some((child) => belongsTo(selectionId, child))
}

/** "9× Boy · 2× Boy w/ Rokkit launcha" — the roll-up the spec asks for. Counts are per copy of the parent. */
export function describeLoadout(unit: Selection): string {
  const counts = new Map<string, number>()
  const walk = (node: Selection, multiplier: number) => {
    for (const child of node.selections) {
      const total = child.count * multiplier
      if (child.type === 'model') counts.set(child.name, (counts.get(child.name) ?? 0) + total)
      walk(child, total)
    }
  }
  walk(unit, 1)
  if (counts.size === 0) {
    // A single-model datasheet: show its wargear instead (the Warlord pick is a data upgrade, not gear).
    const gear = unit.selections
      .filter((s) => s.type === 'upgrade' && s.name !== WARLORD_CATEGORY)
      .map((s) => s.name)
    return gear.length > 0 ? gear.join(' · ') : unit.type === 'model' ? 'Single model' : 'No models'
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count}× ${name}`)
    .join(' · ')
}

/** Names of the enhancements taken anywhere under a unit. */
export function enhancementsTaken(unit: Selection, enhancementIds: Set<string>): string[] {
  const names: string[] = []
  for (const node of walkSelections(unit.selections))
    if (node.type === 'upgrade' && enhancementIds.has(node.entryId)) names.push(node.name)
  return names
}

function UnitCard({
  unit,
  index,
  total,
  roster,
  graph,
  validation,
  sheet,
  role,
  unitById,
  names,
  enhancementIds,
  mods,
  showArrows,
  compact,
  nested,
  leaders,
  renderLeader,
  onEdit,
  update,
}: {
  unit: Selection
  index: number
  total: number
  roster: Roster
  graph: CatalogueGraph
  validation: Validation
  sheet: Datasheet | undefined
  role: string | undefined
  unitById: Map<string, Selection>
  /** Display name per unit id (see roster/naming.ts). */
  names: Map<string, string>
  enhancementIds: Set<string>
  /** Characteristics the army's rules change on this unit (see play/mods.ts). */
  mods: StatMod[]
  showArrows: boolean
  compact: boolean
  nested: boolean
  leaders: Selection[]
  renderLeader: (leader: Selection) => React.ReactNode
  onEdit: () => void
  update: (next: Roster) => void
}) {
  const unitIssues = validation.issues.filter((i) => belongsTo(i.selectionId, unit))
  const errors = unitIssues.filter((i) => i.severity === 'error').length
  const isWarlord = validation.warlordSelectionId === unit.id
  const leading = validation.leaderTargets(unit.id)
  const canLead = leading.length > 0
  const ledBy = roster.selections.filter((l) => l.attachedTo === unit.id)
  const shownName = names.get(unit.id) ?? unit.name
  const nameOf = (id: string) => names.get(id) ?? unitById.get(id)?.name ?? 'a removed unit'
  const entry = graph.resolve(unit.entryId)
  const kind = entry ? attachmentKind(entry) : undefined
  const kindLabel = kind?.label ?? 'Leader'
  const enhancements = enhancementsTaken(unit, enhancementIds)
  const key = roleKey(role)

  if (compact) {
    // One line per unit: name, points, the chips that matter, the roll-up. Tap → editor.
    return (
      <li className={`units__item units__item--compact role-stripe role--${key} ${nested ? 'units__item--nested' : ''}`}>
        <button className="units__main units__main--compact" onClick={onEdit}>
          <span className="units__top">
            <span className="units__name">
              {shownName}
              <span className="muted units__pts">{validation.unitPoints[unit.id] ?? 0} pts</span>
            </span>
            <span className="units__chips">
              {nested && <span className="chip">{kindLabel}</span>}
              {isWarlord && <span className="chip chip--warlord">Warlord</span>}
              {enhancements.length > 0 && <span className="rule-chip rule-chip--enhancement">{enhancements.length}× enh.</span>}
              {errors > 0 && <span className="chip chip--error">✕ {errors}</span>}
            </span>
          </span>
          <span className="muted units__loadout">{describeLoadout(unit)}</span>
        </button>
        {leaders.length > 0 && <ul className="units units--leaders units--compact">{leaders.map(renderLeader)}</ul>}
      </li>
    )
  }

  return (
    <li className={`units__item role-stripe role--${key} ${nested ? 'units__item--nested' : ''}`}>
      <button className="units__main" onClick={onEdit}>
        <span className="units__top">
          <span className="units__name">
            {shownName}
            <span className="muted units__pts">{validation.unitPoints[unit.id] ?? 0} pts</span>
          </span>
          <span className="units__chips">
            {nested && <span className="chip">{kindLabel}</span>}
            {isWarlord && <span className="chip chip--warlord">Warlord</span>}
            {errors > 0 && <span className="chip chip--error">✕ {errors}</span>}
          </span>
        </span>
        {sheet && <StatStrip stats={sheet.stats} firstOnly mods={mods} />}
        <span className="muted units__loadout">{describeLoadout(unit)}</span>
        {enhancements.length > 0 && (
          <span className="units__chips">
            {enhancements.map((name) => (
              <span key={name} className="rule-chip rule-chip--enhancement">
                {name}
              </span>
            ))}
          </span>
        )}
        {unit.attachedTo && !nested && (
          <span className="muted">
            {kind?.key === 'leader' ? 'Leads' : `Attached to`} {nameOf(unit.attachedTo)}
            {kind && kind.key !== 'leader' ? ` (${kind.label})` : ''}
          </span>
        )}
        {ledBy.length > 0 && leaders.length === 0 && (
          <span className="muted">Joined by {ledBy.map((l) => nameOf(l.id)).join(', ')}</span>
        )}
      </button>

      {canLead && (
        <div className="units__attach">
          <label className="units__attachLabel">
            Attach as {kindLabel}
            <select
              value={unit.attachedTo ?? ''}
              onChange={(e) => {
                const targetId = e.target.value
                const match = leading.find((l) => l.targetIds.includes(targetId))
                const next: Selection = { ...unit }
                if (targetId && match) {
                  next.attachedTo = targetId
                  next.associationId = match.association.id
                } else {
                  delete next.attachedTo
                  delete next.associationId
                }
                update({ ...roster, selections: replaceSelection(roster.selections, unit.id, next) })
              }}
            >
              <option value="">— not attached —</option>
              {leading.flatMap((l) => {
                // Which rule this option attaches under decides what "already
                // taken" means: a unit may hold one Leader *and* one Support.
                const optionKind = kindOfAssociation(l.association) ?? kind
                const capacity = capacityOf(l.association)
                return l.targetIds.map((id) => {
                  const held = attachmentsOf(roster, graph, id)
                  const sameKind = optionKind ? heldOfKind(held, optionKind, unit.id) : []
                  const others = [...held.values()]
                    .flatMap((slot) =>
                      slot.units
                        .filter((u) => u.id !== unit.id && !sameKind.includes(u))
                        .map((u) => `${slot.kind.label}: ${nameOf(u.id)}`),
                    )
                  const full = sameKind.length >= capacity
                  const note = full
                    ? `${optionKind?.label ?? 'slot'} taken by ${sameKind.map((u) => nameOf(u.id)).join(', ')}`
                    : others.length > 0
                      ? `free · ${others.join(', ')}`
                      : 'free'
                  return (
                    <option key={`${l.association.id}:${id}`} value={id} disabled={full}>
                      {nameOf(id)} · {note}
                    </option>
                  )
                })
              })}
            </select>
          </label>
          {unit.attachedTo && (
            <button
              className="button button--quiet"
              onClick={() => {
                const next: Selection = { ...unit }
                delete next.attachedTo
                delete next.associationId
                update({ ...roster, selections: replaceSelection(roster.selections, unit.id, next) })
              }}
            >
              Detach
            </button>
          )}
        </div>
      )}

      <div className="units__actions">
        <button className="button button--quiet" onClick={onEdit}>
          Edit
        </button>
        {showArrows && (
          <>
            <button
              className="button button--quiet"
              aria-label={`Move ${shownName} up`}
              disabled={index === 0}
              onClick={() => update({ ...roster, selections: moveSelection(roster.selections, unit.id, -1) })}
            >
              ↑
            </button>
            <button
              className="button button--quiet"
              aria-label={`Move ${shownName} down`}
              disabled={index === total - 1}
              onClick={() => update({ ...roster, selections: moveSelection(roster.selections, unit.id, 1) })}
            >
              ↓
            </button>
          </>
        )}
        {validation.characterSelectionIds.includes(unit.id) && (
          <button
            className="button button--quiet"
            onClick={() => update(withWarlord(roster, graph, isWarlord ? undefined : unit.id))}
          >
            {isWarlord ? 'Unset Warlord' : 'Warlord'}
          </button>
        )}
        <button
          className="button button--quiet button--danger"
          onClick={() => {
            if (confirm(`Remove ${shownName} from the list?`)) update(removeUnit(roster, unit.id))
          }}
        >
          Remove
        </button>
      </div>

      {leaders.length > 0 && <ul className="units units--leaders">{leaders.map(renderLeader)}</ul>}
    </li>
  )
}

/**
 * The characters joined to one unit, with what each brings — the answer to
 * "who is in this mob and what do they give it?" when the unit is open.
 */
function attachedTo(
  roster: Roster,
  graph: CatalogueGraph,
  parsed: ParsedCatalogue,
  sheets: Map<string, Datasheet>,
  validation: Validation,
  unitId: string,
): AttachedUnit[] {
  const names = unitNames(roster)
  const enhancementIds = new Set((parsed.enhancements ?? []).map((e) => e.id))
  const out: AttachedUnit[] = []
  for (const [, slot] of attachmentsOf(roster, graph, unitId)) {
    for (const unit of slot.units) {
      out.push({
        id: unit.id,
        name: names.get(unit.id) ?? unit.name,
        kindLabel: slot.kind.label,
        points: validation.unitPoints[unit.id] ?? 0,
        sheet: sheets.get(unit.entryId),
        enhancements: enhancementsTaken(unit, enhancementIds),
      })
    }
  }
  return out
}

/** Points at each size the data lists, cheapest band: "90 (10) · 180 (20)". */
function pointsLine(sheet: Datasheet | undefined, entry: ResolvedEntry): string {
  const band = sheet?.pricing?.[0]
  if (band && band.costs.length > 0)
    return band.costs.map((c) => `${c.points} pts (${c.models})`).join(' · ')
  const base = sheet?.basePoints ?? entry.costs[COST_TYPE.points]
  return base === undefined ? '—' : `${base} pts`
}

function UnitPicker({
  graph,
  validation,
  sheets,
  onPick,
  onDone,
  counts,
  total,
  catalogueName,
}: {
  graph: CatalogueGraph
  validation: Validation
  sheets: Map<string, Datasheet>
  onPick: (entry: ResolvedEntry) => void
  onDone: () => void
  /** How many of each datasheet the roster already holds, by entry id. */
  counts: Map<string, number>
  total: number
  catalogueName: string
}) {
  const [query, setQuery] = useState('')
  /** A group id from `groupByRole`, or 'all'. */
  const [role, setRole] = useState<string>('all')
  const [open, setOpen] = useState<string | null>(null)

  const entries = useMemo(
    () =>
      graph.rootEntryIds
        .map((id) => graph.resolve(id))
        .filter((e): e is ResolvedEntry => Boolean(e))
        // The data's own gates: Legends units only once "Show Legends" is on, and so on.
        .filter((e) => validation.isEntryAvailable(undefined, e))
        .map((entry) => ({ entry, sheet: sheets.get(entry.id), roleName: roleOf(graph, entry.id) }))
        .sort((a, b) => a.entry.name.localeCompare(b.entry.name)),
    [graph, validation, sheets],
  )

  const needle = query.trim().toLowerCase()
  const allGroups = groupByRole(entries, (e) => e.roleName)
  const shown = groupByRole(
    entries.filter(
      ({ entry, sheet }) =>
        !needle ||
        entry.name.toLowerCase().includes(needle) ||
        (sheet?.keywords ?? []).some((k) => k.toLowerCase().includes(needle)),
    ),
    (e) => e.roleName,
  ).filter((g) => role === 'all' || g.id === role)

  return (
    <section className="rosters picker">
      <button className="sheet__back tap" onClick={onDone}>
        ‹ Done — back to the list
      </button>
      <h2>
        Add units <span className="muted">— {catalogueName}</span>
      </h2>
      <p className="muted picker__hint">
        The list stays open, so add as many as you like. {total} unit{total === 1 ? '' : 's'} in the
        roster.
      </p>
      <input
        className="sheets__search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search units and keywords"
        aria-label="Search units"
        autoFocus
      />
      <div className="sheets__roles" role="group" aria-label="Filter by role">
        <button className={`sheets__role${role === 'all' ? ' sheets__role--on' : ''}`} aria-pressed={role === 'all'} onClick={() => setRole('all')}>
          All
        </button>
        {allGroups.map((g) => (
          <button
            key={g.id}
            className={`sheets__role role--${g.key}${role === g.id ? ' sheets__role--on' : ''}`}
            aria-pressed={role === g.id}
            onClick={() => setRole(role === g.id ? 'all' : g.id)}
          >
            <span className="role-tag">{g.heading}</span>
          </button>
        ))}
      </div>

      {shown.map((group) => {
        return (
          <section key={group.id} className={`unitgroup role--${group.key}`}>
            <div className="unitgroup__head">
              <h3>{group.heading}</h3>
              <span className="unitgroup__sum">{group.items.length}</span>
            </div>
            <ul className="picker__list">
              {group.items.map(({ entry, sheet }) => {
                const id = entry.linkId ?? entry.id
                const expanded = open === id
                const inList = counts.get(entry.id) ?? 0
                return (
                  <li key={id} className={`picker__item role-stripe role--${group.key}`}>
                    <div className="picker__row">
                      <button className="picker__main tap" onClick={() => onPick(entry)}>
                        <span className="picker__name">
                          {entry.name}
                          {sheet?.variant && <span className="sheets__variant">{sheet.variant}</span>}
                          {inList > 0 && (
                            <span className="picker__count" aria-label={`${inList} in the roster`}>
                              {inList} in list
                            </span>
                          )}
                        </span>
                        <span className="muted picker__pts">{pointsLine(sheet, entry)}</span>
                        {sheet && <StatStrip stats={sheet.stats} />}
                      </button>
                      {sheet && (
                        <button
                          className="picker__info tap"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Hide' : 'Show'} abilities of ${entry.name}`}
                          onClick={() => setOpen(expanded ? null : id)}
                        >
                          {expanded ? '−' : 'i'}
                        </button>
                      )}
                    </div>
                    {expanded && sheet && (
                      <div className="picker__preview">
                        {sheet.abilities.length > 0 && (
                          <ul className="abilities">
                            {sheet.abilities.map((a) => (
                              <li key={a.id} className="abilities__item">
                                <div className="abilities__head">{a.name}</div>
                                <p className="abilities__text">
                                  <Marked text={shortText(a.text) || a.text} />
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                        {sheet.weapons.length > 0 && (
                          <p className="muted picker__weapons">
                            Weapons: {[...new Set(sheet.weapons.map((w) => w.name.split(' - ')[0]))].join(', ')}
                          </p>
                        )}
                        <p className="muted picker__weapons">
                          {sheet.keywords.join(', ')}
                        </p>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {shown.length === 0 && <p className="muted">No units match.</p>}
    </section>
  )
}
