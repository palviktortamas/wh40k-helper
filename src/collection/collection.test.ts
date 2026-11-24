import { describe, expect, it } from 'vitest'
import type { Datasheet } from '@/data/model'
import { collectionStats, hasStage, pointsForModels, startingModels, withCount } from './collection'
import type { CollectionEntry } from './types'

// Invented datasheets in the parsed model's shape — no game data.
const sheet = (id: string, extra: Partial<Datasheet>): Datasheet =>
  ({ id, name: id, keywords: [], factionKeywords: [], stats: [], weapons: [], abilities: [], models: [], associations: [], constraints: [], sources: [], type: 'unit', ...extra }) as Datasheet

const mob = sheet('mob', {
  role: 'Battleline',
  pricing: [{ from: 1, costs: [{ models: 10, points: 80 }, { models: 20, points: 150 }] }],
})
const hero = sheet('hero', { role: 'Character', pricing: [{ from: 1, costs: [{ models: 1, points: 60 }] }] })
const old = sheet('old', { role: 'Vehicle', basePoints: 100 })

const entry = (entryId: string, bought: number, assembled = 0, painted = 0): CollectionEntry => ({
  id: `cat:${entryId}`,
  catalogueId: 'cat',
  entryId,
  name: entryId,
  bought,
  assembled,
  painted,
  updatedAt: 0,
})

describe('a collection entry', () => {
  // What is painted has been assembled, and what is assembled was bought.
  it('keeps painted within assembled within bought', () => {
    expect(withCount(entry('mob', 10, 5, 2), 'painted', 8)).toMatchObject({ bought: 10, assembled: 8, painted: 8 })
    expect(withCount(entry('mob', 10, 8, 8), 'bought', 4)).toMatchObject({ bought: 4, assembled: 4, painted: 4 })
    expect(withCount(entry('mob', 10, 8, 3), 'assembled', 15)).toMatchObject({ bought: 15, assembled: 15, painted: 3 })
    expect(withCount(entry('mob', 10), 'bought', -3)).toMatchObject({ bought: 0, assembled: 0, painted: 0 })
  })

  it('starts at the smallest size the unit is priced at', () => {
    expect(startingModels(mob)).toBe(10)
    expect(startingModels(hero)).toBe(1)
    expect(startingModels(undefined)).toBe(1)
  })
})

describe('points of the models owned', () => {
  it('prices whole units from the list, the biggest first', () => {
    expect(pointsForModels(mob, 20)).toBe(150)
    expect(pointsForModels(mob, 30)).toBe(230)
    expect(pointsForModels(hero, 2)).toBe(120)
  })

  it('prices models short of a unit by the smallest unit’s rate', () => {
    expect(pointsForModels(mob, 5)).toBe(40)
    expect(pointsForModels(mob, 25)).toBe(190)
  })

  it('falls back to the catalogue cost per model when the list has no price', () => {
    expect(pointsForModels(old, 2)).toBe(200)
    expect(pointsForModels(undefined, 3)).toBe(0)
    expect(pointsForModels(mob, 0)).toBe(0)
  })
})

describe('collection statistics', () => {
  it('adds up models and points per stage', () => {
    const sheets = new Map([mob, hero].map((s) => [s.id, s]))
    const stats = collectionStats([entry('mob', 20, 10, 10), entry('hero', 2, 2, 1)], sheets)
    expect(stats.bought).toEqual({ models: 22, points: 270 })
    expect(stats.assembled).toEqual({ models: 12, points: 200 })
    expect(stats.painted).toEqual({ models: 11, points: 140 })
  })
})

describe('the add-unit filter', () => {
  it('asks whether any of a datasheet has reached a stage', () => {
    const owned = entry('mob', 10, 4, 0)
    expect(hasStage(owned, 'any')).toBe(true)
    expect(hasStage(undefined, 'any')).toBe(true)
    expect(hasStage(owned, 'bought')).toBe(true)
    expect(hasStage(owned, 'assembled')).toBe(true)
    expect(hasStage(owned, 'painted')).toBe(false)
    expect(hasStage(undefined, 'bought')).toBe(false)
  })
})
