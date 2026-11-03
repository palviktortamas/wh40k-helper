import { Fragment } from 'react'
import { parseMarked } from '@/stratagems/marked'

/**
 * Renders rules text in the app's marked form: `**KEYWORD**` as a keyword
 * mark, `__text__` as emphasis, `*text*` as italics, newlines as breaks. Never
 * HTML — every source is converted to this at import, so the screen has one
 * renderer.
 */
export function Marked({ text, className }: { text: string; className?: string }) {
  const parts = parseMarked(text)
  return (
    <span className={className}>
      {parts.map((part, i) => {
        let node = <Fragment key={i}>{part.text}</Fragment>
        if (part.kind === 'break') return <br key={i} />
        if (part.kind === 'keyword')
          node = (
            <b key={i} className="kw">
              {part.text}
            </b>
          )
        else if (part.kind === 'bold') node = <b key={i}>{part.text}</b>
        return part.italic ? <i key={i}>{node}</i> : node
      })}
    </span>
  )
}
