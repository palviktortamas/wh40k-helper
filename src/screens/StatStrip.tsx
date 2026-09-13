import type { UnitStats } from '@/data/model'
import './Units.css'

const COLUMNS = [
  ['m', 'M'],
  ['t', 'T'],
  ['sv', 'Sv'],
  ['w', 'W'],
  ['ld', 'Ld'],
  ['oc', 'OC'],
] as const

/**
 * The stat line as a row of labelled cells — the thing a player glances at
 * across the table, so it is on every unit card, not only inside the sheet.
 * A multi-profile datasheet (a leader model and its troops) shows one row per
 * profile with the profile's name in front. `wounds` overrides the W cell with
 * the live "current / total" of a single-model unit.
 */
export function StatStrip({
  stats,
  size = 'compact',
  wounds,
  firstOnly = false,
}: {
  stats: readonly UnitStats[]
  size?: 'compact' | 'large'
  wounds?: { current: number; total: number }
  /** Cards in a long list: the unit's main profile only, with a note that more exist. */
  firstOnly?: boolean
}) {
  if (stats.length === 0) return null
  const shown = firstOnly ? stats.slice(0, 1) : stats
  return (
    <div className={`statstrip statstrip--${size}`} aria-label="Stat line">
      {shown.map((line) => {
        const hasInv = Boolean(line.invSv)
        return (
          <div key={line.name} className="statstrip__row">
            {stats.length > 1 && (
              <span className="statstrip__who">
                {line.name}
                {firstOnly ? ` · +${stats.length - 1} more profile${stats.length > 2 ? 's' : ''}` : ''}
              </span>
            )}
            {COLUMNS.map(([key, label]) => {
              const live = key === 'w' && wounds && stats.length === 1
              const value = live ? `${wounds.current}/${wounds.total}` : (line[key] ?? '—')
              const hurt = live && wounds.current < wounds.total
              return (
                <span key={key} className={`statstrip__cell${hurt ? ' statstrip__cell--hurt' : ''}`}>
                  <span className="statstrip__label">{label}</span>
                  <span className="statstrip__value">{value}</span>
                </span>
              )
            })}
            {hasInv && (
              <span className="statstrip__cell statstrip__cell--inv">
                <span className="statstrip__label">Inv</span>
                <span className="statstrip__value">{line.invSv}</span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
