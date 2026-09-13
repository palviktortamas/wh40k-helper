import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import type { Datasheet } from '@/data/model'
import './Datasheets.css'

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
  const [role, setRole] = useState<string>('all')

  useEffect(() => {
    if (!catalogueId) return
    void getCatalogue(catalogueId).then((r) => setRecord(r ?? null))
  }, [catalogueId])

  const roles = useMemo(() => {
    if (!record) return []
    return [...new Set(record.parsed.datasheets.map((d) => d.role).filter(Boolean))].sort() as string[]
  }, [record])

  const shown = useMemo(() => {
    if (!record) return []
    const needle = query.trim().toLowerCase()
    return record.parsed.datasheets.filter((sheet) => {
      if (role !== 'all' && sheet.role !== role) return false
      if (!needle) return true
      return (
        sheet.name.toLowerCase().includes(needle) ||
        sheet.keywords.some((k) => k.toLowerCase().includes(needle))
      )
    })
  }, [record, query, role])

  if (!record) return <p>Loading…</p>

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
        {['all', ...roles].map((option) => (
          <button
            key={option}
            className={`sheets__role${role === option ? ' sheets__role--on' : ''}`}
            aria-pressed={role === option}
            onClick={() => setRole(option)}
          >
            {option === 'all' ? 'All' : option}
          </button>
        ))}
      </div>

      <p className="sheets__count">
        {shown.length} of {record.parsed.datasheets.length} datasheets
      </p>

      <ul className="sheets__list">
        {shown.map((sheet) => {
          const points = startingPoints(sheet)
          return (
            <li key={sheet.id}>
              <Link
                className="sheets__item tap"
                to={`/datasheets/${encodeURIComponent(record.id)}/${encodeURIComponent(sheet.id)}`}
              >
                <span className="sheets__name">
                  {sheet.name}
                  {sheet.variant && <span className="sheets__variant">{sheet.variant}</span>}
                  {sheet.library && <span className="sheets__variant" title={`From ${sheet.library}`}>linked</span>}
                </span>
                <span className="sheets__points">{points === undefined ? '—' : `${points} pts`}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
