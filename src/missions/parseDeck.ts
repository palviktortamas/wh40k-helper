/**
 * Converts Wahapedia's "Mission Deck 2026-27" page into the app's mission
 * schema, on the device (spec §6.1, §4.2). The page is fetched through the
 * owner's endpoint or picked as a saved file; it is never stored in the repo.
 *
 * The page marks every card with a small, stable CSS vocabulary
 * (`cgCardCA7`, `ca7Name`, `caPmBlock`, `caPmScore`, `caPmVP`, …). Section
 * boundaries are the `<h2>` headings with fixed ids.
 */

import {
  DECK_ID,
  DECK_SCHEMA_VERSION,
  slug,
  type DeploymentCard,
  type ForceDispositionCard,
  type ForceDispositionName,
  type MissionCard,
  type MissionDeck,
  type ObjectiveAction,
  type PrimaryMission,
  type ScoreBlock,
  type ScoreLine,
  type SecondaryMission,
  type Twist,
} from './types'

export const DECK_SOURCE_URL = 'https://wahapedia.ru/wh40k11ed/the-rules/mission-deck-2026-27/'
const IMAGE_ORIGIN = 'https://wahapedia.ru'

const SECTION_IDS = {
  dispositions: 'Force-Disposition-Cards',
  primaries: 'Primary-Mission-deck',
  deployments: 'Deployment-deck',
  secondaries: 'Secondary-Mission-deck',
  twists: 'Twist-deck',
} as const

/** CSS class suffixes the page uses for the five dispositions. */
const DISPOSITION_CLASSES: Record<string, ForceDispositionName> = {
  TakeAndHold: 'Take and Hold',
  PurgeTheFoe: 'Purge the Foe',
  Disruption: 'Disruption',
  Reconnaissance: 'Reconnaissance',
  PriorityAssets: 'Priority Assets',
}

export class MissionParseError extends Error {}

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const dispositionFromClasses = (el: Element | null | undefined): ForceDispositionName | undefined => {
  if (!el) return undefined
  for (const cls of Array.from(el.classList)) {
    const key = Object.keys(DISPOSITION_CLASSES).find((k) => cls.includes(k))
    if (key) return DISPOSITION_CLASSES[key]
  }
  return undefined
}

/**
 * Cards between a section heading and whatever follows the deck. Each deck is
 * laid out in `.Columns2` wrappers (separated by `<br>`); the first sibling
 * that is neither ends the section — the interactive mission generator that
 * follows the last deck holds copies of every card and must not be read.
 */
function cardsAfter(doc: Document, id: string): Element[] {
  const heading = doc.getElementById(id)
  if (!heading) throw new MissionParseError(`The page has no "${id}" section — is this the mission deck page?`)
  const cards: Element[] = []
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.tagName === 'BR' || el.tagName === 'A') continue
    if (!el.classList.contains('Columns2')) break
    cards.push(...Array.from(el.querySelectorAll('.cgCardCA7')))
  }
  return cards
}

const parseVp = (raw: string): number | undefined => {
  const m = /([+-]?\d+)\s*VP/i.exec(raw)
  return m ? Number(m[1]) : undefined
}

const parseCap = (raw: string): number | undefined => {
  const m = /UP TO\s*(\d+)\s*VP/i.exec(raw)
  return m ? Number(m[1]) : undefined
}

function parseScore(el: Element): ScoreLine {
  const line: ScoreLine = { text: '', cumulative: false }
  const parts: string[] = []
  for (const child of Array.from(el.children)) {
    if (child.classList.contains('caPmPlus')) line.join = 'plus'
    else if (child.classList.contains('caPmOr')) line.join = 'or'
    else if (child.classList.contains('caPmVPPair')) {
      for (const col of Array.from(child.children)) {
        const vp = parseVp(text(col.querySelector('.caPmVP')))
        const labels = Array.from(col.querySelectorAll('.caPmCumul')).map(text)
        if (labels.some((l) => /FIXED/i.test(l)) && vp !== undefined) line.fixedVp = vp
        if (labels.some((l) => /TACTICAL/i.test(l)) && vp !== undefined) line.tacticalVp = vp
        const cap = labels.map(parseCap).find((c) => c !== undefined)
        if (cap !== undefined) line.cap = cap
        if (labels.some((l) => /CUMULATIVE/i.test(l))) line.cumulative = true
      }
    } else if (child.classList.contains('caPmVPCol') || child.classList.contains('caPmVP')) {
      const vp = parseVp(text(child.querySelector('.caPmVP') ?? child))
      if (vp !== undefined) line.vp = vp
      const labels = Array.from(child.querySelectorAll('.caPmCumul')).map(text)
      if (labels.some((l) => /CUMULATIVE/i.test(l))) line.cumulative = true
      if (labels.some((l) => /FIXED/i.test(l)) && vp !== undefined) line.fixedVp = vp
      const cap = labels.map(parseCap).find((c) => c !== undefined)
      if (cap !== undefined) line.cap = cap
    } else parts.push(text(child))
  }
  line.text = parts.join(' ').trim()
  return line
}

function parseBlock(el: Element): ScoreBlock {
  const block: ScoreBlock = { header: text(el.querySelector('.caPmHdr')), lines: [] }
  for (const child of Array.from(el.children)) {
    if (child.classList.contains('caPmWhen')) {
      const when = text(child).replace(/^WHEN:\s*/i, '')
      // A block can change its timing mid-way; the later lines get the new one.
      if (block.lines.length === 0) block.when = when
      else block.lines.push({ text: `WHEN: ${when}`, cumulative: false })
    } else if (child.classList.contains('caPmScore')) block.lines.push(parseScore(child))
  }
  return block
}

function parseAction(el: Element): ObjectiveAction {
  return {
    name: text(el.querySelector('.caActHdr')),
    type: text(el.querySelector('.caActType')),
    rows: Array.from(el.querySelectorAll('.caActRow')).map((row) => {
      const label = text(row.querySelector('.caActLbl')).replace(/:$/, '')
      const body = text(row).replace(/^[^:]*:\s*/, '')
      return { label, text: body }
    }),
  }
}

function parseCard(el: Element): MissionCard {
  const name = text(el.querySelector('.ca7Name'))
  const legend = text(el.querySelector('.ca7Legend'))
  const card: MissionCard = {
    id: slug(name),
    name,
    ...(legend ? { legend } : {}),
    intro: [],
    actions: [],
    blocks: [],
    notes: [],
  }
  const body = el.querySelector('.ca7Body')
  for (const child of Array.from(body?.children ?? [])) {
    if (child.classList.contains('caPmIntro')) {
      const t = text(child)
      if (/^WHEN DRAWN:/i.test(t)) card.whenDrawn = t.replace(/^WHEN DRAWN:\s*/i, '')
      else card.intro.push(t)
    } else if (child.classList.contains('caAct')) card.actions.push(parseAction(child))
    else if (child.classList.contains('caPmBlock')) card.blocks.push(parseBlock(child))
    else if (child.classList.contains('caPmNote')) card.notes.push(text(child))
  }
  return card
}

function parseDispositionCard(el: Element): ForceDispositionCard {
  const name = dispositionFromClasses(el.querySelector('.ca7Head'))
  if (!name) throw new MissionParseError(`Unrecognised Force Disposition card "${text(el.querySelector('.ca7Name'))}"`)
  const legend = text(el.querySelector('.ca7Legend'))
  const rows = Array.from(el.querySelectorAll('.caFdRow')).flatMap((row) => {
    const icons = Array.from(row.querySelectorAll('.caFdIcons > div'))
    const opponent = dispositionFromClasses(icons[1])
    const mission = text(row.querySelector('.caFdMissionName'))
    return opponent && mission ? [{ opponent, mission }] : []
  })
  return { name, ...(legend ? { legend } : {}), rows }
}

function parsePrimary(el: Element): PrimaryMission {
  const card = parseCard(el)
  const disposition =
    dispositionFromClasses(el.querySelector('.ca7FdPlayer > div')) ??
    dispositionFromClasses(el.querySelector('.ca7Head'))
  const opponentDisposition = dispositionFromClasses(el.querySelector('.ca7FdOpp > div:not(.ca7FdLbl)'))
  if (!disposition || !opponentDisposition)
    throw new MissionParseError(`Primary mission "${card.name}" has no disposition pairing`)
  return { ...card, disposition, opponentDisposition }
}

function parseSecondary(el: Element): SecondaryMission {
  return { ...parseCard(el), fixedEligible: el.querySelector('.ca7Fixed') !== null }
}

function parseDeployment(el: Element): DeploymentCard {
  const name = text(el.querySelector('.ca7Name'))
  const src = el.querySelector('img')?.getAttribute('src') ?? ''
  const imageUrl = src.startsWith('http') ? src : `${IMAGE_ORIGIN}${src}`
  return { id: slug(name), name, imageUrl }
}

export function parseMissionDeck(doc: Document, sourceUrl = DECK_SOURCE_URL): MissionDeck {
  const deck: MissionDeck = {
    id: DECK_ID,
    schemaVersion: DECK_SCHEMA_VERSION,
    sourceUrl,
    importedAt: Date.now(),
    forceDispositions: cardsAfter(doc, SECTION_IDS.dispositions).map(parseDispositionCard),
    primaries: cardsAfter(doc, SECTION_IDS.primaries).map(parsePrimary),
    deployments: cardsAfter(doc, SECTION_IDS.deployments).map(parseDeployment),
    secondaries: cardsAfter(doc, SECTION_IDS.secondaries).map(parseSecondary),
    twists: cardsAfter(doc, SECTION_IDS.twists).map((el): Twist => parseCard(el)),
  }
  if (deck.primaries.length === 0 || deck.secondaries.length === 0)
    throw new MissionParseError('No mission cards found on the page.')
  return deck
}

/** Browser entry point: HTML text → deck. */
export function parseMissionDeckHtml(html: string, sourceUrl = DECK_SOURCE_URL): MissionDeck {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return parseMissionDeck(doc, sourceUrl)
}
