import './Placeholder.css'

type Props = {
  phase: number
  title: string
  summary: string
  /** What this screen will actually do once the phase lands. */
  planned: string[]
}

/**
 * Honest stand-in for a screen that is specified but not yet built, so the
 * deployed app never implies a feature works before it does.
 */
export function Placeholder({ phase, title, summary, planned }: Props) {
  return (
    <section className="placeholder">
      <h2>{title}</h2>
      <p className="placeholder__badge">Phase {phase} — not implemented yet</p>
      <p>{summary}</p>
      <ul>
        {planned.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}
