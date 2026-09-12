import { Placeholder } from './Placeholder'

export function Rosters() {
  return (
    <Placeholder
      phase={2}
      title="Rosters"
      summary="Build and validate army lists against the installed catalogues."
      planned={[
        'Create, duplicate, rename and delete rosters with a points limit',
        'Per-model loadout editor with the option limits enforced',
        'Leaders, enhancements, warlord and detachment selection',
        'Live legality validation with a rule citation on every error',
        'Plain-text roster export',
      ]}
    />
  )
}
