/**
 * The v9 storage migration: a game recorded one detachment name, and an 11e
 * army may hold several. Games in progress must survive the change.
 */

import { describe, expect, it } from 'vitest'
import { migrateGameToManyDetachments } from './migrate'

describe('migrateGameToManyDetachments', () => {
  it('turns the one recorded detachment into a list of one', () => {
    const game: Record<string, unknown> = { id: 'g1', detachmentName: 'Bulwark Host' }

    migrateGameToManyDetachments(game)

    expect(game['detachmentNames']).toEqual(['Bulwark Host'])
    expect(game).not.toHaveProperty('detachmentName')
  })

  it('gives a game that never had a detachment an empty list', () => {
    const game: Record<string, unknown> = { id: 'g1' }

    migrateGameToManyDetachments(game)

    expect(game['detachmentNames']).toEqual([])
  })

  it('leaves a game that already holds a list alone', () => {
    const game: Record<string, unknown> = { id: 'g1', detachmentNames: ['A', 'B'] }

    migrateGameToManyDetachments(game)

    expect(game['detachmentNames']).toEqual(['A', 'B'])
  })

  it('drops an empty recorded name rather than carrying a blank detachment', () => {
    const game: Record<string, unknown> = { id: 'g1', detachmentName: '' }

    migrateGameToManyDetachments(game)

    expect(game['detachmentNames']).toEqual([])
  })
})
