/**
 * Loads the real source files the fixture-gated tests run against. Skipped
 * unless WH40K_FIXTURES points at a directory holding `gs.json`, one catalogue
 * `.json`, optionally its `.yaml` MFM counterpart, and any linked library
 * catalogues as `lib-*.json`. Game data never enters the repo — the directory
 * lives in the scratchpad (see CLAUDE.md).
 *
 * Everything here is lazy: CI has no fixtures and `describe.skipIf` still runs
 * the describe body, so nothing may read a file at import time.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Catalogue, GameSystem } from '../src/data/bsdata/schema'

export const fixturesDir = process.env['WH40K_FIXTURES']

export const fixturesAvailable = (): boolean =>
  Boolean(fixturesDir && existsSync(fixturesDir) && existsSync(join(fixturesDir, 'gs.json')))

export const loadGameSystem = (): GameSystem =>
  JSON.parse(readFileSync(join(fixturesDir!, 'gs.json'), 'utf8')).gameSystem

const isLibrary = (f: string) => f.startsWith('lib-') && f.endsWith('.json')

export const loadCatalogue = (): Catalogue => {
  const file = readdirSync(fixturesDir!).find((f) => f.endsWith('.json') && f !== 'gs.json' && !isLibrary(f))
  if (!file) throw new Error('no catalogue .json in WH40K_FIXTURES')
  return JSON.parse(readFileSync(join(fixturesDir!, file), 'utf8')).catalogue
}

export const loadLibraries = (): Catalogue[] =>
  readdirSync(fixturesDir!)
    .filter(isLibrary)
    .map((f) => JSON.parse(readFileSync(join(fixturesDir!, f), 'utf8')).catalogue)

export const loadMfmText = (): string | undefined => {
  const file = readdirSync(fixturesDir!).find((f) => f.endsWith('.yaml'))
  return file ? readFileSync(join(fixturesDir!, file), 'utf8') : undefined
}
