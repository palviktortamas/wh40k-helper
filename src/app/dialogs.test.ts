import { afterEach, describe, expect, it } from 'vitest'
import { answer, ask, currentDialog, resetDialogs, tell } from './dialogs'

afterEach(() => resetDialogs())

describe('the app’s own dialogs', () => {
  it('asks, and resolves with the answer given', async () => {
    const pending = ask({ title: 'Delete "painted"?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })
    expect(currentDialog()).toMatchObject({ kind: 'confirm', title: 'Delete "painted"?', confirmLabel: 'Delete', danger: true })
    answer(true)
    expect(await pending).toBe(true)
    expect(currentDialog()).toBeUndefined()
  })

  it('treats closing without choosing as "no"', async () => {
    const pending = ask({ title: 'Log out?' })
    answer(false)
    expect(await pending).toBe(false)
  })

  // Two taps in a row must not lose a question: they queue.
  it('shows one at a time, in order', async () => {
    const first = ask({ title: 'First?' })
    const second = tell({ title: 'Copied', text: 'some text' })
    expect(currentDialog()?.title).toBe('First?')
    answer(true)
    expect(await first).toBe(true)
    expect(currentDialog()).toMatchObject({ kind: 'notice', title: 'Copied', text: 'some text' })
    answer(false)
    await second
    expect(currentDialog()).toBeUndefined()
  })
})
