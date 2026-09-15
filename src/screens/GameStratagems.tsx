import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { GameAction } from '@/play/actions'
import { PHASE_LABELS, type Game } from '@/play/types'
import { appliesNow, durationOf, forDetachment, stratagemUseKey } from '@/stratagems/select'
import { normaliseName } from '@/data/link/merge'
import type { Stratagem, StratagemSet } from '@/stratagems/types'
import { Marked } from './Marked'
import './Stratagems.css'
import './Units.css'

/**
 * The stratagems a player can use right now (spec §6.3): the Core set plus the
 * chosen detachments', filtered to the current phase and whose turn it is.
 * "Use" spends the CP and marks the stratagem used for this phase — each may
 * be used once per phase (11e Core Rules) — and can be tapped again to take
 * it back. Glanceable: the WHEN line is always visible, the rest one tap away.
 */
export function GameStratagems({
  game,
  set,
  dispatch,
  anchorId,
}: {
  game: Game
  set: StratagemSet | null
  dispatch: (action: GameAction) => void
  /** Id for the game screen's jump rail. */
  anchorId?: string
}) {
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  /** Which unit each stratagem is aimed at, until it is used. */
  const [on, setOn] = useState<Record<string, string>>({})
  const list = useMemo(
    () => (set ? forDetachment(set.stratagems, game.detachmentNames) : []),
    [set, game.detachmentNames],
  )

  const title = `${game.turn === 'me' ? PHASE_LABELS[game.phase] : `Opponent's ${PHASE_LABELS[game.phase]}`} phase`

  if (!set) {
    return (
      <section id={anchorId} className="strats__panel" aria-label="Stratagems">
        <h3 className="play__heading">Stratagems</h3>
        <p className="muted strats__empty">
          Not imported yet — bring in Wahapedia's stratagem export under <Link to="/data">Data</Link> to
          list the Core and detachment stratagems here, by phase, with their CP.
        </p>
      </section>
    )
  }

  const now = list.filter((s) => appliesNow(s, game.phase, game.turn))
  const shown = showAll ? list : now
  const detachmentOnes = shown.filter((s) => !s.core)
  const coreOnes = shown.filter((s) => s.core)

  const row = (s: Stratagem) => {
    const key = stratagemUseKey(s.id, game.round, game.turn, game.phase)
    const used = Boolean(game.stratagemsUsed?.[key])
    const cannotAfford = !used && game.me.cp < s.cp
    const expanded = open === s.id
    const relevant = appliesNow(s, game.phase, game.turn)
    return (
      <li key={s.id} className={`strat ${used ? 'strat--used' : ''} ${relevant ? '' : 'strat--later'}`}>
        <div className="strat__head">
          <span className="rule-chip rule-chip--cp">{s.cp} CP</span>
          {/* Every row expands, including the ones not timed for this phase —
              they are dimmed, not disabled, so they need the same affordance. */}
          <button
            className="strat__name strat__toggle"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} the full rule for ${s.name}`}
            onClick={() => setOpen(expanded ? null : s.id)}
          >
            <span className="strat__chevron" aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
            {s.name}
            {s.category && <span className="muted strat__cat"> · {s.category}</span>}
          </button>
          <button
            className={`button ${used ? 'button--quiet' : ''} strat__use`}
            disabled={cannotAfford}
            title={
              cannotAfford
                ? 'Not enough CP'
                : on[s.id]
                  ? `Use on ${game.units.find((u) => u.id === on[s.id])?.name ?? 'the chosen unit'}`
                  : undefined
            }
            onClick={() => {
              dispatch({ type: 'useStratagem', key, id: s.id, name: s.name, cp: s.cp })
              // Used *on* a unit, its effect belongs to that unit until it
              // ends: +1 Attack is a number the player has to read off the
              // weapons table two minutes later, not a paragraph to remember.
              if (!used && on[s.id]) {
                dispatch({
                  type: 'applyRule',
                  unitId: on[s.id]!,
                  rule: { id: s.id, name: s.name, source: 'Stratagem', text: s.effect },
                  ...(durationOf(s) ? { until: durationOf(s)! } : {}),
                })
              }
            }}
          >
            {used ? 'Used ✓' : on[s.id] ? 'Use on…' : 'Use'}
          </button>
        </div>
        {/* Folded: the target says whether it is worth reading at all, on one
            line. Everything else — when exactly, the effect, which unit it is
            used on — is one tap away, so the list of the phase's stratagems
            fits a screen. */}
        <p className={`strat__when ${expanded ? '' : 'strat__when--folded'}`}>
          {(showAll || !relevant) && (
            <span className="muted">
              {s.turn}
              {' · '}
              {s.phase}
              {s.target ? ' · ' : ''}
            </span>
          )}
          {s.target && (
            <span className="strat__target">
              <Marked text={s.target} />
            </span>
          )}
        </p>
        {expanded && (
          <div className="strat__body">
            <label className="strat__on">
              <span className="muted">Use on</span>
              <select
                value={on[s.id] ?? ''}
                onChange={(e) => setOn((current) => ({ ...current, [s.id]: e.target.value }))}
              >
                <option value="">— no unit —</option>
                {game.units
                  .filter((u) => !u.destroyed)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="abilities__text">
              <b>When:</b> <Marked text={s.when} />
            </p>
            <p className="abilities__text">
              <b>Effect:</b> <Marked text={s.effect} />
            </p>
            {s.restrictions && (
              <p className="abilities__text">
                <b>Restrictions:</b> <Marked text={s.restrictions} />
              </p>
            )}
            {s.legend && (
              <p className="abilities__text strat__legend">
                <Marked text={s.legend} />
              </p>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <section id={anchorId} className="strats__panel" aria-label="Stratagems">
      <div className="reminders__head">
        <h3 className="play__heading">
          Stratagems <span className="muted">— {title}</span>
        </h3>
        <div className="segmented segmented--small" role="group" aria-label="Which stratagems to show">
          <button className={showAll ? '' : 'segmented--on'} aria-pressed={!showAll} onClick={() => setShowAll(false)}>
            Now ({now.length})
          </button>
          <button className={showAll ? 'segmented--on' : ''} aria-pressed={showAll} onClick={() => setShowAll(true)}>
            All ({list.length})
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted strats__empty">No stratagem is timed for this phase.</p>
      ) : (
        <>
          {game.detachmentNames.map((name) => {
            // One heading per detachment: with several taken, "which of mine is
            // this?" has to be answerable at a glance at the table.
            const mine = detachmentOnes.filter((s) => normaliseName(s.detachment) === normaliseName(name))
            if (mine.length === 0) return null
            return (
              <Fragment key={name}>
                <strong className="reminders__owner">{name}</strong>
                <ul className="strats">{mine.map(row)}</ul>
              </Fragment>
            )
          })}
          {coreOnes.length > 0 && (
            <>
              <strong className="reminders__owner">Core</strong>
              <ul className="strats">{coreOnes.map(row)}</ul>
            </>
          )}
        </>
      )}
      {game.detachmentNames.length === 0 && (
        <p className="muted strats__empty">This game has no detachment, so only the Core Stratagems are listed.</p>
      )}
      <p className="muted strats__rules">
        Each Stratagem once per phase · one Stratagem per unit per phase · a Battle-shocked unit cannot be
        the target of your Stratagems (Core Rules).
      </p>
    </section>
  )
}
