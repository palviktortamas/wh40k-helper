/**
 * Game persistence. Games are snapshots: they carry every unit's stats and
 * loadout, so a game keeps working after the roster changes or the data updates.
 */

import { db } from '@/data/db'
import type { CatalogueRecord } from '@/data/db'
import type { Roster } from '@/roster/types'
import type { Validation } from '@/roster/store'
import { buildGameUnits } from './snapshot'
import type { Game, MissionState, Side } from './types'
import { recordDeletion } from '@/sync/client'

export type StartOptions = {
  opponentName: string
  opponentFaction: string
  firstTurn: Side
  /** From the setup wizard, when the mission deck is imported. */
  mission?: MissionState
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
    detachmentNames: validation.detachments.map((d) => d.name),
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
    // The game opens in the first Command phase, whose "Gain Core CP" step gives
    // *both* players 1 CP (11th edition Core Rules) — not only the active player.
    me: { cp: 1, vpPrimary: 0, vpSecondary: 0 },
    opponent: { cp: 1, vpPrimary: 0, vpSecondary: 0 },
    units: buildGameUnits(roster, catalogue.parsed, validation),
    vpByRound: {},
    ...(options.mission ? { mission: options.mission } : {}),
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

export async function deleteGame(id: string): Promise<void> {
  await db.games.delete(id)
  await recordDeletion('games', id)
}
