import { useEffect, useRef, useSyncExternalStore } from 'react'
import { answer, currentDialog, subscribeDialogs } from './dialogs'
import './DialogHost.css'

/**
 * Draws the dialog at the front of the queue (dialogs.ts) as a native
 * `<dialog>`: the browser keeps focus inside it, Escape closes it, and screen
 * readers announce it — the same as `confirm()`, in the app's own look.
 */
export function DialogHost() {
  const request = useSyncExternalStore(subscribeDialogs, currentDialog)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !request) return
    // jsdom and very old browsers lack showModal; the open attribute still shows it.
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal()
    } else dialog.setAttribute('open', '')
  }, [request])

  if (!request) return null
  const confirm = request.kind === 'confirm'
  return (
    <dialog
      ref={ref}
      className="app-dialog"
      aria-labelledby="app-dialog-title"
      // Escape, or the browser closing it: the same as Cancel.
      onCancel={(e) => {
        e.preventDefault()
        answer(false)
      }}
      onClick={(e) => {
        // A tap on the backdrop (the dialog element itself, outside its box) dismisses it.
        if (e.target === e.currentTarget) answer(false)
      }}
    >
      <div className="app-dialog__box">
        <h2 id="app-dialog-title">{request.title}</h2>
        {request.message && <p className="app-dialog__message">{request.message}</p>}
        {request.text && (
          <textarea
            className="app-dialog__text"
            readOnly
            value={request.text}
            rows={8}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Text to copy"
          />
        )}
        <div className="app-dialog__actions">
          {confirm && (
            <button className="button button--quiet" onClick={() => answer(false)}>
              {request.cancelLabel}
            </button>
          )}
          <button
            className={`button${request.danger ? ' button--danger-solid' : ''}`}
            onClick={() => answer(true)}
            autoFocus={!request.danger}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
