import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import { getSetting, setSetting } from '@/data/db'
import type { Datasheet, Detachment } from '@/data/model'
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
  withDetachment,
  withToggle,
  withWarlord,
  type Validation,
} from '@/roster/store'
import { exportRosterText } from '@/roster/export'
import { POINTS_PRESETS, walkSelections, type Roster, type Selection } from '@/roster/types'
import type { CatalogueGraph, ResolvedEntry } from '@/roster/resolve'
import { ROLE_ORDER, roleHeading, roleKey, roleOf, type RoleKey } from '@/roster/roles'
import { WARLORD_CATEGORY } from '@/roster/vocabulary'
import { COST_TYPE } from '@/data/bsdata/schema'
import { OptionTree, UnitEditor } from './UnitEditor'
import { StatStrip } from './StatStrip'
import { Marked } from './Marked'
import { shortText } from '@/reminders/heuristics'
import './Rosters.css'
import './Units.css'

/** Which way the unit list is arranged; remembered per device (IndexedDB settings). */
type UnitsView = 'role' | 'order'
const VIEW_KEY = 'rosters.unitsView'

export function RosterEditor() {
  const { rosterId } = useParams<{ rosterId: string }>()
  const [roster, setRoster] = useState<Roster | null>(null)
  const [catalogue, setCatalogue] = useState<CatalogueRecord | null>(null)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<UnitsView>('role')

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
  }, [rosterId])

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
  const detachment: Detachment | undefined = validation.detachment
    ? catalogue.parsed.detachments.find((d) => d.name === validation.detachment!.name)
    : undefined

  const addUnit = (entry: ResolvedEntry) => {
    update({ ...roster, selections: [...roster.selections, instantiate(entry)] })
    setPicking(false)
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
        detachment={detachment}
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
        onCancel={() => setPicking(false)}
        catalogueName={catalogue.name}
      />
    )
  }

  const unitById = new Map(roster.selections.map((u) => [u.id, u]))
  const enhancementIds = new Set((catalogue.parsed.enhancements ?? []).map((e) => e.id))
  const errorCount = validation.errors.length
  const warningCount = validation.warnings.length
  const over = validation.points > roster.pointsLimit
  const ratio = Math.min(1, validation.points / Math.max(1, roster.pointsLimit))

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
      enhancementIds={enhancementIds}
      showArrows={view === 'order'}
      nested={nested}
      leaders={view === 'role' ? roster.selections.filter((l) => l.attachedTo === unit.id) : []}
      renderLeader={(leader) => cardFor(leader, roster.selections.indexOf(leader), true)}
      onEdit={() => setEditing(unit.id)}
      update={update}
    />
  )

  // By role: attached leaders ride inside the unit they lead, as at the table.
  const grouped = new Map<RoleKey, { units: Selection[]; points: number; roleName?: string }>()
  if (view === 'role') {
    for (const unit of roster.selections) {
      if (unit.attachedTo && unitById.has(unit.attachedTo)) continue
      const roleName = roleOf(graph, unit.entryId)
      const key = roleKey(roleName)
      const group = grouped.get(key) ?? { units: [], points: 0 }
      group.units.push(unit)
      group.points +=
        (validation.unitPoints[unit.id] ?? 0) +
        roster.selections
          .filter((l) => l.attachedTo === unit.id)
          .reduce((sum, l) => sum + (validation.unitPoints[l.id] ?? 0), 0)
      if (roleName && !group.roleName) group.roleName = roleName
      grouped.set(key, group)
    }
  }

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
        <p className="summary__detachment muted">
          {catalogue.name}
          {detachment ? ` · ${detachment.name}` : ' · no detachment chosen'}
          {detachment && detachment.forceDispositions.length > 0
            ? ` · ${detachment.forceDispositions.join(' / ')}`
            : ''}
        </p>
      </div>

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
        <label className="rosters__grow">
          Detachment
          <select
            value={validation.detachment?.entryId ?? ''}
            onChange={(e) => update(withDetachment(roster, graph, e.target.value || undefined))}
          >
            <option value="">— none —</option>
            {detachments.map((d) => (
              <option key={d.entry.linkId ?? d.entry.id} value={d.entry.id}>
                {d.entry.name} ({d.entry.costs[COST_TYPE.detachmentPoints]} DP)
              </option>
            ))}
          </select>
        </label>
      </div>

      {detachment && (detachment.rules?.length ?? 0) > 0 && (
        <details className="config detachment">
          <summary>
            Detachment rule{detachment.rules!.length === 1 ? '' : 's'} — {detachment.name}
          </summary>
          <ul className="abilities">
            {detachment.rules!.map((rule) => (
              <li key={rule.id} className="abilities__item">
                <div className="abilities__head">
                  {rule.name}
                  <span className="rule-chip rule-chip--detachment">{detachment.name}</span>
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
        </details>
      )}

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
            By role
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
        ROLE_ORDER.filter((key) => grouped.has(key)).map((key) => {
          const group = grouped.get(key)!
          return (
            <section key={key} className={`unitgroup role--${key}`}>
              <div className="unitgroup__head">
                <h3>{roleHeading(key, group.roleName)}</h3>
                <span className="unitgroup__sum">
                  {group.units.length} · {group.points} pts
                </span>
              </div>
              <ul className="units">{group.units.map((unit) => cardFor(unit, roster.selections.indexOf(unit)))}</ul>
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
  enhancementIds,
  showArrows,
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
  enhancementIds: Set<string>
  showArrows: boolean
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
  const enhancements = enhancementsTaken(unit, enhancementIds)
  const key = roleKey(role)

  return (
    <li className={`units__item role-stripe role--${key} ${nested ? 'units__item--nested' : ''}`}>
      <button className="units__main" onClick={onEdit}>
        <span className="units__top">
          <span className="units__name">
            {unit.name}
            <span className="muted units__pts">{validation.unitPoints[unit.id] ?? 0} pts</span>
          </span>
          <span className="units__chips">
            {nested && <span className="chip">Leader</span>}
            {isWarlord && <span className="chip chip--warlord">Warlord</span>}
            {errors > 0 && <span className="chip chip--error">✕ {errors}</span>}
          </span>
        </span>
        {sheet && <StatStrip stats={sheet.stats} firstOnly />}
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
          <span className="muted">Leads {unitById.get(unit.attachedTo)?.name ?? 'a removed unit'}</span>
        )}
        {ledBy.length > 0 && leaders.length === 0 && (
          <span className="muted">Led by {ledBy.map((l) => l.name).join(', ')}</span>
        )}
      </button>

      {canLead && (
        <label className="units__attach">
          Attach to
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
            {leading.flatMap((l) =>
              l.targetIds.map((id) => (
                <option key={`${l.association.id}:${id}`} value={id}>
                  {unitById.get(id)?.name ?? id}
                  {l.association.label && l.association.label !== 'Leader' ? ` (${l.association.label})` : ''}
                </option>
              )),
            )}
          </select>
        </label>
      )}

      <div className="units__actions">
        <button className="button button--quiet" onClick={onEdit}>
          Edit
        </button>
        {showArrows && (
          <>
            <button
              className="button button--quiet"
              aria-label={`Move ${unit.name} up`}
              disabled={index === 0}
              onClick={() => update({ ...roster, selections: moveSelection(roster.selections, unit.id, -1) })}
            >
              ↑
            </button>
            <button
              className="button button--quiet"
              aria-label={`Move ${unit.name} down`}
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
            if (confirm(`Remove ${unit.name} from the list?`)) update(removeUnit(roster, unit.id))
          }}
        >
          Remove
        </button>
      </div>

      {leaders.length > 0 && <ul className="units units--leaders">{leaders.map(renderLeader)}</ul>}
    </li>
  )
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
  onCancel,
  catalogueName,
}: {
  graph: CatalogueGraph
  validation: Validation
  sheets: Map<string, Datasheet>
  onPick: (entry: ResolvedEntry) => void
  onCancel: () => void
  catalogueName: string
}) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<RoleKey | 'all'>('all')
  const [open, setOpen] = useState<string | null>(null)

  const entries = useMemo(
    () =>
      graph.rootEntryIds
        .map((id) => graph.resolve(id))
        .filter((e): e is ResolvedEntry => Boolean(e))
        // The data's own gates: Legends units only once "Show Legends" is on, and so on.
        .filter((e) => validation.isEntryAvailable(undefined, e))
        .map((entry) => {
          const roleName = roleOf(graph, entry.id)
          return { entry, sheet: sheets.get(entry.id), roleName, key: roleKey(roleName) }
        })
        .sort((a, b) => a.entry.name.localeCompare(b.entry.name)),
    [graph, validation, sheets],
  )

  const needle = query.trim().toLowerCase()
  const shown = entries.filter(({ entry, sheet, key }) => {
    if (role !== 'all' && key !== role) return false
    if (!needle) return true
    return (
      entry.name.toLowerCase().includes(needle) ||
      (sheet?.keywords ?? []).some((k) => k.toLowerCase().includes(needle))
    )
  })
  const present = ROLE_ORDER.filter((key) => entries.some((e) => e.key === key))

  return (
    <section className="rosters picker">
      <button className="sheet__back tap" onClick={onCancel}>
        ‹ Back to the list
      </button>
      <h2>Add a unit <span className="muted">— {catalogueName}</span></h2>
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
        {present.map((key) => (
          <button
            key={key}
            className={`sheets__role role--${key}${role === key ? ' sheets__role--on' : ''}`}
            aria-pressed={role === key}
            onClick={() => setRole(key)}
          >
            <span className="role-tag">{roleHeading(key, entries.find((e) => e.key === key)?.roleName)}</span>
          </button>
        ))}
      </div>

      {ROLE_ORDER.filter((key) => shown.some((e) => e.key === key)).map((key) => {
        const group = shown.filter((e) => e.key === key)
        return (
          <section key={key} className={`unitgroup role--${key}`}>
            <div className="unitgroup__head">
              <h3>{roleHeading(key, group[0]?.roleName)}</h3>
              <span className="unitgroup__sum">{group.length}</span>
            </div>
            <ul className="picker__list">
              {group.map(({ entry, sheet }) => {
                const id = entry.linkId ?? entry.id
                const expanded = open === id
                return (
                  <li key={id} className={`picker__item role-stripe role--${key}`}>
                    <div className="picker__row">
                      <button className="picker__main tap" onClick={() => onPick(entry)}>
                        <span className="picker__name">
                          {entry.name}
                          {sheet?.variant && <span className="sheets__variant">{sheet.variant}</span>}
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
