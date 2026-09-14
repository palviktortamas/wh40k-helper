/**
 * The fixture loader itself, exercised against throwaway directories rather
 * than the owner's real fixtures — so it runs in CI, where WH40K_FIXTURES is
 * unset and no game data exists. The files written here are empty shells with
 * the right shape; nothing in them is game data.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureFactions } from './fixtures'

const dirs: string[] = []

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'wh40k-fixtures-'))
  dirs.push(dir)
  return dir
}

const writeCatalogue = (path: string, name: string) =>
  writeFileSync(path, JSON.stringify({ catalogue: { id: name, name, revision: 1 } }))

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('fixtureFactions', () => {
  it('reads one faction from a flat directory, as the owner’s fixtures were laid out', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'gs.json'), JSON.stringify({ gameSystem: { id: 'gs' } }))
    writeCatalogue(join(dir, 'Orks.json'), 'Orks')
    writeFileSync(join(dir, 'orks.yaml'), 'version: 1.4\n')

    const factions = fixtureFactions(dir)

    expect(factions).toHaveLength(1)
    expect(factions[0]?.name).toBe('Orks')
    expect(factions[0]?.mfmFile).toBe(join(dir, 'orks.yaml'))
    expect(factions[0]?.libraryFiles).toEqual([])
  })

  it('reads a faction per subdirectory, so several factions share one game system', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'gs.json'), JSON.stringify({ gameSystem: { id: 'gs' } }))
    for (const name of ['Orks', 'Necrons']) {
      const sub = join(dir, name.toLowerCase())
      mkdirSync(sub)
      writeCatalogue(join(sub, `${name}.json`), name)
      writeFileSync(join(sub, `${name.toLowerCase()}.yaml`), 'version: 1.0\n')
    }

    const factions = fixtureFactions(dir)

    expect(factions.map((f) => f.name)).toEqual(['Necrons', 'Orks'])
  })

  it('keeps a faction’s linked libraries with that faction', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'gs.json'), JSON.stringify({ gameSystem: { id: 'gs' } }))
    const sub = join(dir, 'orks')
    mkdirSync(sub)
    writeCatalogue(join(sub, 'Orks.json'), 'Orks')
    writeCatalogue(join(sub, 'lib-Unaligned.json'), 'Unaligned')

    const factions = fixtureFactions(dir)

    expect(factions).toHaveLength(1)
    expect(factions[0]?.libraryFiles).toEqual([join(sub, 'lib-Unaligned.json')])
  })

  it('reports no factions when the directory holds only a game system', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'gs.json'), JSON.stringify({ gameSystem: { id: 'gs' } }))

    expect(fixtureFactions(dir)).toEqual([])
  })
})
