import { useEffect, useMemo, useRef, useState } from 'react'
import type { Datasheet, ParsedCatalogue } from '@/data/model'
import type { GameAction } from '@/play/actions'
import { STATUS_LABELS, modelsAlive, modelsTotal, type Game, type GameUnit } from '@/play/types'
import { groupModes, loadoutByModel, weaponCounts } from '@/play/weapons'
import { attachedFamily, detachmentRulesFor, effectsForUnit, situationsForUnit } from '@/play/unitEffects'
import { roleKey } from '@/roster/roles'
import { StatStrip } from './StatStrip'
import { WeaponTable } from './WeaponTable'
import { Marked } from './Marked'
import { scrollToTop } from './scrollToTop'
import { discoverMarks, invulnerableFrom, rulesAboutMark } from '@/play/marks'
import { DURATIONS, describeExpiry } from '@/play/duration'
import './Datasheets.css'
import './Game.css'
import './Units.css'

const ONCE_PER_BATTLE = /once per battle/i

function Abilities({
  unit,
  sheet,
  detachmentNames,
  catalogue,
  dispatch,
}: {
  unit: GameUnit
  sheet: Datasheet
  detachmentNames: readonly string[]
  catalogue: ParsedCatalogue | undefined
  dispatch: (action: GameAction) => void
}) {
  const keywords = [...sheet.keywords, ...sheet.factionKeywords]
  // Rules a detachment grants to units it names — the datasheet does not carry
  // them itself, and every detachment the army took may name this one.
  const granted = detachmentRulesFor(keywords, detachmentNames, catalogue)
  const enhancementText = new Map((catalogue?.enhancements ?? []).map((e) => [e.id, e.text]))

  if (sheet.abilities.length === 0 && granted.length === 0 && (unit.enhancements?.length ?? 0) === 0) return null
  return (
    <ul className="abilities">
      {granted.map(({ rule, detachmentName }) => (
        <li key={rule.id} className="abilities__item">
          <div className="abilities__head">
            {rule.name}
            <span className="rule-chip rule-chip--detachment">{detachmentName}</span>
          </div>
          <p className="abilities__text">
            <Marked text={rule.text} />
          </p>
        </li>
      ))}
      {(unit.enhancements ?? []).map((taken) => {
        const text = enhancementText.get(taken.id) ?? ''
        const once = ONCE_PER_BATTLE.test(`${taken.name} ${text}`)
        const used = unit.usedOnce.includes(taken.id)
        return (
          <li key={taken.id} className={`abilities__item ${used ? 'abilities__item--used' : ''}`}>
            <div className="abilities__head">
              {taken.name}
              <span className="rule-chip rule-chip--enhancement">Enhancement</span>
              {once && <OnceBox unit={unit} id={taken.id} label={taken.name} used={used} dispatch={dispatch} />}
            </div>
            {text && (
              <p className="abilities__text">
                <Marked text={text} />
              </p>
            )}
          </li>
        )
      })}
      {sheet.abilities.map((ability) => {
        const once = ONCE_PER_BATTLE.test(`${ability.name} ${ability.text}`)
        const used = unit.usedOnce.includes(ability.id)
        return (
          <li key={ability.id} className={`abilities__item ${used ? 'abilities__item--used' : ''}`}>
            <div className="abilities__head">
              {ability.name}
              {/* The heading the codex filed it under — "Psychic Abilities" —
                  without which a row called "1-2" says nothing. */}
              {ability.group && <span className="rule-chip rule-chip--group">{ability.group}</span>}
              {ability.kind === 'faction' && <span className="rule-chip rule-chip--core">Core / faction</span>}
              {once && <OnceBox unit={unit} id={ability.id} label={ability.name} used={used} dispatch={dispatch} />}
            </div>
            <p className="abilities__text">
              <Marked text={ability.text || '—'} />
            </p>
          </li>
        )
      })}
    </ul>
  )
}

function OnceBox({
  unit,
  id,
  label,
  used,
  dispatch,
}: {
  unit: GameUnit
  id: string
  label: string
  used: boolean
  dispatch: (action: GameAction) => void
}) {
  return (
    <label className="ability__once">
      <input
        type="checkbox"
        checked={used}
        onChange={() => dispatch({ type: 'toggleOnce', unitId: unit.id, abilityId: id, label })}
      />
      used
    </label>
  )
}

/**
 * The loadout split by model type — and where casualties are taken.
 *
 * Which models died is the question the weapons table above depends on: a mob
 * that has lost one of its two burnas shoots one burna, and counting that by
 * hand in the middle of a phase is exactly the arithmetic the app exists to
 * remove. The − and + sit on the model group that carries the weapons, so the
 * table updates under the thumb that pressed them.
 */
function Loadout({
  groups,
  unitId,
  dispatch,
}: {
  groups: ReturnType<typeof loadoutByModel>
  unitId: string
  dispatch: (action: GameAction) => void
}) {
  return (
    <>
      <h3>Loadout</h3>
      <ul className="loadout">
        {groups.map((group) => (
          <li key={group.id} className={`loadout__group ${group.alive === 0 ? 'loadout__group--gone' : ''}`}>
            <p className="loadout__head">
              <span className="loadout__count">
                {group.alive}
                {group.alive !== group.total && <span className="muted">/{group.total}</span>}×
              </span>{' '}
              {group.name}
              <span className="loadout__casualties">
                <button
                  aria-label={`One ${group.name} destroyed`}
                  disabled={group.alive === 0}
                  onClick={() => dispatch({ type: 'removeModel', unitId, groupId: group.id })}
                >
                  −
                </button>
                <button
                  aria-label={`Bring one ${group.name} back`}
                  disabled={group.alive >= group.total}
                  onClick={() => dispatch({ type: 'addModel', unitId, groupId: group.id })}
                >
                  +
                </button>
              </span>
            </p>
            <ul className="loadout__weapons">
              {/* One line per weapon, its firing modes after it: a two-mode
                  weapon listed as two lines reads as two weapons. */}
              {groupModes(group.rows).map((weapon) => (
                <li key={weapon.modes[0]!.profile.id}>
                  <span
                    className={`loadout__kind loadout__kind--${weapon.modes[0]!.profile.kind}`}
                  >
                    {weapon.modes[0]!.profile.kind === 'ranged' ? 'R' : 'M'}
                  </span>
                  {weapon.count > 1 ? `${weapon.count}× ` : ''}
                  {weapon.name}
                  {weapon.modes.length > 1 && (
                    <span className="loadout__modes">
                      {' '}
                      — {weapon.modes.map((mode) => mode.label).join(' / ')}{' '}
                      <span className="muted">(pick one)</span>
                    </span>
                  )}
                </li>
              ))}
              {group.unmatched.map(([name, count]) => (
                <li key={name} className="muted">
                  <span className="loadout__kind">·</span>
                  {count > 1 ? `${count}× ` : ''}
                  {name}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * The datasheet during play (spec §6.3): stats, the weapons table with the
 * counts the surviving models actually carry, abilities with once-per-battle
 * checkboxes, the detachment's rules that name this unit, and an attached
 * Leader's sheet merged in below.
 *
 * Stratagems are deliberately not here: the phase panel already lists them,
 * and repeating them pushed the stat line — the reason you opened the unit —
 * off the screen.
 */
export function GameUnitSheet({
  game,
  unit,
  sheets,
  catalogue,
  dispatch,
  onBack,
}: {
  game: Game
  unit: GameUnit
  sheets: Map<string, Datasheet>
  catalogue: ParsedCatalogue | undefined
  dispatch: (action: GameAction) => void
  onBack: () => void
}) {
  const sheet = sheets.get(unit.entryId)
  const leaders = game.units.filter((l) => l.leaderOf === unit.id && !l.destroyed)
  // How long a state switched on here lasts, in the rules' own wordings.
  const [lasts, setLasts] = useState('')

  // States the faction's own rules name. Only those this unit can actually be
  // put into, or that change something for it, are offered here.
  const marks = useMemo(() => (catalogue ? discoverMarks(catalogue) : []), [catalogue])
  const unitKeywords = sheet ? [...sheet.keywords, ...sheet.factionKeywords] : []
  const marksHere = catalogue
    ? marks
        .map((mark) => ({
          mark,
          rules: rulesAboutMark(catalogue, mark, unitKeywords, unit.entryId, game.detachmentNames),
        }))
        .filter(({ mark, rules }) => rules.length > 0 || (unit.marks ?? []).includes(mark.key))
    : []
  const activeMarks = marksHere.filter(({ mark }) => (unit.marks ?? []).includes(mark.key))
  // A state can grant a save better than the printed one; that is the change
  // easiest to miss mid-game, so it gets a badge rather than a paragraph.
  const grantedSave = Math.min(
    ...activeMarks.flatMap(({ rules }) =>
      rules.map((r) => invulnerableFrom(r.text)).filter((s): s is number => s !== undefined),
    ),
    99,
  )
  const { rows, unmatched } = weaponCounts(unit, sheet)
  // A mob is several model types at once — which models carry the special
  // weapons is what you need when removing casualties or picking who shoots,
  // and a single counted table never says it.
  // Dead groups stay on this list: it is where a model is put back, and a
  // group that has vanished cannot be healed.
  const loadout = loadoutByModel(unit, sheet, true)
  // A unit and the characters attached to it are one unit: an enhancement that
  // gives "this unit" a 4+ save gives it to all of them.
  const family = attachedFamily(unit, game.units, sheets)
  const { grants, mods } = effectsForUnit({
    unit,
    sheet,
    catalogue,
    detachmentNames: game.detachmentNames,
    marks,
    attached: family,
  })
  // The things that happened to this unit this turn which its own rules react
  // to — and only those, so the row is short enough to be read at the table.
  const situations = situationsForUnit({
    unit,
    sheet,
    catalogue,
    detachmentNames: game.detachmentNames,
    marks,
    attached: family,
  })
  const single = unit.models.length === 1 && unit.models[0]!.total === 1 ? unit.models[0] : undefined
  const usedWeapons = useMemo(() => new Set(unit.usedWeapons ?? []), [unit.usedWeapons])
  const toggleUsed = (weaponId: string, name: string) =>
    dispatch({ type: 'toggleWeaponUsed', unitId: unit.id, weaponId, name })

  // Opening a unit must land on its stat line — the reason you opened it. The
  // army list behind it may be scrolled a long way down, and swapping the
  // rendered component keeps that scroll position.
  const top = useRef<HTMLElement>(null)
  useEffect(() => {
    scrollToTop(top.current)
  }, [unit.id])

  return (
    <article ref={top} className={`sheet game role--${roleKey(sheet?.role)}`}>
      <button className="sheet__back tap" onClick={onBack}>
        ‹ Army
      </button>
      <div className="editor__head">
        <h2>{unit.name}</h2>
        {sheet?.role && <span className="role-tag">{sheet.role}</span>}
      </div>
      <p className="sheet__meta">
        {modelsAlive(unit)}/{modelsTotal(unit)} models · {unit.points} pts
        {unit.isWarlord ? ' · Warlord' : ''}
        {unit.statuses.length > 0 ? ` · ${unit.statuses.map((s) => STATUS_LABELS[s]).join(', ')}` : ''}
        {activeMarks.length > 0 ? ` · ${activeMarks.map(({ mark }) => mark.label).join(', ')}` : ''}
      </p>

      {marksHere.length > 0 && (
        <section className="marks" aria-label="Faction states">
          <div className="marks__row">
            {marksHere.map(({ mark }) => {
              const on = (unit.marks ?? []).includes(mark.key)
              return (
                <button
                  key={mark.key}
                  className={`chip chip--toggle ${on ? 'chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() =>
                    dispatch({
                      type: 'toggleMark',
                      unitId: unit.id,
                      mark: mark.key,
                      label: mark.label,
                      // Switched on here it lasts as long as the player says,
                      // the same choice the reminder panel offers — a state put
                      // on by hand used to be the one that never came off.
                      ...(lasts ? { until: lasts } : {}),
                    })
                  }
                >
                  {mark.label}
                </button>
              )
            })}
            <label className="marks__lasts">
              <span className="muted">lasts</span>
              <select value={lasts} onChange={(e) => setLasts(e.target.value)}>
                {DURATIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* A state the rule gave a time limit comes off by itself; saying
              when means the player can check it against the tracker instead of
              wondering whether the app forgot. */}
          {activeMarks.some(({ mark }) => unit.markUntil?.[mark.key] !== undefined) && (
            <p className="muted marks__until">
              {activeMarks
                .filter(({ mark }) => unit.markUntil?.[mark.key] !== undefined)
                .map(({ mark }) => `${mark.label}: ${describeExpiry(unit.markUntil![mark.key]!, game.firstTurn)}`)
                .join(' · ')}
            </p>
          )}
          {grantedSave < 99 && (
            <p className="marks__save">
              <strong>{grantedSave}+ invulnerable save</strong>{' '}
              <span className="muted">while {activeMarks.map(({ mark }) => mark.label).join(' / ')}</span>
            </p>
          )}
          {activeMarks.flatMap(({ mark, rules }) =>
            rules.map((rule) => (
              <div key={`${mark.key}:${rule.id}`} className="abilities__item marks__rule">
                <div className="abilities__head">
                  {rule.name}
                  <span className="rule-chip rule-chip--attached">{mark.label}</span>
                </div>
                <p className="abilities__text">
                  <Marked text={rule.text} />
                </p>
              </div>
            )),
          )}
        </section>
      )}

      {(unit.inEffect ?? []).length > 0 && (
        <section className="marks" aria-label="In effect now">
          <div className="marks__row">
            <span className="muted marks__lead">In effect</span>
            {(unit.inEffect ?? []).map((rule) => (
              <button
                key={rule.id}
                className="chip chip--toggle chip--on"
                title={`${rule.source} — tap to end it`}
                onClick={() => dispatch({ type: 'clearRule', unitId: unit.id, ruleId: rule.id, name: rule.name })}
              >
                {rule.name} ✕
              </button>
            ))}
          </div>
          {(unit.inEffect ?? []).some((rule) => rule.until !== undefined) && (
            <p className="muted marks__until">
              {(unit.inEffect ?? [])
                .filter((rule) => rule.until !== undefined)
                .map((rule) => `${rule.name}: ${describeExpiry(rule.until!, game.firstTurn)}`)
                .join(' · ')}
            </p>
          )}
        </section>
      )}

      {situations.length > 0 && (
        <section className="marks" aria-label="What happened this turn">
          <div className="marks__row">
            <span className="muted marks__lead">This turn</span>
            {situations.map((situation) => {
              const on = unit.statuses.includes(situation.status)
              return (
                <button
                  key={situation.status}
                  className={`chip chip--toggle ${on ? 'chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => dispatch({ type: 'toggleStatus', unitId: unit.id, status: situation.status })}
                >
                  {situation.label}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {!sheet && (
        <p className="muted">
          The faction data for this unit is not installed on this device, so only the loadout is shown.
        </p>
      )}

      {sheet && (
        <StatStrip
          stats={sheet.stats}
          size="large"
          mods={mods}
          {...(single ? { wounds: { current: single.currentWounds, total: single.wounds } } : {})}
        />
      )}

      {(loadout.length > 1 || modelsTotal(unit) > 1) && (
        <Loadout groups={loadout} unitId={unit.id} dispatch={dispatch} />
      )}

      <WeaponTable
        title="Ranged weapons"
        rows={rows.filter((r) => r.profile.kind === 'ranged' && r.count > 0)}
        grants={grants}
        mods={mods}
        used={usedWeapons}
        onToggleUsed={toggleUsed}
      />
      <WeaponTable
        title="Melee weapons"
        rows={rows.filter((r) => r.profile.kind === 'melee' && r.count > 0)}
        grants={grants}
        mods={mods}
        used={usedWeapons}
        onToggleUsed={toggleUsed}
      />
      {rows.some((r) => r.count === 0) && (
        // The datasheet's other options — weapons this unit can take and did
        // not — stay one tap away.
        <details className="config">
          <summary>Options not taken ({rows.filter((r) => r.count === 0).length})</summary>
          <WeaponTable title="Ranged" rows={rows.filter((r) => r.profile.kind === 'ranged' && r.count === 0)} />
          <WeaponTable title="Melee" rows={rows.filter((r) => r.profile.kind === 'melee' && r.count === 0)} />
        </details>
      )}
      {unmatched.length > 0 && (
        <>
          <h3>Other wargear</h3>
          <ul className="sheet__plain">
            {unmatched.map(([name, count]) => (
              <li key={name}>
                {count}× {name}
              </li>
            ))}
          </ul>
        </>
      )}

      {sheet && (
        <>
          <h3>Abilities</h3>
          <Abilities unit={unit} sheet={sheet} detachmentNames={game.detachmentNames} catalogue={catalogue} dispatch={dispatch} />
        </>
      )}

      {leaders.map((leader) => {
        const leaderSheet = sheets.get(leader.entryId)
        const leaderWeapons = weaponCounts(leader, leaderSheet)
        const leaderEffects = effectsForUnit({
          unit: leader,
          sheet: leaderSheet,
          catalogue,
          detachmentNames: game.detachmentNames,
          marks,
          // …and what the unit it joined has reaches the character in turn,
          // along with whatever the other characters on it bring.
          attached: attachedFamily(leader, game.units, sheets),
        })
        const leaderModel = leader.models[0]
        return (
          <section key={leader.id} className="leader">
            <h3 className="leader__head">
              {/* "Leader" is one kind of attachment among several — a Support
                  character or a codex's Retainers follow different rules. */}
              <span className="chip">{leader.attachedAs ?? 'Leader'}</span> {leader.name}
            </h3>
            {leaderSheet && (
              <StatStrip
                stats={leaderSheet.stats}
                size="large"
                mods={leaderEffects.mods}
                {...(leaderModel && leaderModel.total === 1
                  ? { wounds: { current: leaderModel.currentWounds, total: leaderModel.wounds } }
                  : {})}
              />
            )}
            <WeaponTable
              title="Ranged weapons"
              rows={leaderWeapons.rows.filter((r) => r.profile.kind === 'ranged' && r.count > 0)}
              grants={leaderEffects.grants}
              mods={leaderEffects.mods}
              used={new Set(leader.usedWeapons ?? [])}
              onToggleUsed={(weaponId, name) =>
                dispatch({ type: 'toggleWeaponUsed', unitId: leader.id, weaponId, name })
              }
            />
            <WeaponTable
              title="Melee weapons"
              rows={leaderWeapons.rows.filter((r) => r.profile.kind === 'melee' && r.count > 0)}
              grants={leaderEffects.grants}
              mods={leaderEffects.mods}
              used={new Set(leader.usedWeapons ?? [])}
              onToggleUsed={(weaponId, name) =>
                dispatch({ type: 'toggleWeaponUsed', unitId: leader.id, weaponId, name })
              }
            />
            {leaderSheet && (
              <Abilities unit={leader} sheet={leaderSheet} detachmentNames={game.detachmentNames} catalogue={catalogue} dispatch={dispatch} />
            )}
          </section>
        )
      })}

      {sheet && (
        <>
          <h3>Keywords</h3>
          <p className="sheet__meta">{[...sheet.keywords, ...sheet.factionKeywords].join(', ') || '—'}</p>
        </>
      )}
    </article>
  )
}
