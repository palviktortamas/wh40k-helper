import type { UnitStats } from '@/data/model'
import { applyMod, isLive, modsFor, type Applied, type StatMod } from '@/play/mods'
import './Units.css'

const COLUMNS = [
  ['m', 'M', 'M'],
  ['t', 'T', 'T'],
  ['sv', 'Sv', 'SV'],
  ['w', 'W', 'W'],
  ['ld', 'Ld', 'LD'],
  ['oc', 'OC', 'OC'],
] as const

/**
 * How a change reads. Most are "SV 4+"; a modifier to a roll is not a
 * characteristic and has to read as what it is, or the player looks for a
 * column that does not exist.
 */
export function modLabel(mod: StatMod): string {
  if (mod.stat === 'HIT' || mod.stat === 'WOUND')
    return `${mod.value} to ${mod.stat.toLowerCase()}`
  return `${mod.stat === 'INVSV' ? 'Inv' : mod.stat} ${mod.value}`
}

/** What a change that has not happened yet would do, for a tooltip. */
const pendingTitle = (applied: Applied): string | undefined =>
  applied.pending.length === 0
    ? undefined
    : applied.pending
        .map((mod) => `${modLabel(mod)} ${mod.when ?? ''} (${mod.rule})`.trim())
        .join('; ')

/** One cell of the stat line, with whatever the rules do to it. */
function Cell({
  label,
  applied,
  live,
  inv = false,
  hurt = false,
}: {
  label: string
  applied: Applied
  /** The value shown, when it is not simply `applied.value` (live wounds). */
  live?: string
  inv?: boolean
  hurt?: boolean
}) {
  const changed = live === undefined && applied.changed
  const mark = changed && applied.temporary ? '*' : ''
  const state = changed ? (applied.temporary ? ' value--temporary' : ' value--changed') : ''
  const title = pendingTitle(applied)
  return (
    <span
      className={`statstrip__cell${inv ? ' statstrip__cell--inv' : ''}${hurt ? ' statstrip__cell--hurt' : ''}`}
      {...(title ? { title } : {})}
    >
      <span className="statstrip__label">{label}</span>
      <span className={`statstrip__value${state}`}>
        {live ?? applied.value}
        {mark}
        {/* A change waiting on a condition leaves the number alone and says so
            with a mark of its own — the printed number is still the true one. */}
        {!changed && applied.pending.length > 0 && <span className="value--maybe">*</span>}
      </span>
    </span>
  )
}

/**
 * The stat line as a row of labelled cells — the thing a player glances at
 * across the table, so it is on every unit card, not only inside the sheet.
 * A multi-profile datasheet (a leader model and its troops) shows one row per
 * profile with the profile's name above it. `wounds` overrides the W cell with
 * the live "current / total" of a single-model unit.
 *
 * `mods` are the characteristics the army's rules change. Only a change that is
 * in force right now changes a number: a 5+ invulnerable save a unit has *while
 * it is riled up* is not an invulnerable save, and showing one would be a lie
 * that also buries a real one. A waiting change marks its characteristic with a
 * `*` it can be hovered for, and is spelled out under the strip.
 */
export function StatStrip({
  stats,
  size = 'compact',
  wounds,
  firstOnly = false,
  mods = [],
}: {
  stats: readonly UnitStats[]
  size?: 'compact' | 'large'
  wounds?: { current: number; total: number }
  /** Cards in a long list: the unit's main profile only, with a note that more exist. */
  firstOnly?: boolean
  mods?: readonly StatMod[]
}) {
  if (stats.length === 0) return null
  const shown = firstOnly ? stats.slice(0, 1) : stats
  const unitMods = mods.filter((mod) => mod.target === 'unit')
  const invMods = modsFor(unitMods, 'unit', 'INVSV')
  return (
    <>
      <div className={`statstrip statstrip--${size}`} aria-label="Stat line">
        {shown.map((line) => {
          const inv = applyMod(line.invSv, invMods)
          return (
            <div key={line.name} className="statstrip__row">
              {stats.length > 1 && (
                <span className="statstrip__who">
                  {line.name}
                  {firstOnly ? ` · +${stats.length - 1} more profile${stats.length > 2 ? 's' : ''}` : ''}
                </span>
              )}
              <span className="statstrip__cells">
                {COLUMNS.map(([key, label, stat]) => {
                  const liveWounds = key === 'w' && wounds && stats.length === 1
                  return (
                    <Cell
                      key={key}
                      label={label}
                      applied={applyMod(line[key], modsFor(unitMods, 'unit', stat))}
                      {...(liveWounds ? { live: `${wounds.current}/${wounds.total}` } : {})}
                      hurt={Boolean(liveWounds && wounds.current < wounds.total)}
                    />
                  )
                })}
                {/* An invulnerable save cell appears when the unit has one, or
                    when a rule in force has given it one — never for a save it
                    would only have under a condition. */}
                {(line.invSv || invMods.some(isLive)) && <Cell label="Inv" applied={inv} inv />}
              </span>
            </div>
          )
        })}
      </div>
      {size === 'large' && unitMods.length > 0 && <ModList mods={unitMods} />}
    </>
  )
}

/** What changed a characteristic, or would change it, and whether it lasts. */
export function ModList({ mods }: { mods: readonly StatMod[] }) {
  return (
    <ul className="mods">
      {mods.map((mod) => (
        <li
          key={`${mod.rule}:${mod.stat}:${mod.value}:${mod.source}:${mod.when ?? ''}`}
          className={mod.when ? 'mods__item--temporary' : ''}
        >
          <span className={mod.when ? 'value--temporary' : 'value--changed'}>
            {modLabel(mod)}
            {mod.when ? '*' : ''}
          </span>{' '}
          {mod.when ? `${mod.when}${mod.met ? ' — now' : ''} — ` : ''}
          <span className="muted">
            {mod.rule} · {mod.source}
          </span>
        </li>
      ))}
    </ul>
  )
}
