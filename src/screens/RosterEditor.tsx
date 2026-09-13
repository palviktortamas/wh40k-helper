import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import { instantiate } from '@/roster/defaults'
import {
  getRoster,
  graphFor,
  moveSelection,
  replaceSelection,
  saveRoster,
  validate,
  type Validation,
} from '@/roster/store'
import { exportRosterText } from '@/roster/export'
import { POINTS_PRESETS, type Roster, type Selection } from '@/roster/types'
import type { CatalogueGraph, ResolvedEntry } from '@/roster/resolve'
import { UnitEditor } from './UnitEditor'
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
      setRoster(r ?? null)
      if (r) setCatalogue((await getCatalogue(r.catalogueId)) ?? null)
    })
  }, [rosterId])

  const graph = useMemo(() => (catalogue ? graphFor(catalogue) : null), [catalogue])

  const update = useCallback(
    (next: Roster) => {
      setRoster(next)
      // Autosave on every change (spec §7, data safety).
      void saveRoster(next)
    },
    [],
  )

  const validation: Validation | null = useMemo(
    () => (roster && graph ? validate(roster, graph) : null),
    [roster, graph],
  )

  if (!roster || !catalogue || !graph || !validation) return <p>Loading…</p>

  const detachments = graph.rootEntryIds
    .map((id) => graph.resolve(id))
    .filter((e): e is ResolvedEntry => Boolean(e))
  const detachmentOptions = collectDetachments(graph)

  const addUnit = (entry: ResolvedEntry) => {
    update({ ...roster, selections: [...roster.selections, instantiate(entry)] })
    setPicking(false)
  }

  const editingSelection = editing
    ? roster.selections.find((s) => s.id === editing)
    : undefined

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
        onPick={addUnit}
        onCancel={() => setPicking(false)}
        catalogueName={catalogue.name}
      />
    )
  }

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
      </div>

      <div className="rosters__controls">
        <label>
          Limit
          <select
            value={roster.pointsLimit}
            onChange={(e) => update({ ...roster, pointsLimit: Number(e.target.value) })}
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
            value={roster.detachmentId ?? ''}
            onChange={(e) => {
              const next = { ...roster }
              if (e.target.value) next.detachmentId = e.target.value
              else delete next.detachmentId
              update(next)
            }}
          >
            <option value="">— none —</option>
            {detachmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

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
            const unitIssues = validation.issues.filter((i) =>
              belongsTo(i.selectionId, unit),
            )
            const errors = unitIssues.filter((i) => i.severity === 'error').length
            return (
              <li key={unit.id} className="units__item">
                <button className="units__main" onClick={() => setEditing(unit.id)}>
                  <span className="units__name">
                    {unit.name}
                    {roster.warlordSelectionId === unit.id && (
                      <span className="chip">Warlord</span>
                    )}
                    {errors > 0 && <span className="chip chip--error">✕ {errors}</span>}
                  </span>
                  <span className="muted">{describeLoadout(unit)}</span>
                </button>
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
                  <button
                    className="button button--quiet"
                    onClick={() => {
                      const next = { ...roster }
                      if (roster.warlordSelectionId === unit.id) delete next.warlordSelectionId
                      else next.warlordSelectionId = unit.id
                      update(next)
                    }}
                  >
                    {roster.warlordSelectionId === unit.id ? 'Unset WL' : 'Warlord'}
                  </button>
                  <button
                    className="button button--quiet"
                    onClick={() =>
                      update({
                        ...roster,
                        selections: replaceSelection(roster.selections, unit.id, undefined),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {detachments.length === 0 && <p className="muted">This catalogue has no units.</p>}
    </section>
  )
}

/** True when an issue's selection lies anywhere inside this unit. */
function belongsTo(selectionId: string | undefined, unit: Selection): boolean {
  if (!selectionId) return false
  if (unit.id === selectionId) return true
  return unit.selections.some((child) => belongsTo(selectionId, child))
}

/** "9x Boy · 2x Boy w/ Rokkit launcha" — the roll-up the spec asks for. */
export function describeLoadout(unit: Selection): string {
  const counts = new Map<string, number>()
  const walk = (node: Selection) => {
    for (const child of node.selections) {
      if (child.type === 'model') counts.set(child.name, (counts.get(child.name) ?? 0) + child.count)
      walk(child)
    }
  }
  walk(unit)
  if (counts.size === 0) return 'No models'
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count}× ${name}`)
    .join(' · ')
}

/** Detachment entries are the ones that cost Detachment Points. */
function collectDetachments(graph: CatalogueGraph): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  for (const [id, entry] of graph.entries) {
    const dp = entry.costs?.find((c) => c.typeId === '82ae-1066-5107-6ae0')?.value
    if (dp !== undefined && dp > 0) out.push({ id, name: entry.name })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function UnitPicker({
  graph,
  onPick,
  onCancel,
  catalogueName,
}: {
  graph: CatalogueGraph
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
        .sort((a, b) => a.name.localeCompare(b.name)),
    [graph],
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
              <span className="muted">
                {entry.costs['51b2-306e-1021-d207'] ?? 0} pts
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
