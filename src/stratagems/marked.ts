/**
 * A tiny plain-text markup shared by every rules-text source: `**KEYWORD**`
 * for a game keyword (BSData writes it this way already) and `__text__` for
 * ordinary emphasis. HTML from other sources is converted into it once, at
 * import, so screens render one format and never inject HTML.
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

export type MarkedPart = { kind: 'text' | 'keyword' | 'bold' | 'break'; text: string }

/** Splits marked text into renderable parts. */
export function parseMarked(text: string): MarkedPart[] {
  const parts: MarkedPart[] = []
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|\n/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) })
    if (match[1] !== undefined) parts.push({ kind: 'keyword', text: match[1] })
    else if (match[2] !== undefined) parts.push({ kind: 'bold', text: match[2] })
    else parts.push({ kind: 'break', text: '' })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** The text with all marks removed, for search and one-line summaries. */
export const unmarked = (text: string): string => text.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim()
