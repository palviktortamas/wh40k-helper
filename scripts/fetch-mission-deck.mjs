// Fetches the Chapter Approved mission deck page from Wahapedia into `public/`
// at build time, so the deployed app ships the deck and imports it on first run
// (spec §6.1; the owner allowed shipping the deck on 2026-09-13).
//
// The page is game data, so it is never committed: `public/missions-ca-*.html`
// is git-ignored and only ever exists in a build. The app parses it with the
// same on-device parser it uses for a manually saved page, so a markup change
// on Wahapedia shows up in one place. A fetch failure is a warning, not a
// build failure — the app then falls back to the manual import.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const URL = 'https://wahapedia.ru/wh40k11ed/the-rules/mission-deck-2026-27/'
const OUT = join(process.cwd(), 'public', 'missions-ca-2026-27.html')

/** The page's own card vocabulary; if these are missing the page is not the deck. */
const EXPECTED = ['cgCardCA7', 'ca7Name', 'caPmBlock']

try {
  const response = await fetch(URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; wh40k-helper build; private use)',
      accept: 'text/html',
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const html = await response.text()
  const missing = EXPECTED.filter((marker) => !html.includes(marker))
  if (missing.length > 0) throw new Error(`page lacks expected markers: ${missing.join(', ')}`)
  mkdirSync(join(process.cwd(), 'public'), { recursive: true })
  writeFileSync(OUT, html)
  console.log(`Mission deck fetched: ${(html.length / 1024).toFixed(0)} kB → ${OUT}`)
} catch (error) {
  console.warn(`Mission deck not fetched (${error instanceof Error ? error.message : String(error)}); the app will offer the manual import.`)
}
