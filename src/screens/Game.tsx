import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCatalogue } from '@/data/worker/client'
import type { CatalogueRecord } from '@/data/db'
import { apply, isBattleOver, type GameAction } from '@/play/actions'
import { getGame, saveGame } from '@/play/store'
import { useWakeLock } from '@/play/useWakeLock'
import {
  LAST_ROUND,
  PHASE_LABELS,
  STATUS_LABELS,
  belowHalfStrength,
  defaultCasualtyGroup,
  inReserves,
  modelsAlive,
  modelsTotal,
  totalVp,
  type Game as GameModel,
  type GameUnit,
  type Side,
  type UnitStatus,
} from '@/play/types'
import { GameUnitSheet } from './GameUnitSheet'
import { GameMission } from './GameMission'
import { GameReminders } from './GameReminders'
import { getOverrides, getRemindersEnabled, setRemindersEnabled } from '@/reminders/store'
import type { ReminderOverride } from '@/reminders/types'
import { getMissionDeck } from '@/missions/store'
import type { MissionDeck } from '@/missions/types'
import { getStratagemSet } from '@/stratagems/store'
import type { StratagemSet } from '@/stratagems/types'
import type { Datasheet } from '@/data/model'
import { roleKey } from '@/roster/roles'
import { scrollParent } from './scrollToTop'
import { GameStratagems } from './GameStratagems'
import { StatStrip } from './StatStrip'
import './Rosters.css'
import './Game.css'
import './Units.css'

const STATUSES: UnitStatus[] = ['battleShocked', 'advanced', 'fellBack', 'reserves', 'deepStrike', 'embarked']

/**
 * The table screen (spec §6.2–6.3): round and phase tracker, CP/VP for both
 * players, and the army view with per-model wound tracking. Every change goes
 * through `apply`, so undo and the log come for free.
 */
/**
 * The jump rail: a table-side game screen is long — tracker, reminders,
 * mission, stratagems, then every unit — and a phone scrolls it a screen at a
 * time. The rail stays put and puts each part one tap away. Labelled, not
 * coloured dots: it has to be readable at a glance across a table.
 */
function JumpRail({ targets }: { targets: { id: string; label: string; name: string }[] }) {
  if (targets.length < 2) return null
  return (
    <nav className="jump" aria-label="Jump to a part of this game">
      {targets.map((target) => (
        <button
          key={target.id}
          className="jump__btn tap"
          aria-label={`Jump to ${target.name}`}
          onClick={() => document.getElementById(target.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {target.label}
        </button>
      ))}
    </nav>
  )
}

export function Game() {
  const { gameId } = useParams<{ gameId: string }>()
  const [game, setGame] = useState<GameModel | null>(null)
  const [catalogue, setCatalogue] = useState<CatalogueRecord | null>(null)
  const [openUnit, setOpenUnit] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [deck, setDeck] = useState<MissionDeck | null>(null)
  const [overrides, setOverrides] = useState<Map<string, ReminderOverride>>(new Map())
  const [remindersOn, setRemindersOn] = useState(true)
  const [stratagemSet, setStratagemSet] = useState<StratagemSet | null>(null)
  const shell = useRef<HTMLElement>(null)
  /** Where the army list was when a unit was opened, so closing it comes back there. */
  const listScroll = useRef<number | null>(null)

  useEffect(() => {
    if (!gameId) return
    void getGame(gameId).then(async (g) => {
      setGame(g ?? null)
      if (g) setCatalogue((await getCatalogue(g.catalogueId)) ?? null)
      if (g?.mission) setDeck((await getMissionDeck()) ?? null)
    })
    void getOverrides().then(setOverrides)
    void getRemindersEnabled().then(setRemindersOn)
    void getStratagemSet().then((s) => setStratagemSet(s ?? null))
  }, [gameId])

  const toggleReminders = useCallback(() => {
    setRemindersOn((on) => {
      void setRemindersEnabled(!on)
      return !on
    })
  }, [])

  useWakeLock(game?.status === 'active')

  const dispatch = useCallback((action: GameAction) => {
    setGame((current) => {
      if (!current) return current
      const next = apply(current, action)
      if (next !== current) void saveGame(next)
      return next
    })
  }, [])

  // Opening a unit swaps the whole screen, so the list's scroll position is
  // remembered by hand: coming back to the top of a twenty-unit army after
  // every look at a datasheet is the kind of thing that loses a turn.
  const openUnitSheet = useCallback((id: string) => {
    listScroll.current = scrollParent(shell.current)?.scrollTop ?? 0
    setOpenUnit(id)
  }, [])

  useLayoutEffect(() => {
    if (openUnit !== null || listScroll.current === null) return
    const scroller = scrollParent(shell.current)
    if (scroller) scroller.scrollTop = listScroll.current
    listScroll.current = null
  }, [openUnit])

  const sheets = useMemo(
    () => new Map((catalogue?.parsed.datasheets ?? []).map((d) => [d.id, d])),
    [catalogue],
  )

  if (!game) return <p>Loading…</p>

  if (openUnit) {
    const unit = game.units.find((u) => u.id === openUnit)
    if (unit) {
      return (
        <GameUnitSheet
          game={game}
          unit={unit}
          sheets={sheets}
          catalogue={catalogue?.parsed}
          dispatch={dispatch}
          onBack={() => setOpenUnit(null)}
        />
      )
    }
  }

  if (game.status === 'finished') return <Summary game={game} dispatch={dispatch} />

  const leadersOf = new Map<string, GameUnit[]>()
  for (const unit of game.units) {
    if (!unit.leaderOf) continue
    leadersOf.set(unit.leaderOf, [...(leadersOf.get(unit.leaderOf) ?? []), unit])
  }
  const exists = (id: string | undefined) => Boolean(id) && game.units.some((t) => t.id === id)
  const passengersOf = new Map<string, GameUnit[]>()
  for (const unit of game.units) {
    if (!unit.embarkedIn || !exists(unit.embarkedIn) || exists(unit.leaderOf)) continue
    passengersOf.set(unit.embarkedIn, [...(passengersOf.get(unit.embarkedIn) ?? []), unit])
  }
  // Leaders ride with their unit; embarked units ride inside their transport.
  const topLevel = game.units.filter((u) => !exists(u.leaderOf) && !(u.embarkedIn && exists(u.embarkedIn)))
  const over = isBattleOver(game)

  const renderUnit = (unit: GameUnit, leader = false) => (
    <>
      <UnitCard unit={unit} sheet={sheets.get(unit.entryId)} game={game} dispatch={dispatch} onOpen={() => openUnitSheet(unit.id)} leader={leader} />
      {(leadersOf.get(unit.id) ?? []).map((l) => (
        <div key={l.id} className={`unit__leader role-stripe role--${roleKey(sheets.get(l.entryId)?.role)} ${l.destroyed ? 'unit--dead' : ''}`}>
          <UnitCard unit={l} sheet={sheets.get(l.entryId)} game={game} dispatch={dispatch} onOpen={() => openUnitSheet(l.id)} leader />
        </div>
      ))}
    </>
  )

  const jumpTargets = [
    { id: 'game-turn', label: 'Turn', name: 'the battle round and phase' },
    ...(catalogue ? [{ id: 'game-reminders', label: 'Cues', name: 'the reminders for this phase' }] : []),
    ...(game.mission && deck ? [{ id: 'game-mission', label: 'Miss', name: 'the mission' }] : []),
    ...(stratagemSet ? [{ id: 'game-strats', label: 'Strat', name: 'the stratagems' }] : []),
    { id: 'game-army', label: 'Army', name: 'the army list' },
  ]

  return (
    <section className="game" ref={shell}>
      <JumpRail targets={jumpTargets} />
      <Link className="sheet__back tap" to="/play">
        ‹ Play
      </Link>

      <header className="game__head">
        <div>
          <h2>
            {game.rosterName} <span className="muted">vs {game.opponentName}</span>
          </h2>
          <p className="muted game__meta">
            {game.factionName}
            {game.detachmentNames.length > 0 ? ` · ${game.detachmentNames.join(' + ')}` : ''}
            {game.startedIllegal ? ' · started with validation errors' : ''}
          </p>
        </div>
      </header>

      <div id="game-turn" className={`tracker ${game.turn === 'me' ? 'tracker--me' : 'tracker--them'}`}>
        <div className="tracker__round">
          <span className="tracker__label">Battle round</span>
          <strong>
            {Math.min(game.round, LAST_ROUND)} / {LAST_ROUND}
          </strong>
        </div>
        <div className="tracker__phase">
          <span className="tracker__label">{game.turn === 'me' ? 'Your turn' : `${game.opponentName}'s turn`}</span>
          <strong>{PHASE_LABELS[game.phase]} phase</strong>
        </div>
        <div className="tracker__nav">
          <button
            className="button button--quiet tracker__btn"
            onClick={() => dispatch({ type: 'prevPhase' })}
            disabled={game.round === 1 && game.turn === game.firstTurn && game.phase === 'command'}
            aria-label="Previous phase"
          >
            ‹ Prev
          </button>
          {over ? (
            <button className="button tracker__btn" onClick={() => dispatch({ type: 'endGame' })}>
              End game
            </button>
          ) : (
            <button className="button tracker__btn" onClick={() => dispatch({ type: 'nextPhase' })} aria-label="Next phase">
              Next ›
            </button>
          )}
        </div>
      </div>

      <div className="score">
        <ScoreColumn label="You" side="me" game={game} dispatch={dispatch} />
        <ScoreColumn label={game.opponentName} side="opponent" game={game} dispatch={dispatch} />
      </div>

      <div className="rosters__controls game__tools">
        <button
          className="button button--quiet"
          disabled={game.undo.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
        >
          ↶ Undo
        </button>
        <button className="button button--quiet" onClick={() => setShowLog((s) => !s)}>
          {showLog ? 'Hide log' : `Log (${game.log.length})`}
        </button>
        {!over && (
          <button
            className="button button--quiet"
            onClick={() => {
              if (confirm('End the game now and record the result?')) dispatch({ type: 'endGame' })
            }}
          >
            End game
          </button>
        )}
      </div>

      {showLog && (
        <ol className="log">
          {[...game.log].reverse().map((entry, i) => (
            <li key={i}>
              <span className="muted">
                R{entry.round} {PHASE_LABELS[entry.phase].slice(0, 3)}
              </span>{' '}
              {entry.text}
            </li>
          ))}
        </ol>
      )}

      {catalogue && (
        <BattleShockStep game={game} sheets={sheets} dispatch={dispatch} />
      )}

      {catalogue && (
        <GameReminders
          anchorId="game-reminders"
          game={game}
          catalogue={catalogue.parsed}
          overrides={overrides}
          enabled={remindersOn}
          onToggleEnabled={toggleReminders}
          dispatch={dispatch}
        />
      )}

      {game.mission && deck && (
        <>
          <h3 id="game-mission" className="play__heading">Mission</h3>
          <GameMission game={game} deck={deck} dispatch={dispatch} />
        </>
      )}

      <GameStratagems game={game} set={stratagemSet} dispatch={dispatch} anchorId="game-strats" />

      <h3 id="game-army" className="play__heading">
        Army{' '}
        <span className="muted">
          — {game.units.filter((u) => !u.destroyed).length} of {game.units.length} units standing
        </span>
      </h3>
      <ul className="units">
        {topLevel.map((unit) => (
          <li
            key={unit.id}
            className={`units__item unit role-stripe role--${roleKey(sheets.get(unit.entryId)?.role)} ${unit.destroyed ? 'unit--dead' : ''}`}
          >
            {renderUnit(unit)}
            {(passengersOf.get(unit.id) ?? []).map((passenger) => (
              <div key={passenger.id} className={`unit__leader unit__passenger ${passenger.destroyed ? 'unit--dead' : ''}`}>
                <p className="muted unit__aboard">Embarked</p>
                {renderUnit(passenger)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ScoreColumn({
  label,
  side,
  game,
  dispatch,
}: {
  label: string
  side: Side
  game: GameModel
  dispatch: (action: GameAction) => void
}) {
  const score = game[side]
  return (
    <div className={`score__col ${game.turn === side ? 'score__col--active' : ''}`}>
      <h3>{label}</h3>
      <Counter
        label="CP"
        value={score.cp}
        onChange={(delta) => dispatch({ type: 'adjustCp', side, delta })}
      />
      <Counter
        label="Primary"
        value={score.vpPrimary}
        onChange={(delta) => dispatch({ type: 'adjustVp', side, kind: 'primary', delta })}
      />
      <Counter
        label="Secondary"
        value={score.vpSecondary}
        onChange={(delta) => dispatch({ type: 'adjustVp', side, kind: 'secondary', delta })}
      />
      <p className="score__total">
        <span className="tracker__label">Total VP</span>
        <strong>{totalVp(score)}</strong>
      </p>
    </div>
  )
}

function Counter({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (delta: number) => void
}) {
  return (
    <div className="counter">
      <span className="counter__label">{label}</span>
      <div className="stepper">
        <button aria-label={`${label} minus one`} onClick={() => onChange(-1)}>
          −
        </button>
        <span className="stepper__value">{value}</span>
        <button aria-label={`${label} plus one`} onClick={() => onChange(1)}>
          +
        </button>
      </div>
    </div>
  )
}

/**
 * The Battle-shock step of your Command phase (11e Core Rules): units below
 * half-strength, and units already Battle-shocked, take a Battle-shock test.
 * Listed with their Leadership so the roll needs no datasheet lookup; tapping
 * records the result as the unit's status.
 */
function BattleShockStep({
  game,
  sheets,
  dispatch,
}: {
  game: GameModel
  sheets: Map<string, Datasheet>
  dispatch: (action: GameAction) => void
}) {
  if (game.turn !== 'me' || game.phase !== 'command') return null
  const testing = game.units.filter(
    (u) => !u.destroyed && !inReserves(u) && (belowHalfStrength(u) || u.statuses.includes('battleShocked')),
  )
  return (
    <section className="shock" aria-label="Battle-shock step">
      <h3 className="play__heading">
        Battle-shock step{' '}
        <span className="muted">— {testing.length === 0 ? 'no tests this turn' : `${testing.length} to test`}</span>
      </h3>
      {testing.length > 0 && (
        <ul className="shock__list">
          {testing.map((u) => {
            const shocked = u.statuses.includes('battleShocked')
            const ld = sheets.get(u.entryId)?.stats[0]?.ld
            return (
              <li key={u.id} className="shock__row">
                <span className="shock__unit">
                  <strong>{u.name}</strong>
                  <span className="muted">
                    {' '}
                    {modelsAlive(u)}/{modelsTotal(u)} models{ld ? ` · Ld ${ld}` : ''}
                    {shocked ? ' · currently Battle-shocked' : ' · below half-strength'}
                  </span>
                </span>
                <span className="shock__actions">
                  <button
                    className={`chip chip--button ${shocked ? 'chip--on' : ''}`}
                    aria-pressed={shocked}
                    onClick={() => dispatch({ type: 'toggleStatus', unitId: u.id, status: 'battleShocked' })}
                  >
                    {shocked ? 'Failed — shocked' : 'Failed'}
                  </button>
                  {shocked && (
                    <button
                      className="chip chip--button"
                      onClick={() => dispatch({ type: 'toggleStatus', unitId: u.id, status: 'battleShocked' })}
                    >
                      Passed
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function UnitCard({
  unit,
  sheet,
  game,
  dispatch,
  onOpen,
  leader = false,
}: {
  unit: GameUnit
  sheet: Datasheet | undefined
  game: GameModel
  dispatch: (action: GameAction) => void
  onOpen: () => void
  leader?: boolean
}) {
  // Units this transport could carry: anything alive, not a leader (they ride
  // with their unit), not already aboard something, not itself.
  const candidates = unit.transportCapacity
    ? game.units.filter(
        (u) =>
          u.id !== unit.id &&
          !u.destroyed &&
          !u.leaderOf &&
          !u.transportCapacity &&
          (!u.embarkedIn || u.embarkedIn === unit.id),
      )
    : []
  const [expanded, setExpanded] = useState(false)
  const alive = modelsAlive(unit)
  const total = modelsTotal(unit)
  const living = unit.models.filter((g) => g.alive > 0)
  const single = living.length === 1 ? living[0] : undefined
  const fallen = single ? undefined : defaultCasualtyGroup(unit)
  // The damaged profile applies once the (single) model is at or below the threshold.
  const damaged =
    unit.damagedAt !== undefined &&
    !unit.destroyed &&
    unit.models.some((g) => g.alive === 1 && g.total === 1 && g.currentWounds <= unit.damagedAt!)

  return (
    <div className="unit__body">
      <button className="units__main" onClick={onOpen}>
        <span className="units__name">
          {leader && <span className="chip">Leader</span>}
          {unit.name}
          {unit.isWarlord && <span className="chip">Warlord</span>}
          {unit.destroyed && <span className="chip chip--error">✕ Destroyed</span>}
          {damaged && <span className="chip chip--warn">⚠ Damaged</span>}
        </span>
        {sheet && !unit.destroyed && (
          <StatStrip
            stats={sheet.stats}
            firstOnly
            {...(single && single.total === 1 ? { wounds: { current: single.currentWounds, total: single.wounds } } : {})}
          />
        )}
        <span className="unit__stats">
          <span>
            <strong>{alive}</strong>/{total} models
          </span>
          {living.map((g) =>
            g.wounds > 1 ? (
              <span key={g.id}>
                {living.length > 1 ? `${g.name}: ` : ''}
                <strong>{g.currentWounds}</strong>/{g.wounds} W
              </span>
            ) : null,
          )}
        </span>
        {unit.statuses.length > 0 && (
          <span className="unit__chips">
            {unit.statuses.map((s) => (
              <span key={s} className="chip chip--status">
                {STATUS_LABELS[s]}
              </span>
            ))}
          </span>
        )}
      </button>

      {!unit.destroyed && (
        <div className="unit__quick">
          {single ? (
            <>
              <button
                className="button button--quiet"
                onClick={() => dispatch({ type: 'removeModel', unitId: unit.id, groupId: single.id })}
              >
                −1 model
              </button>
              {single.wounds > 1 && (
                <button
                  className="button button--quiet"
                  onClick={() => dispatch({ type: 'damage', unitId: unit.id, groupId: single.id, amount: 1 })}
                >
                  −1 W
                </button>
              )}
            </>
          ) : (
            <>
              {/* Spec §6.3 default order: plain models first, the unit's character last. */}
              {fallen && (
                <button
                  className="button button--quiet"
                  title={`Removes one ${fallen.name}`}
                  onClick={() => dispatch({ type: 'removeModel', unitId: unit.id, groupId: fallen.id })}
                >
                  −1{' '}
                  <span className="muted unit__quickWho">{fallen.name}</span>
                </button>
              )}
              <button className="button button--quiet" onClick={() => setExpanded((e) => !e)}>
                {expanded ? 'Done' : 'Remove models…'}
              </button>
            </>
          )}
          {inReserves(unit) && (
            <button className="button button--quiet" onClick={() => dispatch({ type: 'arrive', unitId: unit.id })}>
              Arrive
            </button>
          )}
          {unit.embarkedIn && (
            <button className="button button--quiet" onClick={() => dispatch({ type: 'disembark', unitId: unit.id })}>
              Disembark
            </button>
          )}
          <button className="button button--quiet" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Less' : 'More…'}
          </button>
        </div>
      )}

      {!unit.destroyed && unit.transportCapacity && (
        <label className="units__attach">
          Embark a unit{' '}
          <span className="muted unit__capacity">{unit.transportCapacity.replace(/\*\*/g, '')}</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) dispatch({ type: 'embark', unitId: e.target.value, transportId: unit.id })
            }}
          >
            <option value="">— choose a unit —</option>
            {candidates
              .filter((c) => c.embarkedIn !== unit.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      )}

      {expanded && (
        <div className="unit__more">
          {/* Which model died matters: the weapons table follows the survivors. */}
          <ul className="models">
            {unit.models.map((g) => (
              <li key={g.id} className="models__row">
                <span className="models__name">
                  {g.name}
                  <span className="muted">
                    {' '}
                    {g.alive}/{g.total}
                    {g.wounds > 1 && g.alive > 0 ? ` · ${g.currentWounds}/${g.wounds} W` : ''}
                  </span>
                </span>
                <span className="models__actions">
                  <button
                    aria-label={`Remove one ${g.name}`}
                    disabled={g.alive === 0}
                    onClick={() => dispatch({ type: 'removeModel', unitId: unit.id, groupId: g.id })}
                  >
                    −1
                  </button>
                  {g.wounds > 1 && (
                    <>
                      <button
                        aria-label={`One wound to ${g.name}`}
                        disabled={g.alive === 0}
                        onClick={() => dispatch({ type: 'damage', unitId: unit.id, groupId: g.id, amount: 1 })}
                      >
                        −1 W
                      </button>
                      <button
                        aria-label={`Heal one wound on ${g.name}`}
                        disabled={g.alive === 0 || g.currentWounds >= g.wounds}
                        onClick={() => dispatch({ type: 'healModel', unitId: unit.id, groupId: g.id, amount: 1 })}
                      >
                        +1 W
                      </button>
                    </>
                  )}
                  <button
                    aria-label={`Return one ${g.name}`}
                    disabled={g.alive >= g.total}
                    onClick={() => dispatch({ type: 'addModel', unitId: unit.id, groupId: g.id })}
                  >
                    +1
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="unit__chips unit__toggles">
            {STATUSES.map((status) => {
              const on = unit.statuses.includes(status)
              return (
                <button
                  key={status}
                  className={`chip chip--button ${on ? 'chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => dispatch({ type: 'toggleStatus', unitId: unit.id, status })}
                >
                  {on ? '✓ ' : ''}
                  {STATUS_LABELS[status]}
                </button>
              )
            })}
          </div>
          <div className="rosters__controls">
            {unit.destroyed ? (
              <button className="button button--quiet" onClick={() => dispatch({ type: 'revive', unitId: unit.id })}>
                Revive at full strength
              </button>
            ) : (
              <button className="button button--quiet" onClick={() => dispatch({ type: 'destroy', unitId: unit.id })}>
                Mark destroyed
              </button>
            )}
          </div>
        </div>
      )}
      {unit.destroyed && !expanded && (
        <div className="unit__quick">
          <button className="button button--quiet" onClick={() => dispatch({ type: 'revive', unitId: unit.id })}>
            Revive
          </button>
        </div>
      )}
    </div>
  )
}

function Summary({ game, dispatch }: { game: GameModel; dispatch: (action: GameAction) => void }) {
  const result = game.result
  const rounds = Object.keys(game.vpByRound)
    .map(Number)
    .sort((a, b) => a - b)
  const destroyed = game.units.filter((u) => u.destroyed)
  return (
    <section className="game">
      <Link className="sheet__back tap" to="/play">
        ‹ Play
      </Link>
      <h2>
        {result?.winner === 'me' ? 'Victory' : result?.winner === 'opponent' ? 'Defeat' : 'Draw'}
      </h2>
      <p className="muted">
        {game.rosterName} vs {game.opponentName}
        {game.opponentFaction ? ` (${game.opponentFaction})` : ''} · ended{' '}
        {new Date(result?.endedAt ?? game.updatedAt).toLocaleString()}
      </p>
      <p className="summary__score">
        <strong>{result?.me ?? totalVp(game.me)}</strong> – <strong>{result?.opponent ?? totalVp(game.opponent)}</strong> VP
      </p>

      <div className="sheet__scroll">
        <table className="sheet__table sheet__table--stats">
          <thead>
            <tr>
              <th scope="col">Round</th>
              {rounds.map((r) => (
                <th key={r} scope="col">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">You</th>
              {rounds.map((r) => (
                <td key={r}>{game.vpByRound[r]?.me}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">{game.opponentName}</th>
              {rounds.map((r) => (
                <td key={r}>{game.vpByRound[r]?.opponent}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Your army</h3>
      <p className="muted">
        {game.units.length - destroyed.length} of {game.units.length} units survived
        {destroyed.length > 0 ? ` — lost: ${destroyed.map((u) => u.name).join(', ')}` : ''}.
      </p>

      <div className="rosters__controls">
        <button className="button button--quiet" onClick={() => dispatch({ type: 'undo' })}>
          ↶ Reopen game
        </button>
      </div>

      <details className="config">
        <summary>Game log ({game.log.length})</summary>
        <ol className="log">
          {game.log.map((entry, i) => (
            <li key={i}>
              <span className="muted">
                R{entry.round} {PHASE_LABELS[entry.phase].slice(0, 3)}
              </span>{' '}
              {entry.text}
            </li>
          ))}
        </ol>
      </details>
    </section>
  )
}
