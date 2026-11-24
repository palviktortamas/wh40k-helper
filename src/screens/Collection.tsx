import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getInstalledCatalogues } from '@/data/worker/client'
import { getSetting, setSetting, type CatalogueRecord } from '@/data/db'
import type { Datasheet } from '@/data/model'
import { groupByRole } from '@/roster/roles'
import {
  collectionStats,
  countOf,
  pointsForModels,
  ROW_FILTERS,
  rowMatches,
  startingModels,
  withCount,
  type RowFilter,
} from '@/collection/collection'
import { getCollection, newEntry, saveEntry } from '@/collection/store'
import { COUNTS, STAGE_LABELS, type CollectionEntry, type Count } from '@/collection/types'
import './Datasheets.css'
import './Units.css'
import './Collection.css'

const LAST_FACTION_KEY = 'collection.catalogue'

/**
 * What the owner has on the shelf, per faction: models bought, assembled and
 * painted for each datasheet, and those planned but not bought yet, with what
 * they come to in points. The list builder can then offer only the units the
 * owner actually has (or plans to).
 */
export function Collection() {
  const [catalogues, setCatalogues] = useState<CatalogueRecord[] | null>(null)
  const [catalogueId, setCatalogueId] = useState<string | null>(null)
  const [entries, setEntries] = useState<CollectionEntry[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RowFilter>('all')

  useEffect(() => {
    void (async () => {
      const installed = await getInstalledCatalogues()
      setCatalogues(installed)
      const last = await getSetting<string | null>(LAST_FACTION_KEY, null)
      setCatalogueId(installed.find((c) => c.id === last)?.id ?? installed[0]?.id ?? null)
    })()
  }, [])

  useEffect(() => {
    if (!catalogueId) return
    void getCollection(catalogueId).then(setEntries)
  }, [catalogueId])

  const record = catalogues?.find((c) => c.id === catalogueId)
  const sheets = useMemo(
    () => new Map<string, Datasheet>((record?.parsed.datasheets ?? []).map((s) => [s.id, s])),
    [record],
  )

  if (catalogues === null) return <p>Loading…</p>
  if (!record || !catalogueId)
    return (
      <section className="collection">
        <h2>Collection</h2>
        <p className="muted">
          Install a faction on the <Link to="/data">Data</Link> screen first.
        </p>
      </section>
    )

  const pick = (id: string) => {
    setCatalogueId(id)
    setQuery('')
    void setSetting(LAST_FACTION_KEY, id)
  }

  const save = async (entry: CollectionEntry) => {
    await saveEntry(entry)
    setEntries(await getCollection(catalogueId))
  }

  const add = (sheet: Datasheet, as: 'bought' | 'planned') => {
    setQuery('')
    void save(newEntry(catalogueId, sheet.id, sheet.name, { [as]: startingModels(sheet) }))
  }

  const stats = collectionStats(entries, sheets)
  const owned = new Set(entries.map((e) => e.entryId))
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? (record.parsed.datasheets ?? [])
        .filter((s) => !owned.has(s.id) && s.name.toLowerCase().includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 20)
    : []
  const shown = entries.filter((e) => rowMatches(e, filter))
  const groups = groupByRole(
    [...shown].sort((a, b) => a.name.localeCompare(b.name)),
    (e) => sheets.get(e.entryId)?.role,
  )

  return (
    <section className="collection">
      <h2>Collection</h2>

      {catalogues.length > 1 ? (
        <label className="collection__faction">
          Faction{' '}
          <select value={catalogueId} onChange={(e) => pick(e.target.value)}>
            {catalogues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="muted">{record.name}</p>
      )}

      <Stats stats={stats} />

      <input
        className="sheets__search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add a unit you own or plan to buy…"
        aria-label="Search units to add"
      />
      {needle && (
        <ul className="collection__matches">
          {matches.map((sheet) => (
            <li key={sheet.id} className="collection__match">
              <span className="collection__matchName">{sheet.name}</span>
              <button className="tap collection__add" aria-label={`Own ${startingModels(sheet)} ${sheet.name}`} onClick={() => add(sheet, 'bought')}>
                + {startingModels(sheet)} own
              </button>
              <button className="tap collection__add" aria-label={`Plan ${startingModels(sheet)} ${sheet.name}`} onClick={() => add(sheet, 'planned')}>
                + {startingModels(sheet)} plan
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="muted">No unit by that name that is not already listed.</li>}
        </ul>
      )}

      {entries.length > 0 && (
        <div className="sheets__roles collection__filters" role="group" aria-label="Show">
          {ROW_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`sheets__role${filter === f.id ? ' sheets__role--on' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id !== 'all' && <span className="collection__filterCount"> {entries.filter((e) => rowMatches(e, f.id)).length}</span>}
            </button>
          ))}
        </div>
      )}
      {entries.length > 0 && shown.length === 0 && (
        <p className="muted">Nothing here — every unit is past this point, or none has reached it yet.</p>
      )}

      {entries.length === 0 && !needle && (
        <p className="muted">Nothing listed yet. Search above to add the units you own or plan to buy.</p>
      )}

      {groups.map((group) => (
        <section key={group.id} className={`unitgroup role--${group.key}`}>
          <div className="unitgroup__head">
            <h3>{group.heading}</h3>
            <span className="unitgroup__sum">{group.items.length}</span>
          </div>
          <ul className="collection__list">
            {group.items.map((entry) => (
              <Row key={entry.id} entry={entry} sheet={sheets.get(entry.entryId)} onChange={save} groupKey={group.key} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  )
}

function Stats({ stats }: { stats: ReturnType<typeof collectionStats> }) {
  const total = stats.bought.points
  const share = (stage: Count) => (total > 0 ? Math.round((stats[stage].points / total) * 100) : 0)
  // Assembled and painted are shares of what is bought; planned and bought stand on their own.
  const ofBought = (stage: Count) => stage === 'assembled' || stage === 'painted'
  return (
    <dl className="collection__stats">
      {COUNTS.map((stage) => (
        <div key={stage} className={`collection__stat collection__stat--${stage}`}>
          <dt>{STAGE_LABELS[stage]}</dt>
          <dd>
            <strong>{stats[stage].points} pts</strong>
            <span className="muted collection__models">
              {stats[stage].models} model{stats[stage].models === 1 ? '' : 's'}
              {ofBought(stage) && total > 0 ? ` · ${share(stage)}%` : ''}
            </span>
            {ofBought(stage) && (
              <span className="collection__bar" aria-hidden="true">
                <span style={{ width: `${share(stage)}%` }} />
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Row({
  entry,
  sheet,
  onChange,
  groupKey,
}: {
  entry: CollectionEntry
  sheet: Datasheet | undefined
  onChange: (entry: CollectionEntry) => void
  groupKey: string
}) {
  return (
    <li className={`collection__item role-stripe role--${groupKey}`}>
      <div className="collection__head">
        <span className="collection__name">{sheet?.name ?? entry.name}</span>
        <span className="muted">
          {entry.bought > 0 && `${pointsForModels(sheet, entry.bought)} pts`}
          {entry.painted > 0 &&
            (entry.painted === entry.bought ? ' · all painted' : ` · ${pointsForModels(sheet, entry.painted)} painted`)}
          {countOf(entry, 'planned') > 0 &&
            `${entry.bought > 0 ? ' · ' : ''}${pointsForModels(sheet, countOf(entry, 'planned'))} pts planned`}
        </span>
      </div>
      <div className="collection__counts">
        {COUNTS.map((stage) => (
          <Counter
            key={stage}
            label={STAGE_LABELS[stage]}
            value={countOf(entry, stage)}
            unitName={sheet?.name ?? entry.name}
            onChange={(n) => onChange(withCount(entry, stage, n))}
          />
        ))}
      </div>
      {!sheet && <p className="muted collection__gone">This datasheet is not in the installed data any more.</p>}
    </li>
  )
}

function Counter({
  label,
  value,
  unitName,
  onChange,
}: {
  label: string
  value: number
  unitName: string
  onChange: (n: number) => void
}) {
  // Typed counts are kept as text while editing, so clearing the field to type
  // a new number does not remove the row on the way.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number.parseInt(draft, 10)
    setDraft(null)
    if (Number.isFinite(n) && n !== value) onChange(n)
  }
  return (
    <div className="counter">
      <span className="counter__label">{label}</span>
      <div className="counter__controls">
        <button className="tap counter__step" aria-label={`One fewer ${label.toLowerCase()} for ${unitName}`} onClick={() => onChange(value - 1)} disabled={value === 0}>
          −
        </button>
        <input
          className="counter__value"
          type="number"
          inputMode="numeric"
          min={0}
          value={draft ?? String(value)}
          aria-label={`${label} models of ${unitName}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="tap counter__step" aria-label={`One more ${label.toLowerCase()} for ${unitName}`} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  )
}
