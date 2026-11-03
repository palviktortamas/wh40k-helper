import { describe, expect, it } from 'vitest'
import { normalizeMarks, parseMarked, unmarked } from './marked'

const flat = (text: string) => parseMarked(text).map((p) => `${p.kind}${p.italic ? '/i' : ''}:${p.text}`)

describe('parseMarked', () => {
  it('reads the three spellings of a keyword the same way', () => {
    const want = ['text:a ', 'keyword:INFANTRY', 'text: b']
    expect(flat('a **INFANTRY** b')).toEqual(want)
    expect(flat('a ^^INFANTRY^^ b')).toEqual(want)
    expect(flat('a ^^**INFANTRY**^^ b')).toEqual(want)
    expect(flat('a **^^INFANTRY^^** b')).toEqual(want)
    // Mis-nested: the closing marks arrive in the wrong order.
    expect(flat('a ^^**INFANTRY^^** b')).toEqual(want)
  })

  it('shows <ins> as its text', () => {
    expect(flat('a <ins>new words</ins> b')).toEqual(['text:a new words b'])
  })

  it('reads single stars as italic', () => {
    expect(flat('a *careful* b')).toEqual(['text:a ', 'text/i:careful', 'text: b'])
  })

  it('nests a bold lead-in inside an italic paragraph', () => {
    expect(flat('***Example:** a unit dies.*')).toEqual(['bold/i:Example:', 'text/i: a unit dies.'])
  })

  it('leaves no marks in the plain form', () => {
    for (const s of ['^^**A^^** b', '<ins>x</ins>', '*x* y', '***Example:** z.*', '^^K^^'])
      expect(unmarked(s)).not.toMatch(/\^\^|<ins>|\*/)
    expect(normalizeMarks('^^**A^^** b')).toBe('**A** b')
  })
})
