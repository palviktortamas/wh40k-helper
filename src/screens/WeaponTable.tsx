import type { WeaponRow } from '@/play/weapons'
import './Datasheets.css'

/** One weapons table (ranged or melee) with the count column in front. */
export function WeaponTable({ title, rows, showCount = true }: { title: string; rows: WeaponRow[]; showCount?: boolean }) {
  if (rows.length === 0) return null
  const skillLabel = rows[0]!.profile.kind === 'ranged' ? 'BS' : 'WS'
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
          <tbody>
            {rows.map(({ profile, count }) => (
              <tr key={profile.id} className={showCount && count === 0 ? 'weapon--absent' : ''}>
                {showCount && <td className="weapon__count">{count > 0 ? `${count}×` : '—'}</td>}
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
