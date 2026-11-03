/**
 * Which units a detachment rule (or a stratagem's TARGET line) speaks about.
 *
 * Rules text marks keywords in bold caps — "Friendly **ORKS INFANTRY** units'
 * ranged attacks have [ASSAULT]" — and that is the only structured link between
 * a detachment rule and the datasheets it improves (BSData attaches the rule to
 * the detachment entry, not to units). The matcher is generic: it reads the
 * keyword phrases and the words around them, never a faction name.
 *
 * Wahapedia marks keywords as `<span class="kwb">X</span>`; the stratagem
 * importer converts those to the same `**X**` form before storing — one span per
 * *word*, so adjacent spans are merged back into one phrase before reading.
 *
 * Not every codex bolds its keywords. Some write them in plain capitals ("Friendly
 * TOMB BLADES units have …"), some in `^^**Cryptek^^**` markup in any case. All
 * three spellings are normalised to `**PHRASE**` first (`normalise`), and the
 * readers below only ever see that one form.
 *
 * A rule with several clauses — bullets, or sentences — can name different units
 * in each ("Friendly BOYZ units … [SUSTAINED HITS 1]. … an ORKS INFANTRY unit that
 * charged … [LETHAL HITS]"). Each clause is scoped on its own, and a clause that
 * names nobody belongs to the units the clause before it named.
 */

/** Stat abbreviations and rule-mechanic words that also appear in bold caps. */
const NOT_KEYWORDS = new Set([
  'AP', 'S', 'R', 'A', 'D', 'T', 'M', 'W', 'OC', 'LD', 'SV', 'BS', 'WS', 'CP', 'VP',
  'BATTLELINE', 'PSYCHIC', 'ASSAULT', 'HEAVY', 'PISTOL', 'BLAST', 'TORRENT', 'LANCE',
])

/** One condition: every word must be a unit keyword; alternatives are joined by "/". */
export type KeywordClause = string[][] // alternatives → words

const clauseFrom = (token: string): KeywordClause | undefined => {
  const cleaned = token.replace(/[[\]]/g, '').replace(/\s*,\s*/g, '/').trim()
  // A weapon ability like "[SUSTAINED HITS 1]" or a lone stat letter is not a keyword.
  if (!cleaned || /\d/.test(cleaned) || cleaned !== cleaned.toUpperCase()) return undefined
  const alternatives = cleaned
    .split('/')
    .map((alt) => alt.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0 && !words.every((w) => NOT_KEYWORDS.has(w)))
  return alternatives.length > 0 ? alternatives : undefined
}

const WORD = "[A-Z][A-Z'’‑-]+"
/**
 * Either a bold span (kept as it is) or a plain-capitals phrase followed by
 * "unit(s)" / "model(s)" — words joined by "/", ",", "or", "and" — to be bolded.
 */
const PLAIN_CAPS = new RegExp(
  `(\\*\\*[^*]+\\*\\*)|\\b(${WORD}(?:(?:\\s*[/,]\\s*|\\s+(?:or|and)\\s+|\\s+)${WORD})*)(?=(?:'s|’s)?\\s+(?:units?|models?)\\b)`,
  'g',
)
/** "a NECRONS CHARACTER model is leading this unit" names the leader, not the unit that is scoped. */
const LEADER = /(?:\*\*[^*]+\*\*|(?:[A-Z][A-Z'’‑-]+\s+)+)(?=models?\s+(?:is|are)\s+leading\b)/g

/** Every spelling of a keyword phrase, as `**PHRASE**`. */
function normalise(text: string): string {
  let out = text
    .replace(/\^\^\*\*(.+?)(?:\^\^\*\*|\*\*\^\^)/g, (_m, keyword: string) => `**${keyword.toUpperCase()}**`)
    .replace(LEADER, '')
  // Wahapedia bolds a multi-word keyword one word at a time.
  for (let previous = ''; previous !== out; ) {
    previous = out
    out = out.replace(/\*\*(\s*[/,]?\s*)\*\*/g, '$1')
  }
  return out.replace(PLAIN_CAPS, (match, bold: string | undefined, phrase: string | undefined) =>
    bold ? match : `**${(phrase ?? '').replace(/\s*,\s*|\s+(?:or|and)\s+/g, '/')}**`,
  )
}

/** "friendly **X** units", "a friendly **X** model", "your **X** units" — the units the rule is for. */
const FRIENDLY = /\b(?:friendly|your)\s+\*\*([^*]+)\*\*/gi
/** Fallback: any "**X** unit(s)/model(s)" phrase. */
const ANY_UNIT = /\*\*([^*]+)\*\*(?:'s|’s)?\s+(?:units?|models?)\b/gi
/** "(excluding **TITANIC** units)", "excluding **A, B** and **C** models" */
const EXCLUDING = /excluding\s+((?:\*\*[^*]+\*\*(?:\s*(?:,|and|or|\/)\s*)?)+)/gi
/** "You can only select a **VEHICLE** unit if …" limits the choice; it does not say who the target is. */
const RESTRICTION = /\byou can only select\b/i

export type RuleScope = {
  /** Clauses a unit must satisfy one of; empty means the rule is army-wide. */
  include: KeywordClause[]
  exclude: KeywordClause[]
}

const collect = (pattern: RegExp, text: string): KeywordClause[] => {
  const out: KeywordClause[] = []
  for (const match of text.matchAll(pattern)) {
    const captured = match[1] ?? ''
    const spans = captured.includes('**') ? [...captured.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1] ?? '') : [captured]
    for (const span of spans) {
      const clause = clauseFrom(span)
      if (clause) out.push(clause)
    }
  }
  return out
}

const sameClause = (a: KeywordClause, b: KeywordClause) => JSON.stringify(a) === JSON.stringify(b)

const scopeOfNormalised = (text: string): RuleScope => {
  const exclude = collect(EXCLUDING, text)
  const notExcluded = (c: KeywordClause) => !exclude.some((e) => sameClause(e, c))
  let include = collect(FRIENDLY, text).filter(notExcluded)
  if (include.length === 0) include = collect(ANY_UNIT, text).filter(notExcluded)
  return { include, exclude }
}

/** One clause of a rule: a bullet or a sentence (or the line break between them), with what it names. */
type Clause = { text: string; scope: RuleScope; neutral: boolean }

const NOBODY: RuleScope = { include: [], exclude: [] }

/**
 * The rule split into bullets and sentences, each scoped to the units it names.
 * A clause that names nobody takes the scope of the clause before it (a bullet
 * under "Friendly X units have:" is about X); one before any named clause stays
 * unscoped and is for whoever the rule reaches.
 */
function clausesOf(text: string): Clause[] {
  const clauses: Clause[] = []
  let current: RuleScope | undefined
  for (const line of text.split('\n')) {
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z*"“'‘-])/).filter((s) => s.trim())
    for (const sentence of sentences.length > 0 ? sentences : [line]) {
      const normalised = normalise(sentence)
      if (RESTRICTION.test(normalised)) {
        clauses.push({ text: sentence, scope: NOBODY, neutral: true })
        continue
      }
      const own = scopeOfNormalised(normalised)
      if (own.include.length > 0) current = own
      clauses.push({ text: sentence, scope: own.include.length > 0 ? own : (current ?? own), neutral: false })
    }
    clauses.push({ text: '\n', scope: NOBODY, neutral: true })
  }
  clauses.pop()
  return clauses
}

/** Reads the keyword conditions out of a rule's text — the union over all its clauses. */
export function ruleScope(text: string): RuleScope {
  const include: KeywordClause[] = []
  const exclude: KeywordClause[] = []
  for (const clause of clausesOf(text)) {
    for (const c of clause.scope.include) if (!include.some((i) => sameClause(i, c))) include.push(c)
    for (const c of clause.scope.exclude) if (!exclude.some((i) => sameClause(i, c))) exclude.push(c)
  }
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

const scopeNames = (scope: RuleScope, words: Set<string>): boolean =>
  !scope.exclude.some((c) => clauseMatches(c, words)) && scope.include.some((c) => clauseMatches(c, words))

/**
 * Whether a rule names this unit. `undefined` when the rule names no unit at all
 * (an army-wide rule), so callers can show it once rather than on every card.
 */
export function ruleAppliesTo(text: string, keywords: readonly string[]): boolean | undefined {
  const scoped = clausesOf(text).filter((c) => c.scope.include.length > 0)
  if (scoped.length === 0) return undefined
  const words = keywordWords(keywords)
  return scoped.some((c) => scopeNames(c.scope, words))
}

/**
 * The rule as it reads for this unit: the clauses that name the unit and the
 * ones that name nobody, with the clauses about other units left out. A rule
 * that names no unit comes back whole; one that names only others, `undefined`.
 */
export function ruleTextFor(text: string, keywords: readonly string[]): string | undefined {
  const applies = ruleAppliesTo(text, keywords)
  if (applies === undefined) return text
  if (!applies) return undefined
  const words = keywordWords(keywords)
  return clausesOf(text)
    .filter((c) => c.neutral || c.scope.include.length === 0 || scopeNames(c.scope, words))
    .map((c) => c.text)
    .join(' ')
    .replace(/ ?\n ?/g, '\n')
}
