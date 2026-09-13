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
import {
  MISSIONS_CHANGED,
  fetchMissionDeckViaEndpoint,
  getMissionDeck,
  importBundledMissionDeck,
  importMissionDeckHtml,
} from '@/missions/store'
import type { MissionDeck } from '@/missions/types'
import { getSyncConfig } from '@/sync/client'
import {
  STRATAGEMS_CHANGED,
  STRATAGEMS_SOURCE_URL,
  fetchStratagemsViaEndpoint,
  getStratagemSet,
  importBundledStratagems,
  importStratagemsCsv,
  removeStratagems,
} from '@/stratagems/store'
import type { StratagemSet } from '@/stratagems/types'
import { graphFor, listRosters, normaliseRoster, validate } from '@/roster/store'
import './Data.css'

/** What a data update did to the rosters built on a faction (spec Phase 6, "data-update diff"). */
type RosterState = { id: string; name: string; points: number; errors: number }
type UpdateDiff = { catalogueId: string; changed: { before: RosterState; after: RosterState }[]; unchanged: number }

async function rosterStates(record: CatalogueRecord): Promise<RosterState[]> {
  const graph = graphFor(record)
  return (await listRosters())
    .filter((r) => r.catalogueId === record.id)
    .map((r) => {
      const v = validate(normaliseRoster(r, graph), graph)
      return { id: r.id, name: r.name, points: v.points, errors: v.errors.length }
    })
}

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
  const [diffs, setDiffs] = useState<Record<string, UpdateDiff>>({})

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
      // An update re-validates the rosters built on this faction, before and after,
      // so a points or legality change is shown rather than discovered mid-game.
      // Installed records are keyed by the catalogue's own id; the index knows file names.
      const previous = installed.find((r) => r.name === summary.name)
      const before = previous ? await rosterStates(previous) : []
      const record = await installCatalogue(summary, setProgress)
      if (previous) {
        const after = await rosterStates(record)
        const changed = after.flatMap((a) => {
          const b = before.find((x) => x.id === a.id)
          return b && (b.points !== a.points || b.errors !== a.errors) ? [{ before: b, after: a }] : []
        })
        setDiffs((d) => ({ ...d, [record.id]: { catalogueId: record.id, changed, unchanged: after.length - changed.length } }))
      }
      await refreshInstalled()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  /** Every installed faction that the index lists, one after the other. */
  const updateAll = async () => {
    const list = available.length > 0 ? available : await listCatalogues().catch(() => [])
    if (available.length === 0) setAvailable(list)
    for (const summary of list) if (installed.some((r) => r.name === summary.name)) await install(summary)
  }

  const remove = async (record: CatalogueRecord) => {
    if (!confirm(`Remove ${record.name}? Its data will be downloaded again if you reinstall.`)) return
    await removeCatalogue(record.id)
    await refreshInstalled()
  }

  const installedNames = new Set(installed.map((r) => r.name))

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

      <div className="data__sectionHead">
        <h3>Installed</h3>
        {installed.length > 0 && (
          <button className="data__button data__button--quiet" disabled={busy !== null} onClick={() => void updateAll()}>
            {busy ? 'Working…' : 'Update all'}
          </button>
        )}
      </div>
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
                  {record.parsed.datasheets.filter((d) => !d.library).length} datasheets
                  {record.parsed.datasheets.some((d) => d.library)
                    ? ` (+${record.parsed.datasheets.filter((d) => d.library).length} from linked libraries)`
                    : ''}{' '}
                  · {record.parsed.detachments.length} detachments · BSData rev{' '}
                  {record.versions.bsdataRevision}
                  {record.versions.mfmVersion ? ` · MFM ${record.versions.mfmVersion}` : ''}
                  {record.raw.libraries ? ` · with ${Object.keys(record.raw.libraries).length} linked ${Object.keys(record.raw.libraries).length === 1 ? 'library' : 'libraries'}` : ''}
                </p>
                {diffs[record.id] && (
                  <div className="data__diff" role="status">
                    {diffs[record.id]!.changed.length === 0 ? (
                      <p className="data__meta">
                        Updated — {diffs[record.id]!.unchanged} roster{diffs[record.id]!.unchanged === 1 ? '' : 's'} unchanged.
                      </p>
                    ) : (
                      <>
                        <p className="data__meta data__warn">Updated — these rosters changed:</p>
                        <ul className="data__diffList">
                          {diffs[record.id]!.changed.map(({ before, after }) => (
                            <li key={after.id}>
                              <Link to={`/rosters/${encodeURIComponent(after.id)}`}>{after.name}</Link>:{' '}
                              {before.points !== after.points ? `${before.points} → ${after.points} pts` : `${after.points} pts`}
                              {before.errors !== after.errors
                                ? `, ${before.errors === 0 ? 'legal' : `${before.errors} error${before.errors === 1 ? '' : 's'}`} → ${
                                    after.errors === 0 ? 'legal' : `${after.errors} error${after.errors === 1 ? '' : 's'}`
                                  }`
                                : ''}
                            </li>
                          ))}
                        </ul>
                        {diffs[record.id]!.unchanged > 0 && (
                          <p className="data__meta">{diffs[record.id]!.unchanged} other roster{diffs[record.id]!.unchanged === 1 ? '' : 's'} unchanged.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
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
                    : installedNames.has(summary.name)
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

      <MissionDeckSection />
      <StratagemsSection />

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
        Wahapedia rules text for datasheets (Phase 1b) is not imported yet; the mission deck and the
        stratagems above come from Wahapedia through your own endpoint or a saved file.
      </p>
    </section>
  )
}

/**
 * Stratagems (spec §6.3): BSData has none, so they come from Wahapedia's
 * `Stratagems.csv` export — through the owner's endpoint or as a file saved
 * from the browser. One import covers every faction; games filter it by
 * detachment.
 */
function StratagemsSection() {
  const [set, setSet] = useState<StratagemSet | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState(false)

  useEffect(() => {
    const load = () => void getStratagemSet().then((s) => setSet(s ?? null))
    load()
    void getSyncConfig().then((c) => setEndpoint(Boolean(c.url && c.passphrase)))
    // The first-start import may finish after this screen opened.
    window.addEventListener(STRATAGEMS_CHANGED, load)
    return () => window.removeEventListener(STRATAGEMS_CHANGED, load)
  }, [])

  const run = async (job: () => Promise<StratagemSet>) => {
    setBusy(true)
    setMessage(null)
    try {
      const imported = await job()
      setSet(imported)
      const core = imported.stratagems.filter((s) => s.core).length
      setMessage(`Imported ${imported.stratagems.length} stratagems (${core} Core).`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h3>Stratagems</h3>
      <div className="data__card">
        <div className="data__cardHead">
          <strong>Wahapedia stratagem export</strong>
          {set && <span className="data__meta">{formatDate(set.importedAt)}</span>}
        </div>
        {set ? (
          <p className="data__meta">
            {set.stratagems.length} stratagems across every faction · {set.stratagems.filter((s) => s.core).length}{' '}
            Core. Play Mode lists the Core ones and your detachment's, by phase, with their CP.
          </p>
        ) : (
          <p className="data__meta">
            Not imported yet. Play Mode's stratagem list needs it — the app ships the export and loads it
            on first start; if that did not happen, load it below, fetch it through your endpoint, or open{' '}
            <a href={STRATAGEMS_SOURCE_URL} target="_blank" rel="noreferrer">
              Stratagems.csv
            </a>{' '}
            in a browser, save it, and pick the file here.
          </p>
        )}
        {message && (
          <p className="data__meta" role="status">
            {message}
          </p>
        )}
        <div className="data__actions">
          <button
            className={`data__button${set ? ' data__button--quiet' : ''}`}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const imported = await importBundledStratagems()
                if (!imported) throw new Error('This build carries no stratagems — import the file or fetch through your endpoint.')
                return imported
              })
            }
          >
            {busy ? 'Working…' : set ? 'Reload the shipped stratagems' : 'Load the shipped stratagems'}
          </button>
          <button
            className="data__button data__button--quiet"
            disabled={busy || !endpoint}
            title={endpoint ? '' : 'Configure your endpoint under Settings → Sync first'}
            onClick={() => void run(fetchStratagemsViaEndpoint)}
          >
            {busy ? 'Working…' : set ? 'Refresh through my endpoint' : 'Fetch through my endpoint'}
          </button>
          <label className="data__button data__button--quiet tap data__file">
            Import Stratagems.csv
            <input
              type="file"
              accept="text/csv,.csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void run(async () => importStratagemsCsv(await file.text()))
              }}
            />
          </label>
          {set && (
            <button
              className="data__button data__button--quiet"
              disabled={busy}
              onClick={async () => {
                if (!confirm('Remove the imported stratagems from this device?')) return
                await removeStratagems()
                setSet(null)
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * The Chapter Approved mission deck (spec §6.1). Wahapedia publishes it but
 * sends no CORS headers, so the page arrives either through the owner's
 * endpoint (Settings → Sync) or as a file saved from the browser.
 */
function MissionDeckSection() {
  const [deck, setDeck] = useState<MissionDeck | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState(false)

  useEffect(() => {
    const load = () => void getMissionDeck().then((d) => setDeck(d ?? null))
    load()
    void getSyncConfig().then((c) => setEndpoint(Boolean(c.url && c.passphrase)))
    // The first-start import may finish after this screen opened.
    window.addEventListener(MISSIONS_CHANGED, load)
    return () => window.removeEventListener(MISSIONS_CHANGED, load)
  }, [])

  const run = async (job: () => Promise<MissionDeck>) => {
    setBusy(true)
    setMessage(null)
    try {
      const imported = await job()
      setDeck(imported)
      setMessage(`Imported ${imported.primaries.length} primary, ${imported.secondaries.length} secondary missions.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h3>Mission deck</h3>
      <div className="data__card">
        <div className="data__cardHead">
          <strong>Chapter Approved 2026-27</strong>
          {deck && <span className="data__meta">{formatDate(deck.importedAt)}</span>}
        </div>
        {deck ? (
          <p className="data__meta">
            {deck.primaries.length} primary · {deck.secondaries.length} secondary ·{' '}
            {deck.deployments.length} deployments · {deck.twists.length} twists
            {deck.editedAt ? ` · edited locally ${formatDate(deck.editedAt)} — importing again replaces the edits` : ''}
          </p>
        ) : (
          <p className="data__meta">
            Not imported yet. Play Mode's mission setup needs it — the app ships the deck and loads it
            on first start; if that did not happen, load it below.
          </p>
        )}
        {message && (
          <p className="data__meta" role="status">
            {message}
          </p>
        )}
        <div className="data__actions">
          {deck && (
            <Link className="data__button tap" to="/missions">
              Browse cards
            </Link>
          )}
          <button
            className={`data__button${deck ? ' data__button--quiet' : ''}`}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const imported = await importBundledMissionDeck()
                if (!imported) throw new Error('This build carries no mission deck — import the saved page or fetch through your endpoint.')
                return imported
              })
            }
          >
            {busy ? 'Working…' : deck ? 'Reload the shipped deck' : 'Load the shipped deck'}
          </button>
          <button
            className="data__button data__button--quiet"
            disabled={busy || !endpoint}
            title={endpoint ? '' : 'Configure your endpoint under Settings → Sync first'}
            onClick={() => void run(fetchMissionDeckViaEndpoint)}
          >
            {busy ? 'Working…' : deck ? 'Refresh through my endpoint' : 'Fetch through my endpoint'}
          </button>
          <label className="data__button data__button--quiet tap data__file">
            Import saved page
            <input
              type="file"
              accept="text/html,.html,.htm"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void run(async () => importMissionDeckHtml(await file.text()))
              }}
            />
          </label>
        </div>
        {!endpoint && !deck && (
          <p className="data__meta">
            Without an endpoint you can also open the deck page in a browser, save it as HTML, and
            import the file here.
          </p>
        )}
      </div>
    </>
  )
}
