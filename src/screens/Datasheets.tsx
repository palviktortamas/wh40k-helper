import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import type { Datasheet } from '@/data/model'
import { groupByRole } from '@/roster/roles'
import { StatStrip } from './StatStrip'
import './Datasheets.css'
import './Units.css'

/** Cheapest listed points, which is what a browse list wants to show. */
export function startingPoints(sheet: Datasheet): number | undefined {
  const band = sheet.pricing?.[0]
  if (band && band.costs.length > 0) {
    return band.costs.reduce((min, c) => (c.points < min ? c.points : min), band.costs[0]!.points)
  }
  return sheet.basePoints
}

export function Datasheets() {
  const { catalogueId } = useParams<{ catalogueId: string }>()
  const [record, setRecord] = useState<CatalogueRecord | null>(null)
  const [query, setQuery] = useState('')
  /** A group id from `groupByRole`, or 'all'. */
  const [role, setRole] = useState<string>('all')

  useEffect(() => {
    if (!catalogueId) return
    void getCatalogue(catalogueId).then((r) => setRecord(r ?? null))
  }, [catalogueId])

  const all = record?.parsed.datasheets ?? []
  const allGroups = useMemo(() => groupByRole(all, (d) => d.role), [all])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return groupByRole(
      all.filter(
        (sheet) =>
          !needle ||
          sheet.name.toLowerCase().includes(needle) ||
          sheet.keywords.some((k) => k.toLowerCase().includes(needle)),
      ),
      (d) => d.role,
    ).filter((g) => role === 'all' || g.id === role)
  }, [all, query, role])

  if (!record) return <p>Loading…</p>

  const shownCount = shown.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <section className="sheets">
      <h2>{record.name}</h2>

      <input
        className="sheets__search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search units and keywords"
        aria-label="Search datasheets"
      />

      <div className="sheets__roles" role="group" aria-label="Filter by role">
        <button
          className={`sheets__role${role === 'all' ? ' sheets__role--on' : ''}`}
          aria-pressed={role === 'all'}
          onClick={() => setRole('all')}
        >
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

      <p className="sheets__count">
        {shownCount} of {all.length} datasheets
      </p>

      {shown.map((group) => (
        <section key={group.id} className={`unitgroup role--${group.key}`}>
          <div className="unitgroup__head">
            <h3>{group.heading}</h3>
            <span className="unitgroup__sum">{group.items.length}</span>
          </div>
          <ul className="sheets__list">
            {group.items.map((sheet) => {
              const points = startingPoints(sheet)
              return (
                <li key={sheet.id}>
                  <Link
                    className={`sheets__item tap role-stripe role--${group.key}`}
                    to={`/datasheets/${encodeURIComponent(record.id)}/${encodeURIComponent(sheet.id)}`}
                  >
                    <span className="sheets__main">
                      <span className="sheets__name">
                        {sheet.name}
                        {sheet.variant && <span className="sheets__variant">{sheet.variant}</span>}
                        {sheet.library && (
                          <span className="sheets__variant" title={`From ${sheet.library}`}>
                            linked
                          </span>
                        )}
                      </span>
                      <StatStrip stats={sheet.stats} firstOnly />
                    </span>
                    <span className="sheets__points">{points === undefined ? '—' : `${points} pts`}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </section>
  )
}
