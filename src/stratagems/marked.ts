/**
 * A tiny plain-text markup shared by every rules-text source: `**KEYWORD**`
 * for a game keyword (BSData writes it this way already) and `__text__` for
 * ordinary emphasis. HTML from other sources is converted into it once, at
 * import, so screens render one format and never inject HTML.
 *
 * BSData's own text also carries `^^KEYWORD^^`, `^^**KEYWORD**^^` and the
 * mis-nested `^^**KEYWORD^^**` (all keywords), `<ins>…</ins>` (a change mark,
 * shown as its text) and markdown italics `*text*`, which `parseMarked`
 * reads too.
 */

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")

export function htmlToMarked(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/li>|<ul[^>]*>|<ol[^>]*>|<\/ul>|<\/ol>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<span[^>]*class="kwb?"[^>]*>([\s\S]*?)<\/span>/gi, '**$1**')
      .replace(/<b>([\s\S]*?)<\/b>/gi, '__$1__')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Every spelling of a keyword becomes `**KEYWORD**`, and `<ins>` goes. Any
 * `^^` still left over (an unpaired one) is dropped rather than shown.
 */
export const normalizeMarks = (text: string): string =>
  text
    .replace(/<\/?ins>/gi, '')
    // The bold marks may sit inside the caret pair, outside it, or cross it.
    .replace(/(?:\*\*)?\^\^(?:\*\*)?([^*^]+?)(?:\*\*)?\^\^(?:\*\*)?/g, '**$1**')
    .replace(/\^\^/g, '')

export type MarkedPart = { kind: 'text' | 'keyword' | 'bold' | 'break'; text: string; italic?: boolean }

/** Splits marked text into renderable parts. */
export function parseMarked(raw: string): MarkedPart[] {
  const text = normalizeMarks(raw)
  const parts: MarkedPart[] = []
  // In order of precedence at one position: a bold lead-in inside an italic
  // run (`***Example:** rest*`), a keyword, emphasis, an italic run, a break.
  const pattern = /\*\*\*([^*]+)\*\*([^*]*)\*|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|\n/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) })
    if (match[1] !== undefined) {
      parts.push({ kind: 'bold', text: match[1], italic: true })
      if (match[2]) parts.push({ kind: 'text', text: match[2], italic: true })
    } else if (match[3] !== undefined) parts.push({ kind: 'keyword', text: match[3] })
    else if (match[4] !== undefined) parts.push({ kind: 'bold', text: match[4] })
    else if (match[5] !== undefined) parts.push({ kind: 'text', text: match[5], italic: true })
    else parts.push({ kind: 'break', text: '' })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** The text with all marks removed, for search and one-line summaries. */
export const unmarked = (text: string): string =>
  normalizeMarks(text)
    .replace(/\*\*\*([^*]+)\*\*([^*]*)\*/g, '$1$2')
    .replace(/\*\*|__/g, '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
