/**
 * Which units a detachment rule (or a stratagem's TARGET line) speaks about.
 *
 * Rules text marks keywords in bold caps — "Friendly **ORKS INFANTRY** units'
 * ranged attacks have [ASSAULT]" — and that is the only structured link between
 * a detachment rule and the datasheets it improves (BSData attaches the rule to
 * the detachment entry, not to units). The matcher is generic: it reads the
 * bold tokens and the words around them, never a faction name.
 *
 * Wahapedia marks keywords as `<span class="kwb">X</span>`; the stratagem
 * importer converts those to the same `**X**` form before storing.
 */

/** Stat abbreviations and rule-mechanic words that also appear in bold caps. */
const NOT_KEYWORDS = new Set([
  'AP', 'S', 'R', 'A', 'D', 'T', 'M', 'W', 'OC', 'LD', 'SV', 'BS', 'WS', 'CP', 'VP',
  'BATTLELINE', 'PSYCHIC', 'ASSAULT', 'HEAVY', 'PISTOL', 'BLAST', 'TORRENT', 'LANCE',
])

/** One condition: every word must be a unit keyword; alternatives are joined by "/". */
export type KeywordClause = string[][] // alternatives → words

const clauseFrom = (token: string): KeywordClause | undefined => {
  const cleaned = token.replace(/[[\]]/g, '').trim()
  // A weapon ability like "[SUSTAINED HITS 1]" or a lone stat letter is not a keyword.
  if (!cleaned || /\d/.test(cleaned) || cleaned !== cleaned.toUpperCase()) return undefined
  const alternatives = cleaned
    .split('/')
    .map((alt) => alt.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0 && !words.every((w) => NOT_KEYWORDS.has(w)))
  return alternatives.length > 0 ? alternatives : undefined
}

/** "friendly **X** units", "a friendly **X** model", "your **X** units" — the units the rule is for. */
const FRIENDLY = /\b(?:friendly|your)\s+\*\*([^*]+)\*\*/gi
/** Fallback: any "**X** unit(s)/model(s)" phrase. */
const ANY_UNIT = /\*\*([^*]+)\*\*(?:'s|’s)?\s+(?:units?|models?)\b/gi
/** "(excluding **TITANIC** units)" */
const EXCLUDING = /excluding\s+\*\*([^*]+)\*\*/gi

export type RuleScope = {
  /** Clauses a unit must satisfy one of; empty means the rule is army-wide. */
  include: KeywordClause[]
  exclude: KeywordClause[]
}

const collect = (pattern: RegExp, text: string): KeywordClause[] => {
  const out: KeywordClause[] = []
  for (const match of text.matchAll(pattern)) {
    const clause = clauseFrom(match[1] ?? '')
    if (clause) out.push(clause)
  }
  return out
}

/** Reads the keyword conditions out of a rule's text. */
export function ruleScope(text: string): RuleScope {
  const exclude = collect(EXCLUDING, text)
  const excluded = new Set(exclude.map((c) => JSON.stringify(c)))
  let include = collect(FRIENDLY, text).filter((c) => !excluded.has(JSON.stringify(c)))
  if (include.length === 0) include = collect(ANY_UNIT, text).filter((c) => !excluded.has(JSON.stringify(c)))
  return { include, exclude }
}

/** Every word of every keyword a unit carries, lower-cased. */
export function keywordWords(keywords: readonly string[]): Set<string> {
  const words = new Set<string>()
  for (const keyword of keywords) for (const w of keyword.toLowerCase().split(/[\s/]+/)) if (w) words.add(w)
  return words
}

const clauseMatches = (clause: KeywordClause, words: Set<string>): boolean =>
  clause.some((alternative) => alternative.every((w) => words.has(w.toLowerCase())))

/**
 * Whether a rule names this unit. `undefined` when the rule names no unit at all
 * (an army-wide rule), so callers can show it once rather than on every card.
 */
export function ruleAppliesTo(text: string, keywords: readonly string[]): boolean | undefined {
  const scope = ruleScope(text)
  if (scope.include.length === 0) return undefined
  const words = keywordWords(keywords)
  if (scope.exclude.some((c) => clauseMatches(c, words))) return false
  return scope.include.some((c) => clauseMatches(c, words))
}
