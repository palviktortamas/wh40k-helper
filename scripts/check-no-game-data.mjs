// Guards the acceptance criterion "a fresh clone contains no game data": the
// repository and the deployed bundle must hold code only. The check is
// structural on purpose — it looks for the *shape* of the source formats, never
// for unit names, so the guard itself stays free of GW content.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const ROOT = process.cwd()

// Markers are format identifiers from BattleScribe / the Wahapedia export and
// the MFM mirror. Finding one means a datafile was committed or bundled.
const MARKERS = [
  'battleScribeVersion',
  'sharedSelectionEntries',
  'sharedSelectionEntryGroups',
  'selectionEntryGroups',
  'categoryEntries',
  'datasheets_wargear',
  'datasheets_models_cost',
  'force_disposition|',
  'firstSeen:',
]

const BANNED_EXTENSIONS = new Set(['.cat', '.catz', '.gst', '.gstz'])
const MAX_BYTES = 512 * 1024

// This file names the markers by necessity; the spec doc quotes the source
// schemas. Neither carries game data.
const ALLOWLIST = new Set(['scripts/check-no-game-data.mjs', 'docs/spec.md'])

const problems = []

const inspect = (absolute, label) => {
  const ext = extname(absolute).toLowerCase()
  if (BANNED_EXTENSIONS.has(ext)) {
    problems.push(`${label}: datafile extension ${ext}`)
    return
  }
  if (!['.json', '.yaml', '.yml', '.csv', '.js', '.mjs', '.ts', '.tsx', '.md', '.html'].includes(ext)) return

  const { size } = statSync(absolute)
  // A committed catalogue is megabytes; nothing hand-written here should be.
  if (size > MAX_BYTES && !absolute.includes('package-lock.json')) {
    problems.push(`${label}: ${(size / 1024).toFixed(0)} kB — too large to be hand-written`)
  }

  const text = readFileSync(absolute, 'utf8')
  for (const marker of MARKERS) {
    if (text.includes(marker)) problems.push(`${label}: contains source-format marker "${marker}"`)
  }
}

// 1. Everything git tracks.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
for (const file of tracked) {
  if (ALLOWLIST.has(file)) continue
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
