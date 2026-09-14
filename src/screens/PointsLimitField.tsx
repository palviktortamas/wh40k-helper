import { useState } from 'react'
import { POINTS_PRESETS } from '@/roster/types'

/**
 * The army's points limit: the three battle sizes the game defines, and
 * "Custom", which types the number in.
 *
 * A custom size used to be set through the data's own numeric stepper, a
 * hundred points per press — fine for the odd nudge, useless for "1,150".
 */
export function PointsLimitField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (points: number) => void
}) {
  const isPreset = (POINTS_PRESETS as readonly number[]).includes(value)
  const [custom, setCustom] = useState(!isPreset)
  // Typed text of its own, so a half-typed number ("1", "") survives the keypress.
  const [typed, setTyped] = useState(String(value))

  return (
    <>
      <label>
        {label}
        <select
          value={custom ? 'custom' : value}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustom(true)
              setTyped(String(value))
              return
            }
            setCustom(false)
            onChange(Number(e.target.value))
          }}
        >
          {POINTS_PRESETS.map((points) => (
            <option key={points} value={points}>
              {points}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {custom && (
        <label>
          Points
          <input
            className="rosters__points"
            type="number"
            inputMode="numeric"
            min={0}
            step={5}
            value={typed}
            aria-label="Custom points limit"
            onChange={(e) => {
              setTyped(e.target.value)
              const points = Number(e.target.value)
              if (e.target.value !== '' && Number.isFinite(points) && points >= 0) onChange(points)
            }}
          />
        </label>
      )}
    </>
  )
}
