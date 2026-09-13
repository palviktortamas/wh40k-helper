/**
 * Fetching, parsing and storing a faction's data. Runs inside the data worker —
 * the catalogue is ~2 MB of JSON and parsing it on the main thread would drop
 * frames (spec §7, "heavy parsing off the main thread").
 */

import { parseCatalogue } from './bsdata/parse'
import { parseMfm } from './mfm/parse'
import { mergeMfm, normaliseName } from './link/merge'
import type { MergeReport } from './link/merge'
import type { CatalogueRecord, HealthRecord } from './db'
import type { CatalogueSummary } from './model'
import {
  BSDATA_INDEX_URL,
  GAME_SYSTEM_FILE,
  MFM_INDEX_URL,
  bsdataUrl,
  mfmUrl,
} from './sources'
import type { CatalogueFile, GameSystemFile } from './bsdata/schema'

export type Progress = { step: string; done?: number; total?: number }

type GithubEntry = { name: string; type: string }

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return (await response.json()) as T
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return await response.text()
}

/**
 * Lists the factions available for install, pairing each BSData catalogue with
 * its MFM counterpart by normalised name. BSData names carry an alliance prefix
 * ("Xenos - Orks"); the mirror uses a bare slug ("orks").
 */
export async function listAvailableCatalogues(): Promise<CatalogueSummary[]> {
  const [bsFiles, mfmFiles] = await Promise.all([
    fetchJson<GithubEntry[]>(BSDATA_INDEX_URL),
    fetchJson<GithubEntry[]>(MFM_INDEX_URL).catch(() => [] as GithubEntry[]),
  ])

  const slugs = new Map(
    mfmFiles
      .filter((f) => f.type === 'file' && f.name.endsWith('.yaml'))
      .map((f) => {
        const slug = f.name.replace(/\.yaml$/, '')
        return [normaliseName(slug), slug]
      }),
  )

  return bsFiles
    .filter((f) => f.type === 'file' && f.name.endsWith('.json') && f.name !== GAME_SYSTEM_FILE)
    .map((f) => {
      const name = f.name.replace(/\.json$/, '')
      // "Xenos - Orks" → "Orks"; a bare name is left alone.
      const bare = name.includes(' - ') ? name.slice(name.lastIndexOf(' - ') + 3) : name
      const slug = slugs.get(normaliseName(bare))
      return {
        id: name,
        name: bare,
        file: f.name,
        ...(slug ? { slug } : {}),
      } satisfies CatalogueSummary
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type InstallResult = {
  record: CatalogueRecord
  health: HealthRecord
}

/**
 * Downloads, parses and cross-checks one faction. The raw text is kept in the
 * record so a future app version can re-parse offline.
 */
export async function installCatalogue(
  summary: CatalogueSummary,
  report: (progress: Progress) => void,
): Promise<InstallResult> {
  report({ step: 'Downloading game system', done: 0, total: 4 })
  const gameSystemText = await fetchText(bsdataUrl(GAME_SYSTEM_FILE))

  report({ step: `Downloading ${summary.name}`, done: 1, total: 4 })
  const catalogueText = await fetchText(bsdataUrl(summary.file))

  let mfmText: string | undefined
  if (summary.slug) {
    report({ step: 'Downloading official points', done: 2, total: 4 })
    // The mirror is a convenience, not a requirement: without it the app still
    // works from BSData alone (spec §4.2, "core path").
    mfmText = await fetchText(mfmUrl(summary.slug)).catch(() => undefined)
  }

  report({ step: 'Parsing', done: 3, total: 4 })
  const gameSystem = (JSON.parse(gameSystemText) as GameSystemFile).gameSystem
  const catalogue = (JSON.parse(catalogueText) as CatalogueFile).catalogue
  const parsed = parseCatalogue(gameSystem, catalogue)
  parsed.name = summary.name
  if (summary.slug) parsed.slug = summary.slug

  let mfmVersion: string | undefined
  let merge: MergeReport = {
    discrepancies: [],
    unmatched: [],
    matchedDatasheets: 0,
    matchedDetachments: 0,
  }

  if (mfmText) {
    const mfm = parseMfm(mfmText)
    mfmVersion = mfm.version
    merge = mergeMfm(parsed, mfm)
  }

  report({ step: 'Saving', done: 4, total: 4 })
  const now = Date.now()

  return {
    record: {
      id: parsed.id,
      name: parsed.name,
      ...(summary.slug ? { slug: summary.slug } : {}),
      revision: parsed.revision,
      installedAt: now,
      parsed,
      raw: {
        catalogue: catalogueText,
        gameSystem: gameSystemText,
        ...(mfmText ? { mfm: mfmText } : {}),
      },
      versions: {
        bsdataRevision: parsed.revision,
        ...(mfmVersion ? { mfmVersion } : {}),
      },
    },
    health: {
      catalogueId: parsed.id,
      checkedAt: now,
      discrepancies: merge.discrepancies,
      unmatched: merge.unmatched,
      matchedDatasheets: merge.matchedDatasheets,
      matchedDetachments: merge.matchedDetachments,
    },
  }
}
