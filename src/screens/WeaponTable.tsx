import { groupModes, type WeaponRow } from '@/play/weapons'
import { grantsFor, type WeaponGrant } from '@/play/grants'
import { applyMod, modsFor, type StatMod } from '@/play/mods'
import { ModList } from './StatStrip'
import './Datasheets.css'

/**
 * One characteristic cell. A change already in force changes the number; one
 * still waiting on a condition leaves it alone and marks it — the number a
 * player reads has to be the one they would roll against right now.
 */
function Cell({ value, mods }: { value: string | undefined; mods: readonly StatMod[] }) {
  const applied = applyMod(value, mods)
  const title = applied.pending
    .map((mod) => `${mod.value} ${mod.stat} ${mod.when ?? ''} (${mod.rule})`.trim())
    .join('; ')
  return (
    <td
      className={applied.changed ? (applied.temporary ? 'value--temporary' : 'value--changed') : ''}
      {...(title ? { title } : {})}
    >
      {applied.value}
      {applied.changed && applied.temporary ? '*' : ''}
      {!applied.changed && applied.pending.length > 0 && <span className="value--maybe">*</span>}
    </td>
  )
}

/** A grant that is in force right now — unconditional, or its condition met. */
const live = (grant: WeaponGrant): boolean => !grant.when || grant.met === true

/**
 * One weapons table (ranged or melee) with the count column in front.
 *
 * `grants` are the weapon abilities the army's rules add to these weapons —
 * the datasheet never prints them, and a weapon read without them is a weaker
 * weapon than the one being rolled. Abilities that hold only under a condition
 * ("if this unit made a charge move this turn") are shown differently and
 * spelled out under the table, so the table itself never claims more than is
 * true.
 */
export function WeaponTable({
  title,
  rows,
  showCount = true,
  grants = [],
  mods = [],
  used,
  onToggleUsed,
}: {
  title: string
  rows: WeaponRow[]
  showCount?: boolean
  grants?: readonly WeaponGrant[]
  /** Characteristics the army's rules change on these weapons. */
  mods?: readonly StatMod[]
  /**
   * Weapons already used this turn, by profile id — at the table only. A mob
   * with four different guns is four things to remember in the middle of a
   * phase, and remembering is what this app is for.
   */
  used?: ReadonlySet<string>
  onToggleUsed?: (weaponId: string, name: string) => void
}) {
  if (rows.length === 0) return null
  const kind = rows[0]!.profile.kind
  const skillLabel = kind === 'ranged' ? 'BS' : 'WS'
  // One ability, however many rules grant it: a live grant wins over a
  // conditional one, so a weapon never carries the same ability twice.
  const here: WeaponGrant[] = []
  for (const grant of grantsFor(grants, kind)) {
    const at = here.findIndex((g) => g.keyword === grant.keyword)
    if (at === -1) here.push(grant)
    else if (live(grant) && !live(here[at]!)) here[at] = grant
  }
  const conditional = here.filter((g) => !live(g))
  const modsHere = mods.filter((mod) => mod.target === kind || mod.target === 'any')
  // A weapon with several firing modes is one weapon, carried once.
  const groups = groupModes(rows)
  return (
    <>
      <h3>{title}</h3>
      <div className="sheet__scroll">
        <table className="sheet__table">
          <thead>
            <tr>
              {showCount && <th scope="col">#</th>}
              <th scope="col">Weapon</th>
              <th scope="col">Range</th>
              <th scope="col">A</th>
              <th scope="col">{skillLabel}</th>
              <th scope="col">S</th>
              <th scope="col">AP</th>
              <th scope="col">D</th>
            </tr>
          </thead>
          {groups.map((weapon) => {
          const isUsed = Boolean(used?.has(weapon.modes[0]!.profile.id))
          return (
          <tbody
            key={weapon.modes[0]!.profile.id}
            className={`${weapon.modes.length > 1 ? 'weapon-group' : ''} ${isUsed ? 'weapon-group--used' : ''}`}
          >
            {weapon.modes.map(({ label, profile }, index) => {
              const count = weapon.count
              const absent = showCount && count === 0
              return (
                <tr key={profile.id} className={absent ? 'weapon--absent' : ''}>
                  {showCount && index === 0 && (
                    <td className="weapon__count" rowSpan={weapon.modes.length}>
                      {count > 0 ? `${count}×` : '—'}
                    </td>
                  )}
                  <th scope="row">
                    {/* One weapon, its modes under it: printed as separate
                        rows a two-mode weapon read as two weapons, each with
                        the full count. */}
                    {index === 0 && (
                      <span className="weapon__name">
                        {weapon.name}
                        {onToggleUsed && !absent && (
                          <button
                            className={`weapon__used ${isUsed ? 'weapon__used--on' : ''}`}
                            aria-pressed={isUsed}
                            aria-label={`${weapon.name}: ${isUsed ? 'not used yet' : 'used this turn'}`}
                            onClick={() => onToggleUsed(weapon.modes[0]!.profile.id, weapon.name)}
                          >
                            {isUsed ? '✓ used' : 'used?'}
                          </button>
                        )}
                        {weapon.modes.length > 1 && (
                          <span className="weapon__pick">pick one profile each time it attacks</span>
                        )}
                      </span>
                    )}
                    {label && <span className="weapon__mode">{label}</span>}
                    {(profile.keywords.length > 0 || (!absent && here.length > 0)) && (
                      <span className="sheet__keywords">
                        {profile.keywords.map((keyword) => (
                          <span key={keyword} className="weapon__kw">
                            [{keyword}]
                          </span>
                        ))}
                        {!absent &&
                          here.map((grant) => (
                            <span
                              key={`${grant.rule}:${grant.keyword}`}
                              className={`weapon__kw weapon__kw--granted ${live(grant) ? '' : 'weapon__kw--maybe'}`}
                              title={`${grant.rule} (${grant.source})${grant.when ? ` — ${grant.when}` : ''}`}
                            >
                              [{grant.keyword}]{live(grant) ? '' : '*'}
                            </span>
                          ))}
                      </span>
                    )}
                  </th>
                  <Cell value={profile.range} mods={absent ? [] : modsFor(modsHere, kind, 'R')} />
                  <Cell value={profile.a} mods={absent ? [] : modsFor(modsHere, kind, 'A')} />
                  <Cell value={profile.skill} mods={absent ? [] : modsFor(modsHere, kind, skillLabel)} />
                  <Cell value={profile.s} mods={absent ? [] : modsFor(modsHere, kind, 'S')} />
                  <Cell value={profile.ap} mods={absent ? [] : modsFor(modsHere, kind, 'AP')} />
                  <Cell value={profile.d} mods={absent ? [] : modsFor(modsHere, kind, 'D')} />
                </tr>
              )
            })}
          </tbody>
          )
          })}
        </table>
      </div>
      {here.length > 0 && (
        <ul className="grants">
          {here.map((grant) => (
            <li key={`${grant.rule}:${grant.keyword}`} className={live(grant) ? '' : 'grants__item--maybe'}>
              <span className="weapon__kw weapon__kw--granted">
                [{grant.keyword}]{live(grant) ? '' : '*'}
              </span>{' '}
              {grant.when ? `${grant.when}${grant.met ? ' — now' : ''} — ` : ''}
              <span className="muted">
                {grant.rule} · {grant.source}
              </span>
            </li>
          ))}
        </ul>
      )}
      {modsHere.length > 0 && <ModList mods={modsHere} />}
      {(conditional.length > 0 || modsHere.some((mod) => mod.when)) && (
        <p className="grants__note">* only while the condition above holds.</p>
      )}
    </>
  )
}
