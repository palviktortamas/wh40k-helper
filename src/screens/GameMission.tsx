import { useState } from 'react'
import type { GameAction } from '@/play/actions'
import { isBattleOver } from '@/play/actions'
import { SECONDARY_ROUND_CAP, TACTICAL_DRAW, type Game } from '@/play/types'
import { blockApplies, titleCase, type MissionCard, type MissionDeck, type ScoreLine } from '@/missions/types'
import { Card, vpLabel } from './Missions'
import './Missions.css'

/**
 * The mission side of a game (spec §6.2): the primary's scoring assistant for
 * the current round, the Tactical or Fixed secondaries with their own scoring,
 * discards and the once-per-battle redraw, and the setup summary.
 */
export function GameMission({
  game,
  deck,
  dispatch,
}: {
  game: Game
  deck: MissionDeck
  dispatch: (action: GameAction) => void
}) {
  const mission = game.mission!
  const [showOpponent, setShowOpponent] = useState(false)
  const primary = deck.primaries.find((p) => p.id === mission.myPrimaryId)
  const opponentPrimary = deck.primaries.find((p) => p.id === mission.opponentPrimaryId)
  const deployment = deck.deployments.find((d) => d.id === mission.deploymentId)
  const twist = deck.twists.find((t) => t.id === mission.twistId)
  const over = isBattleOver(game)
  const byId = new Map(deck.secondaries.map((s) => [s.id, s]))
  const activeCards = (mission.secondaryMode === 'fixed' ? mission.fixedIds : mission.active)
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
  const room = SECONDARY_ROUND_CAP - mission.secondaryThisRound

  return (
    <section className="gameMission">
      <p className="muted gameMission__setup">
        {mission.myDisposition ?? '—'} vs {mission.opponentDisposition ?? '—'}
        {deployment ? ` · ${titleCase(deployment.name)}` : ''}
        {twist ? ` · Twist: ${titleCase(twist.name)}` : ''}
        {mission.centralObjectives ? ` · ${mission.centralObjectives} central objective${mission.centralObjectives === 2 ? 's' : ''}` : ''}
        {mission.attacker ? ` · You are the ${mission.attacker === 'me' ? 'Attacker' : 'Defender'}` : ''}
      </p>

      {primary && (
        <details className="config" open>
          <summary>
            Primary: {titleCase(primary.name)} <span className="muted">— {game.me.vpPrimary} VP</span>
          </summary>
          {primary.legend && <p className="mission__legend">{primary.legend}</p>}
          {primary.intro.map((t, i) => (
            <p key={i} className="mission__intro">
              {t}
            </p>
          ))}
          {primary.blocks.map((block, bi) => {
            const applies = blockApplies(block.header, game.round, over)
            return (
              <div key={bi} className={`mission__block ${applies ? '' : 'mission__block--off'}`}>
                <div className="mission__blockHead">
                  <strong>{titleCase(block.header)}</strong>
                  {block.when && <span className="muted">{block.when}</span>}
                </div>
                {block.lines.map((line, li) => {
                  const key = `${game.round}:${bi}:${li}`
                  const times = mission.primaryScored[key] ?? 0
                  const vp = line.vp
                  const label = line.text.length > 60 ? `${line.text.slice(0, 57)}…` : line.text
                  return vp === undefined || !applies ? (
                    <p key={li} className="mission__intro muted">
                      {line.join === 'or' ? 'or ' : line.join === 'plus' ? '+ ' : ''}
                      {line.text} {vpLabel(line)}
                    </p>
                  ) : (
                    <div key={li} className="mission__scoreRow">
                      <button
                        className={`mission__score ${times > 0 ? 'mission__score--done' : ''}`}
                        onClick={() => dispatch({ type: 'scorePrimary', key, label, vp })}
                      >
                        <span>
                          {line.join === 'or' ? 'or ' : line.join === 'plus' ? '+ ' : ''}
                          {line.text}
                        </span>
                        <strong className="mission__vp">
                          {times > 0 ? `${times}× ` : ''}
                          {vpLabel(line)}
                        </strong>
                      </button>
                      {times > 0 && (
                        <button
                          className="button button--quiet"
                          aria-label={`Undo one scoring of ${label}`}
                          onClick={() => dispatch({ type: 'unscorePrimary', key, label, vp })}
                        >
                          −
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
          {primary.notes.map((n, i) => (
            <p key={i} className="muted mission__note">
              {n}
            </p>
          ))}
          <CardTracker card={primary} game={game} dispatch={dispatch} />
        </details>
      )}

      {opponentPrimary && (
        <details className="config" open={showOpponent} onToggle={(e) => setShowOpponent((e.target as HTMLDetailsElement).open)}>
          <summary>Opponent's primary: {titleCase(opponentPrimary.name)}</summary>
          <Card card={opponentPrimary} />
        </details>
      )}

      {mission.secondaryMode && (
        <details className="config" open>
          <summary>
            Secondaries ({mission.secondaryMode}) <span className="muted">— {game.me.vpSecondary} VP</span>
          </summary>
          <p className="muted gameMission__deck">
            {mission.secondaryMode === 'tactical'
              ? `Deck ${mission.deck.length} · discarded ${mission.discarded.length} · `
              : ''}
            {room} of {SECONDARY_ROUND_CAP} VP still scoreable this round
          </p>
          {mission.secondaryMode === 'tactical' && (
            <div className="rosters__controls">
              <button className="button" disabled={mission.deck.length === 0} onClick={() => dispatch({ type: 'drawSecondaries' })}>
                Draw {Math.min(TACTICAL_DRAW, mission.deck.length)}
              </button>
              <span className="muted">
                {game.turn === 'me' && game.phase === 'command' ? 'Start of your Command phase: draw two.' : ''}
              </span>
            </div>
          )}
          {activeCards.length === 0 && <p className="muted">No active cards.</p>}
          {activeCards.map((card) => (
            <SecondaryCard key={card.id} card={card} game={game} dispatch={dispatch} />
          ))}
        </details>
      )}
    </section>
  )
}

function SecondaryCard({
  card,
  game,
  dispatch,
}: {
  card: MissionCard & { fixedEligible: boolean }
  game: Game
  dispatch: (action: GameAction) => void
}) {
  const mission = game.mission!
  const mode = mission.secondaryMode ?? 'tactical'
  const tactical = mode === 'tactical'
  const label = titleCase(card.name)
  const value = (line: ScoreLine) => (tactical ? (line.tacticalVp ?? line.vp) : (line.fixedVp ?? line.vp))
  const canShuffleBack = card.whenDrawn ? /shuffle|draw/i.test(card.whenDrawn) : false
  return (
    <article className="mission">
      <h3>
        {label}
        {card.fixedEligible && <span className="chip">Fixed-eligible</span>}
      </h3>
      {card.whenDrawn && (
        <p className="mission__intro">
          <strong>When drawn:</strong> {card.whenDrawn}
          {tactical && canShuffleBack && (
            <>
              {' '}
              <button
                className="button button--quiet"
                onClick={() => dispatch({ type: 'shuffleWhenDrawn', cardId: card.id, label })}
              >
                Shuffle back & redraw
              </button>
            </>
          )}
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
      {card.blocks.map((block, bi) => (
        <div key={bi} className="mission__block">
          <div className="mission__blockHead">
            <strong>{titleCase(block.header)}</strong>
            {block.when && <span className="muted">{block.when}</span>}
          </div>
          {block.lines.map((line, li) => {
            const vp = value(line)
            return vp === undefined ? (
              <p key={li} className="mission__intro muted">
                {line.text}
              </p>
            ) : (
              <button
                key={li}
                className="mission__score"
                onClick={() => dispatch({ type: 'scoreSecondary', cardId: card.id, label, vp, discard: false })}
              >
                <span>
                  {line.join === 'or' ? 'or ' : line.join === 'plus' ? '+ ' : ''}
                  {line.text}
                </span>
                <strong className="mission__vp">+{vp} VP</strong>
              </button>
            )
          })}
        </div>
      ))}
      {card.notes.map((n, i) => (
        <p key={i} className="muted mission__note">
          {n}
        </p>
      ))}
      <CardTracker card={card} game={game} dispatch={dispatch} />
      {tactical && (
        <div className="rosters__controls gameMission__cardActions">
          <button
            className="button button--quiet"
            onClick={() => dispatch({ type: 'scoreSecondary', cardId: card.id, label, vp: 0, discard: true })}
          >
            Achieved — discard
          </button>
          <button className="button button--quiet" onClick={() => dispatch({ type: 'discardSecondary', cardId: card.id, label })}>
            Discard{game.turn === 'me' && !mission.cpForDiscardThisTurn ? ' (+1 CP)' : ''}
          </button>
          {!mission.discardRedrawUsed && game.me.cp > 0 && (
            <button className="button button--quiet" onClick={() => dispatch({ type: 'discardRedraw', cardId: card.id, label })}>
              Discard & redraw (1 CP, once)
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/**
 * What a card asks the player to keep track of (spec §6.2) — markers placed,
 * objectives consecrated or trapped, condemned units, the beacon unit — as a
 * counter that is undoable and a note that is not. Generic on purpose: the
 * cards word these differently and the player knows which one applies.
 */
function CardTracker({
  card,
  game,
  dispatch,
}: {
  card: MissionCard
  game: Game
  dispatch: (action: GameAction) => void
}) {
  const mission = game.mission!
  const count = mission.cardCounters?.[card.id] ?? 0
  const note = mission.cardNotes?.[card.id] ?? ''
  const label = titleCase(card.name)
  return (
    <div className="cardTracker">
      <span className="cardTracker__counter">
        <button
          className="button button--quiet"
          aria-label={`${label}: counter minus one`}
          disabled={count === 0}
          onClick={() => dispatch({ type: 'adjustCardCounter', cardId: card.id, label, delta: -1 })}
        >
          −
        </button>
        <strong aria-live="polite">{count}</strong>
        <button
          className="button button--quiet"
          aria-label={`${label}: counter plus one`}
          onClick={() => dispatch({ type: 'adjustCardCounter', cardId: card.id, label, delta: 1 })}
        >
          +
        </button>
      </span>
      <input
        className="cardTracker__note"
        type="text"
        value={note}
        placeholder="Markers, objectives, units to remember…"
        aria-label={`${label}: note`}
        onChange={(e) => dispatch({ type: 'setCardNote', cardId: card.id, note: e.target.value })}
      />
    </div>
  )
}
