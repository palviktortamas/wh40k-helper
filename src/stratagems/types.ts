/**
 * Stratagems (spec §6.3 / §6.4). BSData carries none, so they come from
 * Wahapedia's export — through the owner's endpoint or a file the owner saved.
 * Core Stratagems belong to every army; the others belong to one detachment
 * and are joined to a roster by detachment name.
 */

export type Stratagem = {
  /** Wahapedia stratagem id. */
  id: string
  name: string
  /** Wahapedia faction id; empty for Core Stratagems. */
  factionId: string
  /** Detachment name as printed; empty for Core Stratagems. */
  detachment: string
  /** "Battle Tactic", "Strategic Ploy", … when the export says. */
  category?: string
  cp: number
  legend?: string
  /** "Your turn" | "Opponent's turn" | "Either player's turn" (curly apostrophes normalised). */
  turn: string
  /** "Any phase", "Shooting phase", "Shooting or Fight phase", … */
  phase: string
  /** Plain text with `**KEYWORD**` and `__bold__` marks (see Marked). */
  when: string
  target: string
  effect: string
  restrictions?: string
  core: boolean
}

export type StratagemSet = {
  id: typeof STRATAGEM_SET_ID
  importedAt: number
  /** Stratagems across every faction in the export; filtered per game. */
  stratagems: Stratagem[]
}

export const STRATAGEM_SET_ID = 'wahapedia'
