import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMissionDeck } from '@/missions/store'
import {
  FORCE_DISPOSITIONS,
  titleCase,
  type MissionCard,
  type MissionDeck,
  type ScoreLine,
} from '@/missions/types'
import './Rosters.css'
import './Missions.css'

type Tab = 'primaries' | 'secondaries' | 'twists' | 'deployments' | 'dispositions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'primaries', label: 'Primary' },
  { id: 'secondaries', label: 'Secondary' },
  { id: 'twists', label: 'Twists' },
  { id: 'deployments', label: 'Deployment' },
  { id: 'dispositions', label: 'Dispositions' },
]

/** The imported deck, readable at the table (spec §6.1). */
export function Missions() {
  const [deck, setDeck] = useState<MissionDeck | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('primaries')

  useEffect(() => {
    void getMissionDeck().then((d) => setDeck(d ?? null))
  }, [])

  if (deck === undefined) return <p>Loading…</p>
  if (deck === null)
    return (
      <section className="rosters">
        <h2>Missions</h2>
        <p>
          The mission deck is not imported yet. Do that under <Link to="/data">Data</Link>.
        </p>
      </section>
    )

  return (
    <section className="rosters missions">
      <Link className="sheet__back tap" to="/data">
        ‹ Data
      </Link>
      <h2>Chapter Approved 2026-27</h2>
      <div className="sheets__roles" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`sheets__role ${tab === t.id ? 'sheets__role--on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'primaries' &&
        FORCE_DISPOSITIONS.map((d) => (
          <section key={d}>
            <h3 className="play__heading">{d}</h3>
            {deck.primaries
              .filter((p) => p.disposition === d)
              .map((p) => (
                <Card key={p.id} card={p} meta={`vs ${p.opponentDisposition}`} />
              ))}
          </section>
        ))}
      {tab === 'secondaries' &&
        deck.secondaries.map((s) =>
          s.fixedEligible ? <Card key={s.id} card={s} meta="Fixed-eligible" /> : <Card key={s.id} card={s} />,
        )}
      {tab === 'twists' && deck.twists.map((t) => <Card key={t.id} card={t} />)}
      {tab === 'deployments' &&
        deck.deployments.map((d) => (
          <article key={d.id} className="mission">
            <h3>{titleCase(d.name)}</h3>
            <img className="mission__map" src={d.imageUrl} alt={`${titleCase(d.name)} deployment map`} loading="lazy" />
            <p className="muted mission__credit">Map image from Wahapedia.</p>
          </article>
        ))}
      {tab === 'dispositions' &&
        deck.forceDispositions.map((c) => (
          <article key={c.name} className="mission">
            <h3>{c.name}</h3>
            {c.legend && <p className="mission__legend">{c.legend}</p>}
            <table className="sheet__table">
              <thead>
                <tr>
                  <th scope="col">Opponent</th>
                  <th scope="col">Your primary</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.opponent}>
                    <td>{r.opponent}</td>
                    <td>{titleCase(r.mission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
    </section>
  )
}

export function vpLabel(line: ScoreLine, mode?: 'fixed' | 'tactical'): string {
  const value =
    mode === 'fixed'
      ? (line.fixedVp ?? line.vp)
      : mode === 'tactical'
        ? (line.tacticalVp ?? line.vp)
        : line.vp
  if (value === undefined && line.fixedVp !== undefined && line.tacticalVp !== undefined)
    return `${line.fixedVp} / ${line.tacticalVp} VP`
  if (value === undefined) return ''
  return `${value > 0 && line.join === 'plus' ? '+' : ''}${value} VP${line.cap ? ` (up to ${line.cap})` : ''}${
    line.cumulative ? ' cumulative' : ''
  }`
}

export function Card({ card, meta, mode }: { card: MissionCard; meta?: string; mode?: 'fixed' | 'tactical' }) {
  return (
    <article className="mission">
      <h3>
        {titleCase(card.name)}
        {meta && <span className="chip">{meta}</span>}
      </h3>
      {card.legend && <p className="mission__legend">{card.legend}</p>}
      {card.whenDrawn && (
        <p className="mission__intro">
          <strong>When drawn:</strong> {card.whenDrawn}
        </p>
      )}
      {card.intro.map((t, i) => (
        <p key={i} className="mission__intro">
          {t}
        </p>
      ))}
      {card.actions.map((a) => (
        <div key={a.name} className="mission__action">
          <strong>
            {titleCase(a.name)} <span className="muted">{a.type.toLowerCase()}</span>
          </strong>
          <dl>
            {a.rows.map((r) => (
              <div key={r.label}>
                <dt>{r.label.toLowerCase()}</dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {card.blocks.map((b, i) => (
        <div key={i} className="mission__block">
          <div className="mission__blockHead">
            <strong>{titleCase(b.header)}</strong>
            {b.when && <span className="muted">{b.when}</span>}
          </div>
          <ul>
            {b.lines.map((l, j) => (
              <li key={j} className={l.join ? `mission__line--${l.join}` : ''}>
                {l.join === 'or' && <em>or </em>}
                {l.join === 'plus' && <em>+ </em>}
                <span>{l.text}</span>
                <strong className="mission__vp">{vpLabel(l, mode)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {card.notes.map((n, i) => (
        <p key={i} className="muted mission__note">
          {n}
        </p>
      ))}
    </article>
  )
}
