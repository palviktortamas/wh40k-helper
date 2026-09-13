/**
 * Where game data comes from. URLs only — no game content lives in this repo.
 *
 * Both sources here send `Access-Control-Allow-Origin: *`, so the browser can
 * fetch them directly with no proxy. The Wahapedia export and the mission deck
 * do not, and arrive in Phase 1b behind a user-owned proxy or file import.
 */

export type SourceId = 'bsdata' | 'mfm'

/** Precedence when sources disagree, per spec §4.1. Lower wins. */
export const POINTS_PRECEDENCE: SourceId[] = ['mfm', 'bsdata']

export const BSDATA_BRANCH = 'main'
const BSDATA_RAW = `https://raw.githubusercontent.com/BSData/wh40k-11e/${BSDATA_BRANCH}`
const MFM_RAW = 'https://raw.githubusercontent.com/BSData/wh40k-11e-mfm/main/data'

/** The shared game system file every catalogue links against. */
export const GAME_SYSTEM_FILE = 'Warhammer 40,000.json'

export const bsdataUrl = (file: string) => `${BSDATA_RAW}/${encodeURIComponent(file)}`
export const mfmUrl = (slug: string) => `${MFM_RAW}/${slug}.yaml`

/** GitHub's contents API, used to discover which catalogues exist. */
export const BSDATA_INDEX_URL =
  `https://api.github.com/repos/BSData/wh40k-11e/contents?ref=${BSDATA_BRANCH}`
export const MFM_INDEX_URL = 'https://api.github.com/repos/BSData/wh40k-11e-mfm/contents/data'

export const SOURCE_LABELS: Record<SourceId, string> = {
  bsdata: 'BSData wh40k-11e',
  mfm: 'Munitorum Field Manual mirror',
}

export const SOURCE_HOMEPAGES: Record<SourceId, string> = {
  bsdata: 'https://github.com/BSData/wh40k-11e',
  mfm: 'https://github.com/BSData/wh40k-11e-mfm',
}
