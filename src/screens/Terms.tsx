import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getStratagemSet, STRATAGEMS_CHANGED } from '@/stratagems/store'
import { termFor, type RuleTerm } from '@/stratagems/terms'
import { Marked } from './Marked'
import './Terms.css'

type TermsState = {
  find: (words: string) => RuleTerm | undefined
  open: (term: RuleTerm) => void
}

const TermsContext = createContext<TermsState | undefined>(undefined)

/** The definition a rule's bold words name, and a way to show it; undefined outside the provider. */
export const useTerms = (): TermsState | undefined => useContext(TermsContext)

/**
 * Makes the edition's move and shooting types ("pulse jet move") explainable
 * wherever rules text is shown: `Marked` turns a bold phrase that names one
 * into a button, and the definition opens in a sheet over the screen.
 */
export function TermsProvider({ children }: { children: ReactNode }) {
  const [terms, setTerms] = useState<RuleTerm[]>([])
  const [shown, setShown] = useState<RuleTerm | undefined>()

  useEffect(() => {
    const load = () => void getStratagemSet().then((set) => setTerms(set?.terms ?? []))
    load()
    window.addEventListener(STRATAGEMS_CHANGED, load)
    return () => window.removeEventListener(STRATAGEMS_CHANGED, load)
  }, [])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShown(undefined)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown])

  const state: TermsState = { find: (words) => termFor(words, terms), open: setShown }

  return (
    <TermsContext.Provider value={state}>
      {children}
      {shown && (
        <div className="term-sheet__backdrop" onClick={() => setShown(undefined)}>
          <section
            className="term-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="term-sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="term-sheet__head">
              <h2 id="term-sheet-title">{shown.name}</h2>
              <button type="button" className="term-sheet__close" onClick={() => setShown(undefined)}>
                Close
              </button>
            </header>
            <p className="term-sheet__kind muted">{shown.kind} type</p>
            <p className="term-sheet__text">
              <Marked text={shown.text} />
            </p>
          </section>
        </div>
      )}
    </TermsContext.Provider>
  )
}
