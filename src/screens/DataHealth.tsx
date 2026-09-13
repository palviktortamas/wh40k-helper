import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue, getHealth } from '@/data/worker/client'
import type { CatalogueRecord, HealthRecord } from '@/data/db'
import { SOURCE_LABELS } from '@/data/sources'
import './Data.css'

/**
 * Shows where the sources disagree and what could not be joined, rather than
 * hiding it (spec §4.1). Per-item overrides arrive with the List Builder, where
 * a chosen value actually changes a roster total.
 */
export function DataHealth() {
  const { catalogueId } = useParams<{ catalogueId: string }>()
  const [record, setRecord] = useState<CatalogueRecord | null>(null)
  const [health, setHealth] = useState<HealthRecord | null>(null)

  useEffect(() => {
    if (!catalogueId) return
    void getCatalogue(catalogueId).then((r) => setRecord(r ?? null))
    void getHealth(catalogueId).then((h) => setHealth(h ?? null))
  }, [catalogueId])

  if (!record) return <p>Loading…</p>

  const onlyIn = (source: 'bsdata' | 'mfm') =>
    (health?.unmatched ?? []).filter((u) => u.presentIn.includes(source) && u.presentIn.length === 1)

  return (
    <section className="data">
      <Link className="sheet__back tap" to="/data">
        ‹ Data
      </Link>
      <h2>Data health — {record.name}</h2>

      {!health ? (
        <p className="data__empty">No cross-check has run for this faction.</p>
      ) : (
        <>
          <p className="data__meta">
            Matched {health.matchedDatasheets} datasheets and {health.matchedDetachments}{' '}
            detachments across sources.
          </p>

          <h3>Disagreements</h3>
          {health.discrepancies.length === 0 ? (
            <p className="data__empty">
              <span className="data__ok">✓</span> The sources agree on every matched record.
            </p>
          ) : (
            <ul className="data__list">
              {health.discrepancies.map((d) => (
                <li key={d.key} className="data__card">
                  <strong>{d.subject}</strong>
                  <p className="data__meta">{d.field}</p>
                  <ul className="data__sources">
                    {d.values.map((v) => (
                      <li key={v.source}>
                        {SOURCE_LABELS[v.source]}: <strong>{v.value}</strong>
                        {v.source === d.chosen && ' — used'}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <h3>Present in only one source</h3>
          {health.unmatched.length === 0 ? (
            <p className="data__empty">Every record joined.</p>
          ) : (
            <>
              {(['bsdata', 'mfm'] as const).map((source) => {
                const rows = onlyIn(source)
                if (rows.length === 0) return null
                return (
                  <div key={source}>
                    <p className="data__meta">
                      Only in {SOURCE_LABELS[source]} ({rows.length})
                    </p>
                    <ul className="data__sources">
                      {rows.map((u) => (
                        <li key={`${u.kind}:${u.name}`}>
                          {u.name} <span className="data__meta">({u.kind})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </>
          )}
        </>
      )}

      {record.parsed.unsupported.length > 0 && (
        <>
          <h3>Parser notes</h3>
          <ul className="data__sources">
            {record.parsed.unsupported.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
