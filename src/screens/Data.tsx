import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getHealth,
  getInstalledCatalogues,
  installCatalogue,
  listCatalogues,
  removeCatalogue,
} from '@/data/worker/client'
import type { CatalogueRecord, HealthRecord } from '@/data/db'
import type { CatalogueSummary } from '@/data/model'
import type { Progress } from '@/data/install'
import { SOURCE_HOMEPAGES, SOURCE_LABELS } from '@/data/sources'
import './Data.css'

const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export function Data() {
  const [available, setAvailable] = useState<CatalogueSummary[]>([])
  const [installed, setInstalled] = useState<CatalogueRecord[]>([])
  const [health, setHealth] = useState<Record<string, HealthRecord>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [listing, setListing] = useState(false)

  const refreshInstalled = useCallback(async () => {
    const records = await getInstalledCatalogues()
    setInstalled(records)
    const entries = await Promise.all(
      records.map(async (r) => [r.id, await getHealth(r.id)] as const),
    )
    setHealth(Object.fromEntries(entries.filter((e): e is [string, HealthRecord] => Boolean(e[1]))))
  }, [])

  useEffect(() => {
    void refreshInstalled()
  }, [refreshInstalled])

  const loadAvailable = async () => {
    setListing(true)
    setError(null)
    try {
      setAvailable(await listCatalogues())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setListing(false)
    }
  }

  const install = async (summary: CatalogueSummary) => {
    setBusy(summary.id)
    setError(null)
    try {
      await installCatalogue(summary, setProgress)
      await refreshInstalled()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  const remove = async (record: CatalogueRecord) => {
    if (!confirm(`Remove ${record.name}? Its data will be downloaded again if you reinstall.`)) return
    await removeCatalogue(record.id)
    await refreshInstalled()
  }

  const installedIds = new Set(installed.map((r) => r.id))

  return (
    <section className="data">
      <h2>Data</h2>
      <p className="data__intro">
        Nothing ships with the app. Each faction is downloaded to this device and then works
        offline.
      </p>

      {error && (
        <p className="data__error" role="alert">
          {error}
        </p>
      )}

      <h3>Installed</h3>
      {installed.length === 0 ? (
        <p className="data__empty">No factions installed yet.</p>
      ) : (
        <ul className="data__list">
          {installed.map((record) => {
            const check = health[record.id]
            return (
              <li key={record.id} className="data__card">
                <div className="data__cardHead">
                  <strong>{record.name}</strong>
                  <span className="data__meta">{formatDate(record.installedAt)}</span>
                </div>
                <p className="data__meta">
                  {record.parsed.datasheets.length} datasheets ·{' '}
                  {record.parsed.detachments.length} detachments · BSData rev{' '}
                  {record.versions.bsdataRevision}
                  {record.versions.mfmVersion ? ` · MFM ${record.versions.mfmVersion}` : ''}
                </p>
                {check && (
                  <p className="data__meta">
                    {check.discrepancies.length > 0 ? (
                      <span className="data__warn">
                        ⚠ {check.discrepancies.length} discrepancies
                      </span>
                    ) : (
                      <span className="data__ok">✓ sources agree</span>
                    )}
                    {check.unmatched.length > 0 && ` · ${check.unmatched.length} unmatched`}
                  </p>
                )}
                <div className="data__actions">
                  <Link className="data__button tap" to={`/datasheets/${encodeURIComponent(record.id)}`}>
                    Browse datasheets
                  </Link>
                  <Link className="data__button data__button--quiet tap" to={`/health/${encodeURIComponent(record.id)}`}>
                    Data health
                  </Link>
                  <button className="data__button data__button--quiet" onClick={() => void remove(record)}>
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <h3>Available</h3>
      {available.length === 0 ? (
        <p>
          <button className="data__button" onClick={() => void loadAvailable()} disabled={listing}>
            {listing ? 'Checking…' : 'Check for factions'}
          </button>
        </p>
      ) : (
        <ul className="data__list">
          {available.map((summary) => (
            <li key={summary.id} className="data__card data__card--tight">
              <div className="data__cardHead">
                <span>{summary.name}</span>
                <button
                  className="data__button"
                  onClick={() => void install(summary)}
                  disabled={busy !== null}
                >
                  {busy === summary.id
                    ? (progress?.step ?? 'Working…')
                    : installedIds.has(summary.id)
                      ? 'Update'
                      : 'Install'}
                </button>
              </div>
              {!summary.slug && (
                <p className="data__meta">No official points mirror — BSData values only.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Sources</h3>
      <ul className="data__sources">
        {(['bsdata', 'mfm'] as const).map((id) => (
          <li key={id}>
            <a href={SOURCE_HOMEPAGES[id]} target="_blank" rel="noreferrer">
              {SOURCE_LABELS[id]}
            </a>
          </li>
        ))}
      </ul>
      <p className="data__meta">
        Wahapedia rules text and the mission deck need a proxy and arrive in a later phase.
      </p>
    </section>
  )
}
