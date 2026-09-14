import { useMemo } from 'react'
import type { Datasheet, ParsedCatalogue } from '@/data/model'
import type { GameAction } from '@/play/actions'
import { STATUS_LABELS, modelsAlive, modelsTotal, type Game, type GameUnit } from '@/play/types'
import { weaponCounts } from '@/play/weapons'
import { ruleAppliesTo } from '@/roster/detachmentRules'
import { roleKey } from '@/roster/roles'
import { forUnit, stratagemUseKey } from '@/stratagems/select'
import type { Stratagem } from '@/stratagems/types'
import { StatStrip } from './StatStrip'
import { WeaponTable } from './WeaponTable'
import { Marked } from './Marked'
import { discoverMarks, invulnerableFrom, rulesAboutMark } from '@/play/marks'
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
  const granted = detachmentNames.flatMap((name) => {
    const detachment = catalogue?.detachments.find((d) => d.name === name)
    return (detachment?.rules ?? [])
      .filter((r) => ruleAppliesTo(r.text, keywords) !== false)
      .map((rule) => ({ rule, detachmentName: name }))
  })
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
 * The datasheet during play (spec §6.3): stats, the weapons table with the
 * counts the surviving models actually carry, abilities with once-per-battle
 * checkboxes, the detachment's rules that name this unit, the stratagems that
 * can target it, and an attached Leader's sheet merged in below.
 */
export function GameUnitSheet({
  game,
  unit,
  sheets,
  catalogue,
  stratagems,
  dispatch,
  onBack,
}: {
  game: Game
  unit: GameUnit
  sheets: Map<string, Datasheet>
  catalogue: ParsedCatalogue | undefined
  stratagems: Stratagem[]
  dispatch: (action: GameAction) => void
  onBack: () => void
}) {
  const sheet = sheets.get(unit.entryId)
  const leaders = game.units.filter((l) => l.leaderOf === unit.id && !l.destroyed)

  // States the faction's own rules name. Only those this unit can actually be
  // put into, or that change something for it, are offered here.
  const marks = useMemo(() => (catalogue ? discoverMarks(catalogue) : []), [catalogue])
  const unitKeywords = sheet ? [...sheet.keywords, ...sheet.factionKeywords] : []
  const marksHere = catalogue
    ? marks
        .map((mark) => ({ mark, rules: rulesAboutMark(catalogue, mark, unitKeywords, unit.entryId) }))
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
  const single = unit.models.length === 1 && unit.models[0]!.total === 1 ? unit.models[0] : undefined
  const targeting = sheet ? forUnit(stratagems, [...sheet.keywords, ...sheet.factionKeywords]) : []

  return (
    <article className={`sheet game role--${roleKey(sheet?.role)}`}>
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
                  onClick={() => dispatch({ type: 'toggleMark', unitId: unit.id, mark: mark.key, label: mark.label })}
                >
                  {mark.label}
                </button>
              )
            })}
          </div>
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

      {!sheet && (
        <p className="muted">
          The faction data for this unit is not installed on this device, so only the loadout is shown.
        </p>
      )}

      {sheet && (
        <StatStrip
          stats={sheet.stats}
          size="large"
          {...(single ? { wounds: { current: single.currentWounds, total: single.wounds } } : {})}
        />
      )}

      <WeaponTable title="Ranged weapons" rows={rows.filter((r) => r.profile.kind === 'ranged' && r.count > 0)} />
      <WeaponTable title="Melee weapons" rows={rows.filter((r) => r.profile.kind === 'melee' && r.count > 0)} />
      {rows.some((r) => r.count === 0) && (
        // Profiles no surviving model carries — options not taken, or the
        // datasheet's Crusade-only wargear — stay one tap away.
        <details className="config">
          <summary>Other profiles on the datasheet ({rows.filter((r) => r.count === 0).length})</summary>
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

      {targeting.length > 0 && (
        <>
          <h3>Stratagems for this unit</h3>
          <ul className="strats strats--compact">
            {targeting.map((s) => {
              const key = stratagemUseKey(s.id, game.round, game.turn, game.phase)
              const used = Boolean(game.stratagemsUsed?.[key])
              return (
                <li key={s.id} className={`strat ${used ? 'strat--used' : ''}`}>
                  <div className="strat__head">
                    <span className="rule-chip rule-chip--cp">{s.cp} CP</span>
                    <span className="strat__name">{s.name}</span>
                    <span className={`rule-chip ${s.core ? 'rule-chip--core' : 'rule-chip--detachment'}`}>
                      {s.core ? 'Core' : s.detachment}
                    </span>
                  </div>
                  <p className="abilities__text">
                    <Marked text={s.when} />
                  </p>
                  <p className="abilities__text">
                    <b>Effect:</b> <Marked text={s.effect} />
                  </p>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {leaders.map((leader) => {
        const leaderSheet = sheets.get(leader.entryId)
        const leaderWeapons = weaponCounts(leader, leaderSheet)
        const leaderModel = leader.models[0]
        return (
          <section key={leader.id} className="leader">
            <h3 className="leader__head">
              <span className="chip">Leader</span> {leader.name}
            </h3>
            {leaderSheet && (
              <StatStrip
                stats={leaderSheet.stats}
                size="large"
                {...(leaderModel && leaderModel.total === 1
                  ? { wounds: { current: leaderModel.currentWounds, total: leaderModel.wounds } }
                  : {})}
              />
            )}
            <WeaponTable
              title="Ranged weapons"
              rows={leaderWeapons.rows.filter((r) => r.profile.kind === 'ranged' && r.count > 0)}
            />
            <WeaponTable
              title="Melee weapons"
              rows={leaderWeapons.rows.filter((r) => r.profile.kind === 'melee' && r.count > 0)}
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
