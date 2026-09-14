/**
 * Loads the real source files the fixture-gated tests run against. Skipped
 * unless WH40K_FIXTURES points at a directory holding `gs.json` and at least
 * one faction. Game data never enters the repo — the directory lives in the
 * scratchpad (see CLAUDE.md).
 *
 * Two layouts, both supported. Flat, one faction:
 *
 *   gs.json, Orks.json, orks.yaml, lib-*.json
 *
 * Or a subdirectory per faction, sharing the one game system — this is what
 * lets the live suites run against several factions and catch the assumptions
 * a single catalogue hides:
 *
 *   gs.json
 *   orks/Orks.json, orks/orks.yaml, orks/lib-*.json
 *   necrons/Necrons.json, necrons/necrons.yaml
 *
 * Everything here is lazy: CI has no fixtures and `describe.skipIf` still runs
 * the describe body, so nothing may read a file at import time.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Catalogue, GameSystem } from '../src/data/bsdata/schema'

export const fixturesDir = process.env['WH40K_FIXTURES']

export const fixturesAvailable = (): boolean =>
  Boolean(fixturesDir && existsSync(fixturesDir) && existsSync(join(fixturesDir, 'gs.json')))

/** One faction's files. Paths, not contents — the live suites load lazily. */
export type FixtureFaction = {
  /** The catalogue file's base name, used to label the test run. */
  name: string
  catalogueFile: string
  /** Linked library catalogues (`lib-*.json`) belonging to this faction. */
  libraryFiles: string[]
  /** The MFM `.yaml` counterpart, when the fixture includes one. */
  mfmFile?: string
}

const isLibrary = (file: string) => file.startsWith('lib-') && file.endsWith('.json')
const isCatalogue = (file: string) => file.endsWith('.json') && file !== 'gs.json' && !isLibrary(file)

/** Reads one directory as a faction, or nothing when it holds no catalogue. */
const factionIn = (dir: string): FixtureFaction | undefined => {
  const files = readdirSync(dir)
  const catalogue = files.find(isCatalogue)
  if (!catalogue) return undefined
  const mfm = files.find((f) => f.endsWith('.yaml'))
  return {
    name: basename(catalogue, '.json'),
    catalogueFile: join(dir, catalogue),
    libraryFiles: files.filter(isLibrary).map((f) => join(dir, f)),
    ...(mfm ? { mfmFile: join(dir, mfm) } : {}),
  }
}

/** Every faction the fixtures directory offers, by name. */
export function fixtureFactions(dir: string): FixtureFaction[] {
  const flat = factionIn(dir)
  if (flat) return [flat]
  const nested = readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isDirectory())
    .flatMap((path) => factionIn(path) ?? [])
  return nested.sort((a, b) => a.name.localeCompare(b.name))
}

/** The factions of the configured fixtures directory. */
export const configuredFactions = (): FixtureFaction[] =>
  fixturesAvailable() ? fixtureFactions(fixturesDir!) : []

const readCatalogue = (file: string): Catalogue => JSON.parse(readFileSync(file, 'utf8')).catalogue

export const loadGameSystem = (): GameSystem =>
  JSON.parse(readFileSync(join(fixturesDir!, 'gs.json'), 'utf8')).gameSystem

export const loadCatalogueOf = (faction: FixtureFaction): Catalogue =>
  readCatalogue(faction.catalogueFile)

export const loadLibrariesOf = (faction: FixtureFaction): Catalogue[] =>
  faction.libraryFiles.map(readCatalogue)

export const loadMfmTextOf = (faction: FixtureFaction): string | undefined =>
  faction.mfmFile ? readFileSync(faction.mfmFile, 'utf8') : undefined

const firstFaction = (): FixtureFaction => {
  const faction = configuredFactions()[0]
  if (!faction) throw new Error('no catalogue .json in WH40K_FIXTURES')
  return faction
}

export const loadCatalogue = (): Catalogue => loadCatalogueOf(firstFaction())
export const loadLibraries = (): Catalogue[] => loadLibrariesOf(firstFaction())
export const loadMfmText = (): string | undefined => loadMfmTextOf(firstFaction())
