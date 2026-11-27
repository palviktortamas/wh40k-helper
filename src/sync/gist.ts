/**
 * Sync between the owner's devices through a private gist in the owner's own
 * GitHub account (spec §4.4) — nothing to host. Each device holds a GitHub
 * token that may only touch gists; "Sync" reads the gist, merges it with this
 * device (merge.ts), writes what is newer here, and uploads the merged copy.
 * It runs only when the owner taps Sync, never in the background.
 */

import { db, getSetting, setSetting } from '@/data/db'
import { parseBackupEnvelope, readLocalContents } from '@/data/backup'
import { APP_ID } from '@/roster/transfer'
import { getTombstones, saveTombstones } from './client'
import { mergeForSync, syncableContents, type SyncCounts, type SyncDoc } from './merge'

export const GITHUB_TOKEN_KEY = 'sync.githubToken'
export const GIST_ID_KEY = 'sync.gistId'
export const GIST_LAST_KEY = 'sync.gistLast'
export const GIST_FILE = 'wh40k-helper-sync.json'
const GIST_DESCRIPTION = 'wh40k-helper — lists, games and collection (private sync)'
const API = 'https://api.github.com'

/** Where the owner makes a token that can only read and write gists. */
export const NEW_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=gist&description=wh40k-helper%20sync'

export type GistSyncSummary = SyncCounts & { at: number }

type GistFile = { content?: string; truncated?: boolean; raw_url?: string }
type Gist = { id: string; files: Record<string, GistFile | undefined> }

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: T | undefined }> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new Error('Could not reach GitHub — offline?')
  }
  if (response.status === 401) throw new Error('GitHub rejected the token. Make a new one (gist access only) and paste it again.')
  if (response.status === 403) throw new Error('GitHub refused: the token needs the "gist" permission, or the rate limit was hit.')
  if (response.status === 404) return { status: 404, body: undefined }
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`)
  return { status: response.status, body: (await response.json()) as T }
}

/** The sync file as this app writes it: the backup envelope plus the deletions. */
export function syncFileText(doc: SyncDoc, savedAt: number): string {
  return JSON.stringify({ app: APP_ID, kind: 'sync', version: 1, savedAt, contents: doc.contents, tombstones: doc.tombstones })
}

export function parseSyncFile(text: string): SyncDoc {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('The sync file in the gist is not readable.')
  }
  if (raw['app'] !== APP_ID || raw['kind'] !== 'sync') throw new Error('The gist holds something other than this app’s sync file.')
  // The contents are the backup's, so the backup's checks apply.
  const { contents } = parseBackupEnvelope(
    JSON.stringify({ app: APP_ID, kind: 'backup', version: raw['version'], contents: raw['contents'] }),
  )
  const tombstones = Array.isArray(raw['tombstones']) ? (raw['tombstones'] as SyncDoc['tombstones']) : []
  return { contents, tombstones }
}

/** The gist's text as a sync file; one only just made holds `{}`, which is nothing yet. */
export function readSyncText(text: string): SyncDoc | undefined {
  const trimmed = text.trim()
  return trimmed === '' || trimmed === '{}' ? undefined : parseSyncFile(trimmed)
}

async function readGistFile(gist: Gist): Promise<SyncDoc | undefined> {
  const file = gist.files[GIST_FILE]
  if (!file) return undefined
  // GitHub cuts long files short in the API reply; the raw link has all of it.
  let text = file.content ?? ''
  if (file.truncated && file.raw_url) {
    const response = await fetch(file.raw_url)
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for the sync file.`)
    text = await response.text()
  }
  return readSyncText(text)
}

/** The owner's sync gist: the one remembered here, else found by its file name, else made. */
async function findGist(token: string): Promise<Gist> {
  const known = await getSetting<string>(GIST_ID_KEY, '')
  if (known) {
    const { body } = await api<Gist>(token, `/gists/${known}`)
    if (body) return body
  }
  for (let page = 1; page <= 10; page++) {
    const { body } = await api<Gist[]>(token, `/gists?per_page=100&page=${page}`)
    if (!body || body.length === 0) break
    const hit = body.find((g) => g.files[GIST_FILE])
    // The list leaves the content out; fetch the gist itself.
    if (hit) return (await api<Gist>(token, `/gists/${hit.id}`)).body ?? hit
  }
  const { body } = await api<Gist>(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [GIST_FILE]: { content: '{}' } } }),
  })
  if (!body) throw new Error('GitHub did not create the sync gist.')
  return body
}

export async function syncWithGist(): Promise<GistSyncSummary> {
  const token = (await getSetting<string>(GITHUB_TOKEN_KEY, '')).trim()
  if (!token) throw new Error('Paste a GitHub token first.')

  const gist = await findGist(token)
  const remote = await readGistFile(gist)
  const here: SyncDoc = { contents: syncableContents(await readLocalContents()), tombstones: await getTombstones() }
  const { merged, local, counts } = mergeForSync(here, remote)

  await db.transaction(
    'rw',
    [db.rosters, db.games, db.settings, db.overrides, db.reminderOverrides, db.missions, db.collection],
    async () => {
      await db.rosters.bulkPut(local.put.rosters)
      await db.games.bulkPut(local.put.games)
      await db.settings.bulkPut(local.put.settings)
      await db.overrides.bulkPut(local.put.overrides)
      await db.reminderOverrides.bulkPut(local.put.reminderOverrides)
      await db.missions.bulkPut(local.put.missions)
      await db.collection.bulkPut(local.put.collection)
      await db.rosters.bulkDelete(local.remove.rosters)
      await db.games.bulkDelete(local.remove.games)
      await db.collection.bulkDelete(local.remove.collection)
    },
  )
  await saveTombstones(merged.tombstones)

  const at = Date.now()
  await api<Gist>(token, `/gists/${gist.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [GIST_FILE]: { content: syncFileText(merged, at) } } }),
  })
  await setSetting(GIST_ID_KEY, gist.id)
  const summary: GistSyncSummary = { ...counts, at }
  await setSetting(GIST_LAST_KEY, summary)
  return summary
}
