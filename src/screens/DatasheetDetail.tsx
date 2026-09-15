import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import type { Datasheet, WeaponProfile } from '@/data/model'
import './Datasheets.css'

const STAT_COLUMNS = [
  ['m', 'M'],
  ['t', 'T'],
  ['sv', 'SV'],
  ['w', 'W'],
  ['ld', 'LD'],
  ['oc', 'OC'],
  ['invSv', 'INV'],
] as const

function WeaponTable({ title, weapons }: { title: string; weapons: WeaponProfile[] }) {
  if (weapons.length === 0) return null
  const skillLabel = weapons[0]!.kind === 'ranged' ? 'BS' : 'WS'
  return (
    <>
      <h3>{title}</h3>
      <div className="sheet__scroll">
        <table className="sheet__table">
          <thead>
            <tr>
              <th scope="col">Weapon</th>
              <th scope="col">Range</th>
              <th scope="col">A</th>
              <th scope="col">{skillLabel}</th>
              <th scope="col">S</th>
              <th scope="col">AP</th>
              <th scope="col">D</th>
            </tr>
          </thead>
          <tbody>
            {weapons.map((weapon) => (
              <tr key={weapon.id}>
                <th scope="row">
                  {weapon.name}
                  {weapon.keywords.length > 0 && (
                    <span className="sheet__keywords">[{weapon.keywords.join(', ')}]</span>
                  )}
                </th>
                <td>{weapon.range ?? '—'}</td>
                <td>{weapon.a ?? '—'}</td>
                <td>{weapon.skill ?? '—'}</td>
                <td>{weapon.s ?? '—'}</td>
                <td>{weapon.ap ?? '—'}</td>
                <td>{weapon.d ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Pricing({ sheet }: { sheet: Datasheet }) {
  if (!sheet.pricing || sheet.pricing.length === 0) {
    return sheet.basePoints === undefined ? null : (
      <p className="sheet__meta">{sheet.basePoints} pts (BSData base cost)</p>
    )
  }
  return (
    <ul className="sheet__pricing">
      {sheet.pricing.map((band) => (
        <li key={`${band.from}-${band.to ?? 'up'}`}>
          <span className="sheet__band">
            {band.label ??
              (band.to === undefined ? `${band.from}th unit onwards` : `units ${band.from}–${band.to}`)}
          </span>
          {band.costs.map((cost) => (
            <span key={cost.models} className="sheet__cost">
              {cost.models} model{cost.models === 1 ? '' : 's'}: {cost.points} pts
            </span>
          ))}
        </li>
      ))}
    </ul>
  )
}

export function DatasheetDetail() {
  const { catalogueId, datasheetId } = useParams<{ catalogueId: string; datasheetId: string }>()
  const [record, setRecord] = useState<CatalogueRecord | null>(null)

  useEffect(() => {
    if (!catalogueId) return
    void getCatalogue(catalogueId).then((r) => setRecord(r ?? null))
  }, [catalogueId])

  if (!record) return <p>Loading…</p>
  const sheet = record.parsed.datasheets.find((d) => d.id === datasheetId)
  if (!sheet) return <p>That datasheet is not in the installed data.</p>

  return (
    <article className="sheet">
      <Link className="sheet__back tap" to={`/datasheets/${encodeURIComponent(record.id)}`}>
        ‹ {record.name}
      </Link>
      <h2>{sheet.name}</h2>
      <p className="sheet__meta">
        {sheet.role}
        {sheet.variant ? ` · ${sheet.variant}` : ''}
        {sheet.transportCapacity ? ` · transport ${sheet.transportCapacity}` : ''}
      </p>

      <Pricing sheet={sheet} />

      {sheet.stats.map((line) => (
        <div key={line.name} className="sheet__scroll">
          {sheet.stats.length > 1 && <p className="sheet__statName">{line.name}</p>}
          <table className="sheet__table sheet__table--stats">
            <thead>
              <tr>
                {STAT_COLUMNS.map(([, label]) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {STAT_COLUMNS.map(([key, label]) => (
                  <td key={label}>{line[key] ?? '—'}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <WeaponTable
        title="Ranged weapons"
        weapons={sheet.weapons.filter((w) => w.kind === 'ranged')}
      />
      <WeaponTable title="Melee weapons" weapons={sheet.weapons.filter((w) => w.kind === 'melee')} />

      {sheet.models.length > 0 && (
        <>
          <h3>Unit composition</h3>
          <ul className="sheet__plain">
            {sheet.models.map((model) => (
              <li key={model.id}>
                {model.name}
                {model.min !== undefined || model.max !== undefined
                  ? ` (${model.min ?? 0}–${model.max ?? '∞'})`
                  : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      {sheet.abilities.length > 0 && (
        <>
          <h3>Abilities</h3>
          <dl className="sheet__abilities">
            {sheet.abilities.map((ability) => (
              <div key={ability.id}>
                <dt>
                  {ability.name}
                  {ability.group && <span className="rule-chip rule-chip--group">{ability.group}</span>}
                </dt>
                <dd>{ability.text || '—'}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {(sheet.leaderTo?.length || sheet.supportTo?.length) && (
        <>
          <h3>Attachment</h3>
          {sheet.leaderTo?.length ? <p>Can lead: {sheet.leaderTo.join(', ')}</p> : null}
          {sheet.supportTo?.length ? <p>Can support: {sheet.supportTo.join(', ')}</p> : null}
        </>
      )}

      <h3>Keywords</h3>
      <p className="sheet__meta">{sheet.keywords.join(', ') || '—'}</p>
      {sheet.factionKeywords.length > 0 && (
        <p className="sheet__meta">Faction: {sheet.factionKeywords.join(', ')}</p>
      )}
    </article>
  )
}
