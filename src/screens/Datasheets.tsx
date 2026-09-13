import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import type { Datasheet } from '@/data/model'
import { ROLE_ORDER, roleHeading, roleKey, type RoleKey } from '@/roster/roles'
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
  const [role, setRole] = useState<RoleKey | 'all'>('all')

  useEffect(() => {
    if (!catalogueId) return
    void getCatalogue(catalogueId).then((r) => setRecord(r ?? null))
  }, [catalogueId])

  const shown = useMemo(() => {
    if (!record) return []
    const needle = query.trim().toLowerCase()
    return record.parsed.datasheets.filter((sheet) => {
      if (role !== 'all' && roleKey(sheet.role) !== role) return false
      if (!needle) return true
      return (
        sheet.name.toLowerCase().includes(needle) ||
        sheet.keywords.some((k) => k.toLowerCase().includes(needle))
      )
    })
  }, [record, query, role])

  if (!record) return <p>Loading…</p>

  const all = record.parsed.datasheets
  const present = ROLE_ORDER.filter((key) => all.some((d) => roleKey(d.role) === key))
  const roleName = (key: RoleKey) => all.find((d) => roleKey(d.role) === key)?.role

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
        {present.map((key) => (
          <button
            key={key}
            className={`sheets__role role--${key}${role === key ? ' sheets__role--on' : ''}`}
            aria-pressed={role === key}
            onClick={() => setRole(key)}
          >
            <span className="role-tag">{roleHeading(key, roleName(key))}</span>
          </button>
        ))}
      </div>

      <p className="sheets__count">
        {shown.length} of {all.length} datasheets
      </p>

      {ROLE_ORDER.filter((key) => shown.some((d) => roleKey(d.role) === key)).map((key) => {
        const group = shown.filter((d) => roleKey(d.role) === key)
        return (
          <section key={key} className={`unitgroup role--${key}`}>
            <div className="unitgroup__head">
              <h3>{roleHeading(key, roleName(key))}</h3>
              <span className="unitgroup__sum">{group.length}</span>
            </div>
            <ul className="sheets__list">
              {group.map((sheet) => {
                const points = startingPoints(sheet)
                return (
                  <li key={sheet.id}>
                    <Link
                      className={`sheets__item tap role-stripe role--${key}`}
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
        )
      })}
    </section>
  )
}
