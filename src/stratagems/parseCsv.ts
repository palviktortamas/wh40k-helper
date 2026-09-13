/**
 * Wahapedia's export format (spec Appendix A.2): UTF-8 with a BOM, `|` as the
 * delimiter, every row ending in a trailing `|`, long text fields in HTML. This
 * file knows the *shape*; the content only ever exists on the device.
 */

import { htmlToMarked } from './marked'
import type { Stratagem } from './types'

/** Rows as objects keyed by the header, BOM and trailing empty column dropped. */
export function parsePipeCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const headerLine = lines.shift() ?? ''
  const header = headerLine.split('|').map((h) => h.trim())
  if (header[header.length - 1] === '') header.pop()
  const rows: Record<string, string>[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const cells = line.split('|')
    if (cells.length > header.length && cells[cells.length - 1] === '') cells.pop()
    const row: Record<string, string> = {}
    header.forEach((name, i) => {
      row[name] = cells[i] ?? ''
    })
    rows.push(row)
  }
  return rows
}

const SECTION = /<b>\s*(WHEN|TARGET|EFFECT|RESTRICTIONS)\s*:?\s*<\/b>\s*:?/gi

/** Splits a stratagem description into its WHEN / TARGET / EFFECT / RESTRICTIONS parts. */
export function splitDescription(html: string): { when: string; target: string; effect: string; restrictions?: string } {
  const parts: Record<string, string> = {}
  let current = 'effect'
  let last = 0
  const pieces: [string, string][] = []
  for (const match of html.matchAll(SECTION)) {
    pieces.push([current, html.slice(last, match.index)])
    current = (match[1] ?? '').toLowerCase()
    last = (match.index ?? 0) + match[0].length
  }
  pieces.push([current, html.slice(last)])
  for (const [key, chunk] of pieces) {
    const text = htmlToMarked(chunk)
    if (text) parts[key] = parts[key] ? `${parts[key]}\n${text}` : text
  }
  return {
    when: parts['when'] ?? '',
    target: parts['target'] ?? '',
    effect: parts['effect'] ?? '',
    ...(parts['restrictions'] ? { restrictions: parts['restrictions'] } : {}),
  }
}

const apostrophes = (s: string) => s.replace(/[‘’ʼ]/g, "'").trim()

/** The 11th-edition Core Stratagems are typed exactly "Core Stratagem" in the export. */
const CORE_TYPE = /^core stratagem$/i
/** "War Horde Stratagem", "Saga of the Bold – Epic Deed Stratagem" → the category after the dash. */
const CATEGORY = /[–-]\s*([^–-]+?)\s+Stratagem\s*$/i

/**
 * Turns the export's stratagem table into the app's model. Rows that are not
 * Stratagems (the export also lists core movement abilities in the same table)
 * are dropped, as are the previous edition's core rows that the export still
 * carries under a different type spelling.
 */
export function parseStratagems(csv: string): Stratagem[] {
  const out: Stratagem[] = []
  for (const row of parsePipeCsv(csv)) {
    const type = (row['type'] ?? '').trim()
    const name = (row['name'] ?? '').trim()
    const id = (row['id'] ?? '').trim()
    if (!id || !name || !/stratagem/i.test(type)) continue
    const factionId = (row['faction_id'] ?? '').trim()
    const core = CORE_TYPE.test(type)
    // Faction-less rows that are not the current Core set: another game mode or an older edition.
    if (!factionId && !core) continue
    const detachment = (row['detachment'] ?? '').trim()
    if (!core && !detachment) continue
    const cp = Number.parseInt(row['cp_cost'] ?? '', 10)
    const category = CATEGORY.exec(type)?.[1]?.trim()
    const legend = htmlToMarked(row['legend'] ?? '')
    out.push({
      id,
      name,
      factionId,
      detachment,
      ...(category ? { category } : {}),
      cp: Number.isFinite(cp) ? cp : 0,
      ...(legend ? { legend } : {}),
      turn: apostrophes(row['turn'] ?? ''),
      phase: apostrophes(row['phase'] ?? ''),
      ...splitDescription(row['description'] ?? ''),
      core,
    })
  }
  return out
}
