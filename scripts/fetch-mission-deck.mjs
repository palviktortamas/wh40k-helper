// Fetches the game data the deployed build is allowed to ship from Wahapedia
// into `public/` at build time: the Chapter Approved mission deck page (owner's
// decision 2026-09-13) and the stratagem export (owner's decision 2026-09-13,
// night 2). The app imports both on first run (spec §6.1, §6.3).
//
// Both files are game data, so they are never committed: they are git-ignored
// under public/ and only ever exist in a build. The app parses them with the
// same on-device parsers it uses for a manually saved file, so a format change
// on Wahapedia shows up in one place. A fetch failure is a warning, not a build
// failure — the app then falls back to the manual import.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SHIPPED = [
  {
    label: 'Mission deck',
    url: 'https://wahapedia.ru/wh40k11ed/the-rules/mission-deck-2026-27/',
    out: 'missions-ca-2026-27.html',
    accept: 'text/html',
    /** The page's own card vocabulary; if these are missing the page is not the deck. */
    expected: ['cgCardCA7', 'ca7Name', 'caPmBlock'],
  },
  {
    label: 'Stratagems',
    url: 'https://wahapedia.ru/wh40k11ed/Stratagems.csv',
    out: 'stratagems-wahapedia.csv',
    accept: 'text/csv,text/plain',
    /** The export's header columns; if these are missing the file is not the stratagem table. */
    expected: ['faction_id|name|id|type|cp_cost', '|description|'],
  },
]

mkdirSync(join(process.cwd(), 'public'), { recursive: true })

for (const item of SHIPPED) {
  const out = join(process.cwd(), 'public', item.out)
  try {
    const response = await fetch(item.url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; wh40k-helper build; private use)',
        accept: item.accept,
      },
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const text = await response.text()
    const missing = item.expected.filter((marker) => !text.includes(marker))
    if (missing.length > 0) throw new Error(`file lacks expected markers: ${missing.join(', ')}`)
    writeFileSync(out, text)
    console.log(`${item.label} fetched: ${(text.length / 1024).toFixed(0)} kB → ${out}`)
  } catch (error) {
    console.warn(
      `${item.label} not fetched (${error instanceof Error ? error.message : String(error)}); the app will offer the manual import.`,
    )
  }
}
