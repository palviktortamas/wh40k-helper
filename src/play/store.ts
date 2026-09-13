/**
 * Game persistence. Games are snapshots: they carry every unit's stats and
 * loadout, so a game keeps working after the roster changes or the data updates.
 */

import { db } from '@/data/db'
import type { CatalogueRecord } from '@/data/db'
import type { Roster } from '@/roster/types'
import type { Validation } from '@/roster/store'
import { buildGameUnits } from './snapshot'
import type { Game, Side } from './types'

export type StartOptions = {
  opponentName: string
  opponentFaction: string
  firstTurn: Side
}

export function newGame(
  roster: Roster,
  catalogue: CatalogueRecord,
  validation: Validation,
  options: StartOptions,
): Game {
  const now = Date.now()
  const game: Game = {
    id: `game-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    rosterId: roster.id,
    rosterName: roster.name,
    catalogueId: catalogue.id,
    factionName: catalogue.name,
    ...(validation.detachment ? { detachmentName: validation.detachment.name } : {}),
    pointsLimit: roster.pointsLimit,
    opponentName: options.opponentName.trim() || 'Opponent',
    opponentFaction: options.opponentFaction.trim(),
    firstTurn: options.firstTurn,
    startedIllegal: !validation.legal,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    round: 1,
    phase: 'command',
    turn: options.firstTurn,
    // Both players start with 0 CP and gain 1 at the start of their first Command phase (Core Rules).
    me: { cp: options.firstTurn === 'me' ? 1 : 0, vpPrimary: 0, vpSecondary: 0 },
    opponent: { cp: options.firstTurn === 'opponent' ? 1 : 0, vpPrimary: 0, vpSecondary: 0 },
    units: buildGameUnits(roster, catalogue.parsed, validation),
    vpByRound: {},
    log: [
      {
        at: now,
        round: 1,
        phase: 'command',
        turn: options.firstTurn,
        text: `Game started — ${options.firstTurn === 'me' ? 'you have' : 'the opponent has'} the first turn`,
      },
    ],
    undo: [],
  }
  return game
}

export const listGames = (): Promise<Game[]> => db.games.orderBy('updatedAt').reverse().toArray()

export const getGame = (id: string): Promise<Game | undefined> => db.games.get(id)

export async function saveGame(game: Game): Promise<Game> {
  const saved = { ...game, updatedAt: Date.now() }
  await db.games.put(saved)
  return saved
}

export const deleteGame = (id: string): Promise<void> => db.games.delete(id)
