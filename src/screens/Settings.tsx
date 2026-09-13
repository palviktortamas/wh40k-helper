import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { Theme } from '@/app/useTheme'
import { getSetting } from '@/data/db'
import {
  SYNC_LAST_KEY,
  getSyncConfig,
  saveSyncConfig,
  syncAll,
  type SyncSummary,
} from '@/sync/client'
import './Settings.css'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]

const WORKER_README = 'https://github.com/palviktortamas/wh40k-helper/tree/main/worker'

export function Settings() {
  const [theme, setTheme] = useOutletContext<[Theme, (next: Theme) => void]>()

  return (
    <section className="settings">
      <h2>Settings</h2>

      <fieldset className="settings__group">
        <legend>Theme</legend>
        <div className="settings__choices">
          {THEMES.map((option) => (
            <label key={option.value} className="settings__choice">
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setTheme(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <SyncSettings />

      <fieldset className="settings__group">
        <legend>Reminders</legend>
        <p className="settings__hint">
          During a game the app lists what to remember in each phase — once-per-battle abilities,
          Command-phase rules, charge and fight tricks. Choose which rules remind you and when.
        </p>
        <Link className="button button--quiet tap" to="/settings/reminders">
          Set up reminders
        </Link>
      </fieldset>

      <h3>About</h3>
      <p>
        Version {__APP_VERSION__} ({__BUILD_COMMIT__})
      </p>
      <p>
        An unofficial, private helper for Warhammer 40,000 11th Edition. It is not published, has
        no accounts and no analytics — everything stays on this device, unless you point it at
        your own sync endpoint above.
      </p>
      <p>
        Game data is provided by the <a href="https://github.com/BSData/wh40k-11e">BSData</a>{' '}
        community and <a href="https://wahapedia.ru/wh40k11ed/">Wahapedia</a> ("powered by
        Wahapedia"); points come from the official{' '}
        <a href="https://mfm.warhammer-community.com/en">Munitorum Field Manual</a>.
      </p>
      <p className="settings__fineprint">
        Warhammer 40,000 and all associated names, marks and images are © Games Workshop Limited.
        This app is unofficial and unaffiliated.
      </p>
    </section>
  )
}

/**
 * Sync with the owner's own endpoint (spec §4.4). Manual only: the app talks
 * to it when the button is tapped and at no other time.
 */
function SyncSettings() {
  const [url, setUrl] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [last, setLast] = useState<SyncSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void getSyncConfig().then((c) => {
      setUrl(c.url)
      setPassphrase(c.passphrase)
    })
    void getSetting<SyncSummary | null>(SYNC_LAST_KEY, null).then(setLast)
  }, [])

  const run = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await saveSyncConfig({ url, passphrase })
      const summary = await syncAll({ url, passphrase })
      setLast(summary)
      setMessage(
        `Synced: ${summary.pushed} sent, ${summary.pulled} received${
          summary.removed ? `, ${summary.removed} removed` : ''
        }.`,
      )
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="settings__group">
      <legend>Sync between your devices</legend>
      <p className="settings__hint">
        Build lists at the PC, play from the phone. Rosters and games are exchanged with a tiny
        endpoint you host yourself; nothing runs in the background and no game data is sent.{' '}
        <a href={WORKER_README} target="_blank" rel="noreferrer">
          How to set one up
        </a>
        . Without an endpoint, use "Share" on a roster and "Import" on the other device.
      </p>
      <label className="settings__field">
        Endpoint URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://wh40k-helper-sync.you.workers.dev"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
      <label className="settings__field">
        Passphrase (the same on every device)
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="settings__actions">
        <button className="button" disabled={busy || !url || !passphrase} onClick={() => void run()}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          className="button button--quiet"
          disabled={busy}
          onClick={() => void saveSyncConfig({ url, passphrase }).then(() => setMessage('Saved.'))}
        >
          Save
        </button>
      </div>
      {message && (
        <p className="settings__hint" role="status">
          {message}
        </p>
      )}
      {last && !message && (
        <p className="settings__hint">
          Last sync {new Date(last.at).toLocaleString()}: {last.pushed} sent, {last.pulled} received.
        </p>
      )}
    </fieldset>
  )
}
