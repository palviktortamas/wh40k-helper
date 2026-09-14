import type { UnitStats } from '@/data/model'
import { applyMod, modsFor, type StatMod } from '@/play/mods'
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
 * The stat line as a row of labelled cells — the thing a player glances at
 * across the table, so it is on every unit card, not only inside the sheet.
 * A multi-profile datasheet (a leader model and its troops) shows one row per
 * profile with the profile's name in front. `wounds` overrides the W cell with
 * the live "current / total" of a single-model unit.
 *
 * `mods` are the characteristics the army's rules change (an enhancement's 4+
 * save, a state's +1 Toughness). A changed number is shown changed — printing
 * the datasheet's number would be printing a stat line this unit does not
 * have — and marked: a lasting change in the accent colour, one that holds
 * only while a condition does in the warning colour with a `*`, both spelled
 * out under the strip. Never colour alone.
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
              {COLUMNS.map(([key, label, stat]) => {
                const live = key === 'w' && wounds && stats.length === 1
                const applied = applyMod(line[key], modsFor(unitMods, 'unit', stat))
                const value = live ? `${wounds.current}/${wounds.total}` : applied.value
                const hurt = live && wounds.current < wounds.total
                const changed = !live && applied.changed
                return (
                  <span key={key} className={`statstrip__cell${hurt ? ' statstrip__cell--hurt' : ''}`}>
                    <span className="statstrip__label">{label}</span>
                    <span
                      className={`statstrip__value${
                        changed ? (applied.temporary ? ' value--temporary' : ' value--changed') : ''
                      }`}
                    >
                      {value}
                      {changed && applied.temporary ? '*' : ''}
                    </span>
                  </span>
                )
              })}
              {/* A save a rule grants is a cell the datasheet does not have. It
                  earns its place on the full sheet, where the legend below says
                  where it comes from; on a card in a list it would be a number
                  with no explanation. */}
              {(line.invSv || (invMods.length > 0 && size === 'large')) && (
                <span className="statstrip__cell statstrip__cell--inv">
                  <span className="statstrip__label">Inv</span>
                  <span
                    className={`statstrip__value${
                      inv.changed ? (inv.temporary ? ' value--temporary' : ' value--changed') : ''
                    }`}
                  >
                    {inv.value}
                    {inv.changed && inv.temporary ? '*' : ''}
                  </span>
                </span>
              )}
            </div>
          )
        })}
      </div>
      {size === 'large' && unitMods.length > 0 && <ModList mods={unitMods} />}
    </>
  )
}

/** What changed a characteristic, and whether it lasts. */
export function ModList({ mods }: { mods: readonly StatMod[] }) {
  return (
    <ul className="mods">
      {mods.map((mod) => (
        <li key={`${mod.rule}:${mod.stat}:${mod.value}`} className={mod.when ? 'mods__item--temporary' : ''}>
          <span className={mod.when ? 'value--temporary' : 'value--changed'}>
            {mod.stat === 'INVSV' ? 'Inv' : mod.stat} {mod.value}
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
