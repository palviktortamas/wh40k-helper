import { Placeholder } from './Placeholder'

export function Play() {
  return (
    <Placeholder
      phase={3}
      title="Play"
      summary="Run a game from a saved roster."
      planned={[
        'Mission setup wizard following the Chapter Approved 2026-27 sequence',
        'Battle round and phase tracker with CP and VP counters',
        'Army view with per-unit model and wound tracking',
        'Loadout-aware weapons table on every datasheet',
        'Per-phase reminder panel with once-per-battle locks',
      ]}
    />
  )
}
