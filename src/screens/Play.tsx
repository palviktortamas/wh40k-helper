import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getInstalledCatalogues } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import { graphFor, listRosters, normaliseRoster, validate } from '@/roster/store'
import type { Roster } from '@/roster/types'
import { deleteGame, listGames, newGame, saveGame } from '@/play/store'
import { totalVp, type Game, type MissionState, type Side } from '@/play/types'
import { getMissionDeck } from '@/missions/store'
import type { MissionDeck } from '@/missions/types'
import { MissionSetup } from './MissionSetup'
import './Rosters.css'
import './Game.css'

/**
 * Play tab: continue an active game, start one from a roster, or look back at
 * finished games (spec §6.1). Mission setup (Phase 4) slots in between
 * "start" and the first Command phase later; today a game starts straight
 * into battle round 1.
 */
export function Play() {
  const navigate = useNavigate()
  const [games, setGames] = useState<Game[]>([])
  const [rosters, setRosters] = useState<Roster[]>([])
  const [catalogues, setCatalogues] = useState<CatalogueRecord[]>([])
  const [starting, setStarting] = useState(false)
  const [rosterId, setRosterId] = useState('')
  const [opponentName, setOpponentName] = useState('')
  const [opponentFaction, setOpponentFaction] = useState('')
  const [firstTurn, setFirstTurn] = useState<Side>('me')
  const [deck, setDeck] = useState<MissionDeck | null>(null)
  const [mission, setMission] = useState<MissionState | undefined>(undefined)

  const refresh = useCallback(async () => {
    const [g, r, c, d] = await Promise.all([listGames(), listRosters(), getInstalledCatalogues(), getMissionDeck()])
    setGames(g)
    setRosters(r)
    setCatalogues(c)
    setDeck(d ?? null)
    setRosterId((current) => current || (r[0]?.id ?? ''))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const active = games.filter((g) => g.status === 'active')
  const finished = games.filter((g) => g.status === 'finished')

  const chosen = useMemo(() => {
    const roster = rosters.find((r) => r.id === rosterId)
    const catalogue = roster && catalogues.find((c) => c.id === roster.catalogueId)
    if (!roster || !catalogue) return undefined
    const graph = graphFor(catalogue)
    const normalised = normaliseRoster(roster, graph)
    return { roster: normalised, catalogue, validation: validate(normalised, graph, catalogue.parsed.datasheets) }
  }, [rosterId, rosters, catalogues])

  const start = async () => {
    if (!chosen) return
    const { roster, catalogue, validation } = chosen
    if (!validation.legal) {
      const ok = confirm(
        `"${roster.name}" has ${validation.errors.length} validation error${
          validation.errors.length === 1 ? '' : 's'
        }. Start the game anyway?`,
      )
      if (!ok) return
    }
    const game = await saveGame(
      newGame(roster, catalogue, validation, {
        opponentName,
        opponentFaction,
        firstTurn,
        ...(deck && mission ? { mission } : {}),
      }),
    )
    navigate(`/play/${encodeURIComponent(game.id)}`)
  }

  return (
    <section className="rosters">
      <h2>Play</h2>

      {active.length > 0 && (
        <>
          <h3 className="play__heading">In progress</h3>
          <ul className="rosters__list">
            {active.map((game) => (
              <li key={game.id} className="rosters__card">
                <Link className="rosters__link tap" to={`/play/${encodeURIComponent(game.id)}`}>
                  <span className="rosters__name">
                    {game.rosterName} vs {game.opponentName}
                  </span>
                  <span className="muted">
                    Round {game.round} · {game.turn === 'me' ? 'your' : "opponent's"} turn ·{' '}
                    {totalVp(game.me)}–{totalVp(game.opponent)} VP
                  </span>
                </Link>
                <div className="rosters__cardActions">
                  <button
                    className="button button--quiet button--danger"
                    onClick={async () => {
                      // A game in progress is not history yet, so the warning
                      // says what is actually lost.
                      if (
                        !confirm(
                          `Delete the game "${game.rosterName} vs ${game.opponentName}"? It is still in progress at round ${game.round}, and this cannot be undone.`,
                        )
                      )
                        return
                      await deleteGame(game.id)
                      await refresh()
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {starting ? (
        <div className="rosters__form">
          <label>
            Roster
            <select value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
              {rosters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.pointsLimit} pts
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <p className="muted">
              {chosen.catalogue.name}
              {chosen.validation.detachments.length > 0
                ? ` · ${chosen.validation.detachments.map((d) => d.name).join(' + ')}`
                : ''}{' '}
              ·{' '}
              {chosen.validation.points} pts ·{' '}
              <span className={`badge ${chosen.validation.legal ? 'badge--ok' : 'badge--error'}`}>
                {chosen.validation.legal
                  ? '✓ Legal'
                  : `✕ ${chosen.validation.errors.length} errors`}
              </span>
            </p>
          )}
          <label>
            Opponent
            <input
              value={opponentName}
              onChange={(e) => setOpponentName(e.target.value)}
              placeholder="Name"
            />
          </label>
          <label>
            Opponent's faction
            <input
              value={opponentFaction}
              onChange={(e) => setOpponentFaction(e.target.value)}
              placeholder="Faction (free text)"
            />
          </label>
          <label>
            First turn
            <select value={firstTurn} onChange={(e) => setFirstTurn(e.target.value as Side)}>
              <option value="me">Me</option>
              <option value="opponent">Opponent</option>
            </select>
          </label>
          {deck ? (
            <MissionSetup deck={deck} roster={chosen?.roster} firstTurn={firstTurn} onChange={setMission} />
          ) : (
            <p className="muted">
              No mission deck imported — the game starts without mission cards. Import it under{' '}
              <Link to="/data">Data</Link> to get the setup wizard and scoring.
            </p>
          )}
          <div className="rosters__formActions">
            <button className="button" disabled={!chosen} onClick={() => void start()}>
              Start game
            </button>
            <button className="button button--quiet" onClick={() => setStarting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : rosters.length === 0 ? (
        <p>
          No rosters yet. Build one under <Link to="/rosters">Rosters</Link> first.
        </p>
      ) : (
        <button className="button" onClick={() => setStarting(true)}>
          New game
        </button>
      )}

      {finished.length > 0 && (
        <>
          <h3 className="play__heading">History</h3>
          <ul className="rosters__list">
            {finished.map((game) => (
              <li key={game.id} className="rosters__card">
                <Link className="rosters__link tap" to={`/play/${encodeURIComponent(game.id)}`}>
                  <span className="rosters__name">
                    {game.rosterName} vs {game.opponentName}
                    <span
                      className={`chip ${game.result?.winner === 'me' ? 'chip--ok' : game.result?.winner === 'opponent' ? 'chip--error' : ''}`}
                    >
                      {game.result?.winner === 'me'
                        ? 'Won'
                        : game.result?.winner === 'opponent'
                          ? 'Lost'
                          : 'Draw'}
                    </span>
                  </span>
                  <span className="muted">
                    {game.result?.me ?? totalVp(game.me)}–{game.result?.opponent ?? totalVp(game.opponent)}{' '}
                    VP · {new Date(game.result?.endedAt ?? game.updatedAt).toLocaleDateString()}
                  </span>
                </Link>
                <div className="rosters__cardActions">
                  <button
                    className="button button--quiet"
                    onClick={async () => {
                      if (!confirm('Delete this game from the history?')) return
                      await deleteGame(game.id)
                      await refresh()
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
