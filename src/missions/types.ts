/**
 * The Chapter Approved mission deck (spec §6.1), as the app stores it after
 * converting Wahapedia's published page on the device. Nothing here is shipped
 * with the app: the schema is code, the cards are data the owner imports.
 */

export const DECK_ID = 'ca-2026-27'
export const DECK_SCHEMA_VERSION = 1

export type ForceDispositionName =
  | 'Take and Hold'
  | 'Purge the Foe'
  | 'Disruption'
  | 'Reconnaissance'
  | 'Priority Assets'

export const FORCE_DISPOSITIONS: readonly ForceDispositionName[] = [
  'Take and Hold',
  'Purge the Foe',
  'Disruption',
  'Reconnaissance',
  'Priority Assets',
]

/** One scoring line: condition text and what it is worth. */
export type ScoreLine = {
  text: string
  /** VP when the card has a single value. */
  vp?: number
  /** Secondary cards may pay differently in Fixed and Tactical mode. */
  fixedVp?: number
  tacticalVp?: number
  /** "(UP TO 5VP)" per scoring. */
  cap?: number
  cumulative: boolean
  /** How this line relates to the previous one on the card. */
  join?: 'plus' | 'or'
}

/** A card section: "SECOND BATTLE ROUND ONWARDS — WHEN: end of your Command phase — lines". */
export type ScoreBlock = {
  header: string
  when?: string
  lines: ScoreLine[]
}

export type ObjectiveAction = {
  name: string
  type: string
  /** STARTS / UNITS / USE LIMIT / COMPLETES / EFFECT / RESTRICTIONS …, as printed. */
  rows: { label: string; text: string }[]
}

export type MissionCard = {
  id: string
  name: string
  legend?: string
  /** Rules text before the scoring blocks; a secondary's WHEN DRAWN goes to `whenDrawn`. */
  intro: string[]
  whenDrawn?: string
  actions: ObjectiveAction[]
  blocks: ScoreBlock[]
  notes: string[]
}

export type PrimaryMission = MissionCard & {
  /** The player's Force Disposition this card belongs to. */
  disposition: ForceDispositionName
  /** The opponent's Force Disposition that makes this the player's primary. */
  opponentDisposition: ForceDispositionName
}

export type SecondaryMission = MissionCard & {
  fixedEligible: boolean
}

export type Twist = MissionCard

export type ForceDispositionCard = {
  name: ForceDispositionName
  legend?: string
  /** Opponent's disposition → the player's primary mission name. */
  rows: { opponent: ForceDispositionName; mission: string }[]
}

export type DeploymentCard = {
  id: string
  name: string
  imageUrl: string
}

export type MissionDeck = {
  id: string
  schemaVersion: number
  /** Where the cards came from and when. */
  sourceUrl: string
  importedAt: number
  /** Set when the owner edited a card in the app (spec §6.1); a re-import replaces the edits. */
  editedAt?: number
  forceDispositions: ForceDispositionCard[]
  primaries: PrimaryMission[]
  deployments: DeploymentCard[]
  secondaries: SecondaryMission[]
  twists: Twist[]
}

export const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Card names come in capitals; this is how they read on screen. */
export const titleCase = (name: string): string =>
  name
    .toLowerCase()
    .replace(/(^|[\s\-(])([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase())
    .replace(/\b(And|Of|The|On|In|To|A|No)\b/g, (w) => w.toLowerCase())
    .replace(/^([a-z])/, (c) => c.toUpperCase())

/**
 * Whether a scoring block's header applies in a battle round. Headers are the
 * card's own words: "ANY BATTLE ROUND", "FIRST AND SECOND BATTLE ROUND",
 * "SECOND BATTLE ROUND ONWARDS", "SECOND TO FOURTH BATTLE ROUND", "FIFTH
 * BATTLE ROUND", "END OF THE BATTLE". Unknown wording applies always, so a
 * card is never silently hidden.
 */
export function blockApplies(header: string, round: number, endOfBattle = false): boolean {
  const h = header.toUpperCase()
  if (/END OF THE BATTLE/.test(h)) return endOfBattle
  if (/ANY BATTLE ROUND/.test(h)) return true
  const ord: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5 }
  const words = h.match(/FIRST|SECOND|THIRD|FOURTH|FIFTH/g)?.map((w) => ord[w]!) ?? []
  if (words.length === 0) return true
  if (/ONWARDS/.test(h)) return round >= Math.min(...words)
  if (/\bTO\b/.test(h) && words.length === 2) return round >= words[0]! && round <= words[1]!
  return words.includes(round)
}

/** The player's primary mission for a pairing of dispositions, by name. */
export function primaryFor(
  deck: MissionDeck,
  mine: ForceDispositionName,
  theirs: ForceDispositionName,
): PrimaryMission | undefined {
  const card = deck.forceDispositions.find((c) => c.name === mine)
  const row = card?.rows.find((r) => r.opponent === theirs)
  const byRow = row && deck.primaries.find((p) => slug(p.name) === slug(row.mission))
  return byRow ?? deck.primaries.find((p) => p.disposition === mine && p.opponentDisposition === theirs)
}
