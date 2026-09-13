import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { GameAction } from '@/play/actions'
import { PHASE_LABELS, type Game } from '@/play/types'
import { appliesNow, forDetachment, stratagemUseKey } from '@/stratagems/select'
import type { Stratagem, StratagemSet } from '@/stratagems/types'
import { Marked } from './Marked'
import './Stratagems.css'
import './Units.css'

/**
 * The stratagems a player can use right now (spec §6.3): the Core set plus the
 * chosen detachment's, filtered to the current phase and whose turn it is.
 * "Use" spends the CP and marks the stratagem used for this phase — each may
 * be used once per phase (11e Core Rules) — and can be tapped again to take
 * it back. Glanceable: the WHEN line is always visible, the rest one tap away.
 */
export function GameStratagems({
  game,
  set,
  dispatch,
}: {
  game: Game
  set: StratagemSet | null
  dispatch: (action: GameAction) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const list = useMemo(() => (set ? forDetachment(set.stratagems, game.detachmentName) : []), [set, game.detachmentName])

  const title = `${game.turn === 'me' ? PHASE_LABELS[game.phase] : `Opponent's ${PHASE_LABELS[game.phase]}`} phase`

  if (!set) {
    return (
      <section className="strats__panel" aria-label="Stratagems">
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
          <button className="strat__name strat__toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.id)}>
            {s.name}
            {s.category && <span className="muted strat__cat"> · {s.category}</span>}
          </button>
          <button
            className={`button ${used ? 'button--quiet' : ''} strat__use`}
            disabled={cannotAfford}
            title={cannotAfford ? 'Not enough CP' : undefined}
            onClick={() => dispatch({ type: 'useStratagem', key, id: s.id, name: s.name, cp: s.cp })}
          >
            {used ? 'Used ✓' : 'Use'}
          </button>
        </div>
        <p className="strat__when">
          <span className="muted">
            {s.turn}
            {' · '}
            {s.phase}
          </span>
        </p>
        <p className="abilities__text strat__line">
          <Marked text={s.when} />
        </p>
        {expanded && (
          <div className="strat__body">
            {s.target && (
              <p className="abilities__text">
                <b>Target:</b> <Marked text={s.target} />
              </p>
            )}
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
    <section className="strats__panel" aria-label="Stratagems">
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
          {detachmentOnes.length > 0 && (
            <>
              <strong className="reminders__owner">{game.detachmentName ?? 'Detachment'}</strong>
              <ul className="strats">{detachmentOnes.map(row)}</ul>
            </>
          )}
          {coreOnes.length > 0 && (
            <>
              <strong className="reminders__owner">Core</strong>
              <ul className="strats">{coreOnes.map(row)}</ul>
            </>
          )}
        </>
      )}
      {!game.detachmentName && (
        <p className="muted strats__empty">This game has no detachment, so only the Core Stratagems are listed.</p>
      )}
      <p className="muted strats__rules">
        Each Stratagem once per phase · one Stratagem per unit per phase · a Battle-shocked unit cannot be
        the target of your Stratagems (Core Rules).
      </p>
    </section>
  )
}
