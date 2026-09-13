// Guards the acceptance criterion "a fresh clone contains no game data": the
// repository and the deployed bundle must hold code only.
//
// One exception, decided by the owner on 2026-09-13: the deployed bundle may
// carry the Chapter Approved mission deck page (`missions-ca-*.html`), fetched
// from Wahapedia at build time by scripts/fetch-mission-deck.mjs. It is never
// committed (git-ignored under public/) and it is HTML, so the format markers
// below do not apply to it; its size stays well under the code-file limit.
//
// The check is structural on purpose — it looks for the *shape* of the source
// formats, never for unit names, so the guard itself stays free of GW content.
//
// Naming a schema field is code, not data: the parser and the docs legitimately
// mention `sharedSelectionEntries`. So format markers only count against files
// that could actually *be* a datafile (.json/.yaml/.csv), and everything else is
// judged on size — a committed catalogue is megabytes, hand-written code is not.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const ROOT = process.cwd()

/** Format identifiers from BattleScribe, the Wahapedia export and the MFM mirror. */
const MARKERS = [
  'battleScribeVersion',
  'sharedSelectionEntries',
  'sharedSelectionEntryGroups',
  'categoryEntries',
  'datasheets_wargear',
  'datasheets_models_cost',
  'force_disposition|',
  'firstSeen:',
]

const BANNED_EXTENSIONS = new Set(['.cat', '.catz', '.gst', '.gstz'])
const DATA_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.csv'])
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.md', '.html', '.css'])

/** A hand-written data file stays small; a catalogue does not. */
const MAX_DATA_BYTES = 256 * 1024
/** A bundle that swallowed a catalogue would blow past this; our app does not. */
const MAX_CODE_BYTES = 1536 * 1024

/** Generated or vendored files that are legitimately large. */
const SIZE_ALLOWLIST = new Set(['package-lock.json'])

const problems = []

const inspect = (absolute, label) => {
  const ext = extname(absolute).toLowerCase()
  if (BANNED_EXTENSIONS.has(ext)) {
    problems.push(`${label}: datafile extension ${ext}`)
    return
  }

  const isData = DATA_EXTENSIONS.has(ext)
  const isCode = CODE_EXTENSIONS.has(ext)
  if (!isData && !isCode) return

  const { size } = statSync(absolute)
  const limit = isData ? MAX_DATA_BYTES : MAX_CODE_BYTES
  if (size > limit && !SIZE_ALLOWLIST.has(label.replace(/\\/g, '/'))) {
    problems.push(
      `${label}: ${(size / 1024).toFixed(0)} kB exceeds the ${(limit / 1024).toFixed(0)} kB limit for ${isData ? 'data' : 'code'} files`,
    )
  }

  // Only a real datafile can be caught by its markers; code may name the schema.
  if (!isData) return
  const text = readFileSync(absolute, 'utf8')
  for (const marker of MARKERS) {
    if (text.includes(marker)) problems.push(`${label}: contains source-format marker "${marker}"`)
  }
}

// 1. Everything git tracks.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
for (const file of tracked) {
  if (existsSync(join(ROOT, file))) inspect(join(ROOT, file), file)
}

// 2. The build output, which is what actually reaches the Pages origin.
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else inspect(full, relative(ROOT, full))
  }
}
if (existsSync(join(ROOT, 'dist'))) walk(join(ROOT, 'dist'))

if (problems.length > 0) {
  console.error('Game data found where only code belongs:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\nSee spec §4.2: no game data in the repo or on the Pages origin.')
  process.exit(1)
}
console.log(`No game data found (${tracked.length} tracked files + dist checked).`)
