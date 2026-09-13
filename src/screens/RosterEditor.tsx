import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
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
import { POINTS_PRESETS, type Roster, type Selection } from '@/roster/types'
import type { CatalogueGraph, ResolvedEntry } from '@/roster/resolve'
import { COST_TYPE } from '@/data/bsdata/schema'
import { OptionTree, UnitEditor } from './UnitEditor'
import './Rosters.css'

export function RosterEditor() {
  const { rosterId } = useParams<{ rosterId: string }>()
  const [roster, setRoster] = useState<Roster | null>(null)
  const [catalogue, setCatalogue] = useState<CatalogueRecord | null>(null)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
  }, [rosterId])

  const graph = useMemo(() => (catalogue ? graphFor(catalogue) : null), [catalogue])

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

  const addUnit = (entry: ResolvedEntry) => {
    update({ ...roster, selections: [...roster.selections, instantiate(entry)] })
    setPicking(false)
  }

  const editingSelection = editing ? roster.selections.find((s) => s.id === editing) : undefined

  if (editingSelection) {
    return (
      <UnitEditor
        selection={editingSelection}
        graph={graph}
        validation={validation}
        onBack={() => setEditing(null)}
        onChange={(next) =>
          update({ ...roster, selections: replaceSelection(roster.selections, editing!, next) })
        }
      />
    )
  }

  if (picking) {
    return (
      <UnitPicker
        graph={graph}
        validation={validation}
        onPick={addUnit}
        onCancel={() => setPicking(false)}
        catalogueName={catalogue.name}
      />
    )
  }

  const unitById = new Map(roster.selections.map((u) => [u.id, u]))

  return (
    <section className="rosters">
      <Link className="sheet__back tap" to="/rosters">
        ‹ Rosters
      </Link>

      <input
        className="rosters__title"
        value={roster.name}
        onChange={(e) => update({ ...roster, name: e.target.value })}
        aria-label="Roster name"
      />

      <div className="rosters__summary">
        <span className={`badge ${validation.legal ? 'badge--ok' : 'badge--error'}`}>
          {validation.legal ? '✓ Legal' : `✕ ${validation.errors.length} errors`}
        </span>
        <strong>
          {validation.points} / {roster.pointsLimit} pts
        </strong>
        {validation.detachmentPoints > 0 && (
          <span className="muted">{validation.detachmentPoints} DP</span>
        )}
        {validation.enhancements > 0 && (
          <span className="muted">
            {validation.enhancements} enhancement{validation.enhancements === 1 ? '' : 's'}
          </span>
        )}
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
        <label>
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
      )}

      <div className="rosters__controls">
        <button className="button" onClick={() => setPicking(true)}>
          Add unit
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
      </div>

      {roster.selections.length === 0 ? (
        <p className="muted">No units yet.</p>
      ) : (
        <ul className="units">
          {roster.selections.map((unit, index) => {
            const unitIssues = validation.issues.filter((i) => belongsTo(i.selectionId, unit))
            const errors = unitIssues.filter((i) => i.severity === 'error').length
            const isWarlord = validation.warlordSelectionId === unit.id
            const leading = validation.leaderTargets(unit.id)
            const canLead = leading.length > 0
            const ledBy = roster.selections.filter((l) => l.attachedTo === unit.id)
            return (
              <li key={unit.id} className="units__item">
                <button className="units__main" onClick={() => setEditing(unit.id)}>
                  <span className="units__name">
                    {unit.name}
                    <span className="muted"> {validation.unitPoints[unit.id] ?? 0} pts</span>
                    {isWarlord && <span className="chip">Warlord</span>}
                    {errors > 0 && <span className="chip chip--error">✕ {errors}</span>}
                  </span>
                  <span className="muted">{describeLoadout(unit)}</span>
                  {unit.attachedTo && (
                    <span className="muted">
                      Leads {unitById.get(unit.attachedTo)?.name ?? 'a removed unit'}
                    </span>
                  )}
                  {ledBy.length > 0 && (
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
                        update({
                          ...roster,
                          selections: replaceSelection(roster.selections, unit.id, next),
                        })
                      }}
                    >
                      <option value="">— not attached —</option>
                      {leading.flatMap((l) =>
                        l.targetIds.map((id) => (
                          <option key={`${l.association.id}:${id}`} value={id}>
                            {unitById.get(id)?.name ?? id}
                            {l.association.label && l.association.label !== 'Leader'
                              ? ` (${l.association.label})`
                              : ''}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                )}
                <div className="units__actions">
                  <button
                    className="button button--quiet"
                    aria-label={`Move ${unit.name} up`}
                    disabled={index === 0}
                    onClick={() =>
                      update({ ...roster, selections: moveSelection(roster.selections, unit.id, -1) })
                    }
                  >
                    ↑
                  </button>
                  <button
                    className="button button--quiet"
                    aria-label={`Move ${unit.name} down`}
                    disabled={index === roster.selections.length - 1}
                    onClick={() =>
                      update({ ...roster, selections: moveSelection(roster.selections, unit.id, 1) })
                    }
                  >
                    ↓
                  </button>
                  {validation.characterSelectionIds.includes(unit.id) && (
                    <button
                      className="button button--quiet"
                      onClick={() => update(withWarlord(roster, graph, isWarlord ? undefined : unit.id))}
                    >
                      {isWarlord ? 'Unset WL' : 'Warlord'}
                    </button>
                  )}
                  <button className="button button--quiet" onClick={() => update(removeUnit(roster, unit.id))}>
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
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
    // A single-model datasheet: show its wargear instead.
    const gear = unit.selections.filter((s) => s.type === 'upgrade').map((s) => s.name)
    return gear.length > 0 ? gear.join(' · ') : unit.type === 'model' ? 'Single model' : 'No models'
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count}× ${name}`)
    .join(' · ')
}

function UnitPicker({
  graph,
  validation,
  onPick,
  onCancel,
  catalogueName,
}: {
  graph: CatalogueGraph
  validation: Validation
  onPick: (entry: ResolvedEntry) => void
  onCancel: () => void
  catalogueName: string
}) {
  const [query, setQuery] = useState('')
  const entries = useMemo(
    () =>
      graph.rootEntryIds
        .map((id) => graph.resolve(id))
        .filter((e): e is ResolvedEntry => Boolean(e))
        // The data's own gates: Legends units only once "Show Legends" is on, and so on.
        .filter((e) => validation.isEntryAvailable(undefined, e))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [graph, validation],
  )

  const needle = query.trim().toLowerCase()
  const shown = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries

  return (
    <section className="rosters">
      <button className="sheet__back tap" onClick={onCancel}>
        ‹ Back
      </button>
      <h2>Add a unit — {catalogueName}</h2>
      <input
        className="sheets__search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search units"
        aria-label="Search units"
      />
      <ul className="sheets__list">
        {shown.map((entry) => (
          <li key={entry.id}>
            <button className="sheets__item tap" onClick={() => onPick(entry)}>
              <span>{entry.name}</span>
              <span className="muted">{entry.costs[COST_TYPE.points] ?? 0} pts</span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="muted">No units match.</p>}
    </section>
  )
}
