import type { Datasheet, WeaponProfile } from '@/data/model'
import type { GameAction } from '@/play/actions'
import { STATUS_LABELS, modelsAlive, modelsTotal, type Game, type GameUnit } from '@/play/types'
import './Datasheets.css'
import './Game.css'

const STAT_COLUMNS = [
  ['m', 'M'],
  ['t', 'T'],
  ['sv', 'SV'],
  ['w', 'W'],
  ['ld', 'LD'],
  ['oc', 'OC'],
  ['invSv', 'INV'],
] as const

const ONCE_PER_BATTLE = /once per battle/i

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Counts of each weapon the unit's *surviving* models carry, matched to the
 * datasheet's weapon profiles. A loadout name that matches no profile is kept
 * as a plain line rather than dropped.
 */
export function weaponCounts(unit: GameUnit, sheet: Datasheet | undefined) {
  const carried = new Map<string, number>()
  for (const group of unit.models) {
    if (group.alive <= 0) continue
    for (const weapon of group.weapons)
      carried.set(weapon.name, (carried.get(weapon.name) ?? 0) + weapon.perModel * group.alive)
  }
  const matched = new Set<string>()
  const rows: { profile: WeaponProfile; count: number }[] = []
  for (const profile of sheet?.weapons ?? []) {
    const key = normalise(profile.name)
    let count = 0
    for (const [name, n] of carried) {
      const loadout = normalise(name)
      if (loadout === key || loadout.includes(key) || key.includes(loadout)) {
        count += n
        matched.add(name)
      }
    }
    rows.push({ profile, count })
  }
  const unmatched = [...carried.entries()].filter(([name]) => !matched.has(name))
  return { rows, unmatched }
}

function WeaponTable({
  title,
  rows,
}: {
  title: string
  rows: { profile: WeaponProfile; count: number }[]
}) {
  if (rows.length === 0) return null
  const skillLabel = rows[0]!.profile.kind === 'ranged' ? 'BS' : 'WS'
  return (
    <>
      <h3>{title}</h3>
      <div className="sheet__scroll">
        <table className="sheet__table">
          <thead>
            <tr>
              <th scope="col">#</th>
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
            {rows.map(({ profile, count }) => (
              <tr key={profile.id} className={count === 0 ? 'weapon--absent' : ''}>
                <td className="weapon__count">{count > 0 ? `${count}×` : '—'}</td>
                <th scope="row">
                  {profile.name}
                  {profile.keywords.length > 0 && (
                    <span className="sheet__keywords">[{profile.keywords.join(', ')}]</span>
                  )}
                </th>
                <td>{profile.range ?? '—'}</td>
                <td>{profile.a ?? '—'}</td>
                <td>{profile.skill ?? '—'}</td>
                <td>{profile.s ?? '—'}</td>
                <td>{profile.ap ?? '—'}</td>
                <td>{profile.d ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Stats({ sheet }: { sheet: Datasheet }) {
  return (
    <>
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
    </>
  )
}

function Abilities({
  unit,
  sheet,
  dispatch,
}: {
  unit: GameUnit
  sheet: Datasheet
  dispatch: (action: GameAction) => void
}) {
  if (sheet.abilities.length === 0) return null
  return (
    <dl className="sheet__abilities">
      {sheet.abilities.map((ability) => {
        const once = ONCE_PER_BATTLE.test(`${ability.name} ${ability.text}`)
        const used = unit.usedOnce.includes(ability.id)
        return (
          <div key={ability.id} className={used ? 'ability--used' : ''}>
            <dt>
              {ability.name}
              {once && (
                <label className="ability__once">
                  <input
                    type="checkbox"
                    checked={used}
                    onChange={() =>
                      dispatch({ type: 'toggleOnce', unitId: unit.id, abilityId: ability.id, label: ability.name })
                    }
                  />
                  used
                </label>
              )}
            </dt>
            <dd>{ability.text || '—'}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/**
 * The datasheet during play (spec §6.3): stats, the weapons table with the
 * counts the surviving models actually carry, abilities with once-per-battle
 * checkboxes, and an attached Leader's sheet merged in below.
 */
export function GameUnitSheet({
  game,
  unit,
  sheets,
  dispatch,
  onBack,
}: {
  game: Game
  unit: GameUnit
  sheets: Map<string, Datasheet>
  dispatch: (action: GameAction) => void
  onBack: () => void
}) {
  const sheet = sheets.get(unit.entryId)
  const leaders = game.units.filter((l) => l.leaderOf === unit.id && !l.destroyed)
  const { rows, unmatched } = weaponCounts(unit, sheet)

  return (
    <article className="sheet game">
      <button className="sheet__back tap" onClick={onBack}>
        ‹ Army
      </button>
      <h2>{unit.name}</h2>
      <p className="sheet__meta">
        {modelsAlive(unit)}/{modelsTotal(unit)} models · {unit.points} pts
        {unit.isWarlord ? ' · Warlord' : ''}
        {unit.statuses.length > 0 ? ` · ${unit.statuses.map((s) => STATUS_LABELS[s]).join(', ')}` : ''}
      </p>

      {!sheet && (
        <p className="muted">
          The faction data for this unit is not installed on this device, so only the loadout is shown.
        </p>
      )}

      {sheet && <Stats sheet={sheet} />}

      <WeaponTable title="Ranged weapons" rows={rows.filter((r) => r.profile.kind === 'ranged')} />
      <WeaponTable title="Melee weapons" rows={rows.filter((r) => r.profile.kind === 'melee')} />
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
          <Abilities unit={unit} sheet={sheet} dispatch={dispatch} />
        </>
      )}

      {leaders.map((leader) => {
        const leaderSheet = sheets.get(leader.entryId)
        const leaderWeapons = weaponCounts(leader, leaderSheet)
        return (
          <section key={leader.id} className="leader">
            <h3 className="leader__head">
              <span className="chip">Leader</span> {leader.name}
            </h3>
            {leaderSheet && <Stats sheet={leaderSheet} />}
            <WeaponTable
              title="Ranged weapons"
              rows={leaderWeapons.rows.filter((r) => r.profile.kind === 'ranged' && r.count > 0)}
            />
            <WeaponTable
              title="Melee weapons"
              rows={leaderWeapons.rows.filter((r) => r.profile.kind === 'melee' && r.count > 0)}
            />
            {leaderSheet && <Abilities unit={leader} sheet={leaderSheet} dispatch={dispatch} />}
          </section>
        )
      })}

      {sheet && (
        <>
          <h3>Keywords</h3>
          <p className="sheet__meta">{sheet.keywords.join(', ') || '—'}</p>
        </>
      )}
    </article>
  )
}
