import { Fragment } from 'react'
import { parseMarked } from '@/stratagems/marked'

/**
 * Renders rules text in the app's marked form: `**KEYWORD**` as a keyword
 * mark, `__text__` as emphasis, newlines as breaks. Never HTML — every source
 * is converted to this at import, so the screen has one renderer.
 */
export function Marked({ text, className }: { text: string; className?: string }) {
  const parts = parseMarked(text)
  return (
    <span className={className}>
      {parts.map((part, i) => {
        switch (part.kind) {
          case 'keyword':
            return (
              <b key={i} className="kw">
                {part.text}
              </b>
            )
          case 'bold':
            return <b key={i}>{part.text}</b>
          case 'break':
            return <br key={i} />
          default:
            return <Fragment key={i}>{part.text}</Fragment>
        }
      })}
    </span>
  )
}
