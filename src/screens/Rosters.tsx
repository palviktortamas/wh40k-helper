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
  saveRoster,
  validate,
} from '@/roster/store'
import { POINTS_PRESETS, type Roster } from '@/roster/types'
import './Rosters.css'

export function Rosters() {
  const navigate = useNavigate()
  const [rosters, setRosters] = useState<Roster[]>([])
  const [catalogues, setCatalogues] = useState<CatalogueRecord[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [catalogueId, setCatalogueId] = useState('')
  const [limit, setLimit] = useState<number>(2000)

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
      ) : (
        <button className="button" onClick={() => setCreating(true)}>
          New roster
        </button>
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
  const validation = catalogue ? validate(roster, graphFor(catalogue)) : undefined
  const detachment =
    catalogue && roster.detachmentId
      ? graphFor(catalogue).resolve(roster.detachmentId)?.name
      : undefined

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
