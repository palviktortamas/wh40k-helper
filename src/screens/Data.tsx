import { Placeholder } from './Placeholder'

export function Data() {
  return (
    <Placeholder
      phase={1}
      title="Data"
      summary="Download and update the game data. Nothing ships with the app — every catalogue is fetched to this device on demand and then works offline."
      planned={[
        'Install and update faction catalogues from BSData',
        'Official points from the Munitorum Field Manual mirror',
        'Optional Wahapedia enrichment through a user-owned CORS proxy',
        'Import from files when a source is unreachable',
        'Data Health: cross-source discrepancies with manual overrides',
      ]}
    />
  )
}
