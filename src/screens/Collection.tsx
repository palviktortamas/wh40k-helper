import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getInstalledCatalogues } from '@/data/worker/client'
import { getSetting, setSetting, type CatalogueRecord } from '@/data/db'
import type { Datasheet } from '@/data/model'
import { groupByRole } from '@/roster/roles'
import { collectionStats, pointsForModels, startingModels, withCount } from '@/collection/collection'
import { getCollection, newEntry, saveEntry } from '@/collection/store'
import { STAGES, STAGE_LABELS, type CollectionEntry, type Stage } from '@/collection/types'
import './Datasheets.css'
import './Units.css'
import './Collection.css'

const LAST_FACTION_KEY = 'collection.catalogue'

/**
 * What the owner has on the shelf, per faction: models bought, assembled and
 * painted for each datasheet, with what they come to in points. The list
 * builder can then offer only the units the owner actually has.
 */
export function Collection() {
  const [catalogues, setCatalogues] = useState<CatalogueRecord[] | null>(null)
  const [catalogueId, setCatalogueId] = useState<string | null>(null)
  const [entries, setEntries] = useState<CollectionEntry[]>([])
  const [query, setQuery] = useState('')

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

  const add = (sheet: Datasheet) => {
    setQuery('')
    void save(newEntry(catalogueId, sheet.id, sheet.name, startingModels(sheet)))
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
  const groups = groupByRole(
    [...entries].sort((a, b) => a.name.localeCompare(b.name)),
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
        placeholder="Add a unit you own…"
        aria-label="Search units to add"
      />
      {needle && (
        <ul className="collection__matches">
          {matches.map((sheet) => (
            <li key={sheet.id}>
              <button className="tap collection__add" onClick={() => add(sheet)}>
                <span>{sheet.name}</span>
                <span className="muted">+ {startingModels(sheet)}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="muted">No unit by that name that is not already listed.</li>}
        </ul>
      )}

      {entries.length === 0 && !needle && (
        <p className="muted">Nothing listed yet. Search above to add the units you own.</p>
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
  const share = (stage: Stage) => (total > 0 ? Math.round((stats[stage].points / total) * 100) : 0)
  return (
    <dl className="collection__stats">
      {STAGES.map((stage) => (
        <div key={stage} className={`collection__stat collection__stat--${stage}`}>
          <dt>{STAGE_LABELS[stage]}</dt>
          <dd>
            <strong>{stats[stage].points} pts</strong>
            <span className="muted collection__models">
              {stats[stage].models} model{stats[stage].models === 1 ? '' : 's'}
              {stage !== 'bought' && total > 0 ? ` · ${share(stage)}%` : ''}
            </span>
            {stage !== 'bought' && (
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
          {pointsForModels(sheet, entry.bought)} pts
          {entry.painted > 0 &&
            (entry.painted === entry.bought ? ' · all painted' : ` · ${pointsForModels(sheet, entry.painted)} painted`)}
        </span>
      </div>
      <div className="collection__counts">
        {STAGES.map((stage) => (
          <Counter
            key={stage}
            label={STAGE_LABELS[stage]}
            value={entry[stage]}
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
