/**
 * The app's own confirmations and notices, in place of the browser's
 * `confirm()` / `alert()` boxes (owner: "I really hate this kind of alerts").
 * Any code can `ask` or `tell`; `DialogHost` draws the one at the front of the
 * queue. Kept apart from React so the queue is tested on its own.
 */

export type DialogRequest = {
  kind: 'confirm' | 'notice'
  title: string
  message?: string
  /** Text to show selectable, e.g. a roster to copy by hand when the clipboard is blocked. */
  text?: string
  confirmLabel: string
  cancelLabel: string
  /** The confirming action destroys something: drawn as a danger button. */
  danger: boolean
}

type Entry = DialogRequest & { resolve: (answer: boolean) => void }

let queue: Entry[] = []
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

export const subscribeDialogs = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const currentDialog = (): DialogRequest | undefined => queue[0]

/** Answers the dialog in front: true for its confirming button, false for cancel or closing it. */
export function answer(yes: boolean): void {
  const [front, ...rest] = queue
  if (!front) return
  queue = rest
  front.resolve(yes)
  changed()
}

function push(request: DialogRequest): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, resolve }]
    changed()
  })
}

/** Asks a yes/no question; resolves true only when the confirming button was chosen. */
export const ask = (o: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }) =>
  push({ kind: 'confirm', title: o.title, ...(o.message ? { message: o.message } : {}), confirmLabel: o.confirmLabel ?? 'OK', cancelLabel: o.cancelLabel ?? 'Cancel', danger: o.danger ?? false })

/** Tells something; resolves when it is dismissed. */
export const tell = async (o: { title: string; message?: string; text?: string }): Promise<void> => {
  await push({ kind: 'notice', title: o.title, ...(o.message ? { message: o.message } : {}), ...(o.text ? { text: o.text } : {}), confirmLabel: 'OK', cancelLabel: '', danger: false })
}

/** For tests: drops anything still queued. */
export function resetDialogs(): void {
  queue = []
  changed()
}
