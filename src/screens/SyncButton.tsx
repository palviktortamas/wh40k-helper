import { useEffect, useState } from 'react'
import { getSetting } from '@/data/db'
import { GIST_LAST_KEY, syncWithGist, type GistSyncSummary } from '@/sync/gist'

/** Fired on `window` after a sync wrote to this device, so open screens reload. */
export const SYNCED = 'wh40k:synced'

const describe = (s: GistSyncSummary) =>
  s.received + s.sent + s.removed === 0
    ? 'Already the same everywhere.'
    : `${s.received} received, ${s.sent} sent${s.removed ? `, ${s.removed} removed` : ''}.`

/**
 * "Sync": one tap reads the gist, merges, and writes back (sync/gist.ts). The
 * result, or why it failed, is said beside the button.
 */
export function SyncButton({
  disabled = false,
  beforeSync,
  compact = false,
}: {
  disabled?: boolean
  /** Runs first — the Settings screen saves a freshly pasted token. */
  beforeSync?: () => Promise<void>
  /** A short status line for the Rosters screen. */
  compact?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<GistSyncSummary | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void getSetting<GistSyncSummary | null>(GIST_LAST_KEY, null).then(setLast)
  }, [])

  const run = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await beforeSync?.()
      const summary = await syncWithGist()
      setLast(summary)
      setMessage(`Synced: ${describe(summary)}`)
      if (summary.received + summary.removed > 0) window.dispatchEvent(new Event(SYNCED))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`sync${compact ? ' sync--compact' : ''}`}>
      <button className="button" disabled={busy || disabled} onClick={() => void run()}>
        {busy ? 'Syncing…' : 'Sync'}
      </button>
      <span className="muted sync__status" role="status">
        {message ?? (last ? `Last sync ${new Date(last.at).toLocaleString()}` : compact ? '' : 'Not synced yet.')}
      </span>
    </span>
  )
}
