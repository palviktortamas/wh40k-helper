import { Fragment } from 'react'
import { parseMarked } from '@/stratagems/marked'
import { useTerms } from './Terms'

/**
 * Renders rules text in the app's marked form: `**KEYWORD**` as a keyword
 * mark, `__text__` as emphasis, `*text*` as italics, newlines as breaks. Never
 * HTML — every source is converted to this at import, so the screen has one
 * renderer.
 *
 * A bold phrase that names a defined move or shooting type ("pulse jet move")
 * is a button that opens its definition (see Terms).
 */
export function Marked({ text, className }: { text: string; className?: string }) {
  const terms = useTerms()
  const parts = parseMarked(text)
  return (
    <span className={className}>
      {parts.map((part, i) => {
        let node = <Fragment key={i}>{part.text}</Fragment>
        if (part.kind === 'break') return <br key={i} />
        if (part.kind === 'keyword' || part.kind === 'bold') {
          const term = terms?.find(part.text)
          const className = part.kind === 'keyword' ? 'kw' : undefined
          node = term ? (
            <button
              key={i}
              type="button"
              className={`term ${className ?? ''}`}
              aria-label={`${part.text} — what it is`}
              onClick={() => terms!.open(term)}
            >
              {part.text}
            </button>
          ) : (
            <b key={i} className={className}>
              {part.text}
            </b>
          )
        }
        return part.italic ? <i key={i}>{node}</i> : node
      })}
    </span>
  )
}
