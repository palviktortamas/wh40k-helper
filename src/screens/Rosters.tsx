import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getInstalledCatalogues } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import {
  deleteRoster,
  duplicateRoster,
  graphFor,
  listRosters,
  newRoster,
  normaliseRoster,
  saveRoster,
  validate,
} from '@/roster/store'
import { POINTS_PRESETS, type Roster } from '@/roster/types'
import { adoptRoster, exportRosterJson, parseRosterEnvelope, shareText } from '@/roster/transfer'
import './Rosters.css'

export function Rosters() {
  const navigate = useNavigate()
  const [rosters, setRosters] = useState<Roster[]>([])
  const [catalogues, setCatalogues] = useState<CatalogueRecord[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [catalogueId, setCatalogueId] = useState('')
  const [limit, setLimit] = useState<number>(2000)
  const [importing, setImporting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setRosters(await listRosters())
    const installed = await getInstalledCatalogues()
    setCatalogues(installed)
    setCatalogueId((current) => current || (installed[0]?.id ?? ''))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = async () => {
    const catalogue = catalogues.find((c) => c.id === catalogueId)
    if (!catalogue) return
    const roster = newRoster(catalogue, name.trim() || 'New army', limit)
    await saveRoster(roster)
    navigate(`/rosters/${encodeURIComponent(roster.id)}`)
  }

  // Import a roster exported on another device (spec §4.4). The receiving
  // device validates it against its own installed data.
  const importText = async (text: string) => {
    setImportError(null)
    try {
      const envelope = parseRosterEnvelope(text)
      const roster = adoptRoster(envelope.roster, rosters.map((r) => r.name))
      await saveRoster(roster)
      if (!catalogues.some((c) => c.id === roster.catalogueId)) {
        alert(`Imported. Install "${envelope.catalogueName}" under Data to edit and validate it.`)
      }
      setImporting(false)
      setPasted('')
      await refresh()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    }
  }

  if (catalogues.length === 0) {
    return (
      <section>
        <h2>Rosters</h2>
        <p>
          No faction data installed yet. Open <Link to="/data">Data</Link> and install a faction
          first.
        </p>
      </section>
    )
  }

  return (
    <section className="rosters">
      <h2>Rosters</h2>

      {creating ? (
        <div className="rosters__form">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New army" />
          </label>
          <label>
            Faction
            <select value={catalogueId} onChange={(e) => setCatalogueId(e.target.value)}>
              {catalogues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Points limit
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {POINTS_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="rosters__formActions">
            <button className="button" onClick={() => void create()}>
              Create
            </button>
            <button className="button button--quiet" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : importing ? (
        <div className="rosters__form">
          <label>
            Paste an exported roster
            <textarea
              className="rosters__paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              placeholder='{"app":"wh40k-helper","kind":"roster",…}'
            />
          </label>
          <label>
            …or pick the file
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void file.text().then(importText)
              }}
            />
          </label>
          {importError && (
            <p className="issues__item issues__item--error" role="alert">
              {importError}
            </p>
          )}
          <div className="rosters__formActions">
            <button className="button" disabled={!pasted.trim()} onClick={() => void importText(pasted)}>
              Import
            </button>
            <button
              className="button button--quiet"
              onClick={() => {
                setImporting(false)
                setImportError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rosters__controls">
          <button className="button" onClick={() => setCreating(true)}>
            New roster
          </button>
          <button className="button button--quiet" onClick={() => setImporting(true)}>
            Import
          </button>
        </div>
      )}

      {rosters.length === 0 ? (
        <p className="muted">No rosters yet.</p>
      ) : (
        <ul className="rosters__list">
          {rosters.map((roster) => (
            <RosterCard
              key={roster.id}
              roster={roster}
              catalogue={catalogues.find((c) => c.id === roster.catalogueId)}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function RosterCard({
  roster,
  catalogue,
  onChanged,
}: {
  roster: Roster
  catalogue: CatalogueRecord | undefined
  onChanged: () => Promise<void>
}) {
  // Validation is cheap enough to run per card, and the badge is the whole point.
  // Older rosters are normalised in memory only; the editor saves the upgrade.
  const validation = catalogue
    ? validate(normaliseRoster(roster, graphFor(catalogue)), graphFor(catalogue))
    : undefined
  const detachment = validation?.detachments.map((d) => d.name).join(' + ')

  return (
    <li className="rosters__card">
      <Link className="rosters__link tap" to={`/rosters/${encodeURIComponent(roster.id)}`}>
        <span className="rosters__name">{roster.name}</span>
        <span className="muted">
          {catalogue?.name ?? 'Faction not installed'}
          {detachment ? ` · ${detachment}` : ''}
        </span>
        <span className="muted">
          {validation ? `${validation.points}` : '—'} / {roster.pointsLimit} pts
        </span>
      </Link>
      <div className="rosters__cardActions">
        {validation && (
          <span className={`badge ${validation.legal ? 'badge--ok' : 'badge--error'}`}>
            {validation.legal ? '✓ Legal' : `✕ ${validation.errors.length} errors`}
          </span>
        )}
        <button
          className="button button--quiet"
          onClick={async () => {
            await duplicateRoster(roster)
            await onChanged()
          }}
        >
          Duplicate
        </button>
        <button
          className="button button--quiet"
          onClick={async () => {
            // Phone: share sheet. PC: clipboard. Paste it into "Import" on the other device.
            const outcome = await shareText(
              roster.name,
              exportRosterJson(roster, catalogue?.name ?? 'Unknown faction'),
            )
            if (outcome === 'copied') alert('Roster JSON copied. Paste it into "Import" on the other device.')
          }}
        >
          Share
        </button>
        <button
          className="button button--quiet"
          onClick={async () => {
            if (!confirm(`Delete "${roster.name}"? This cannot be undone.`)) return
            await deleteRoster(roster.id)
            await onChanged()
          }}
        >
          Delete
        </button>
      </div>
    </li>
  )
}
