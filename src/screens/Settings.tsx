import { useEffect, useState } from 'react'
import { ask } from '@/app/dialogs'
import { Link, useOutletContext } from 'react-router-dom'
import type { Theme } from '@/app/useTheme'
import { createInvite, getSession, type Session } from '@/sync/server'
import { logOut, saveNow } from '@/sync/engine'
import { backupFileName, exportBackup, lastBackupAt, restoreBackup } from '@/data/backup'
import { requestPersistentStorage, storageState, type StorageState } from '@/data/persist'
import './Settings.css'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]

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

      <BackupSettings />

      <AccountSettings />

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

/** Hands a file to the share sheet on a phone (Files, Drive, mail…), downloads it elsewhere. */
async function saveFile(name: string, text: string): Promise<void> {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const file = new File([text], name, { type: 'application/json' })
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Not saved.')
      // Unsupported payload; fall through to a download.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`

/**
 * Persistent storage and the full backup (spec §3). A browser may clear a
 * site's data when it goes unused; the backup file is the copy outside it.
 */
function BackupSettings() {
  const [storage, setStorage] = useState<StorageState | null>(null)
  const [last, setLast] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void storageState().then(setStorage)
    void lastBackupAt().then(setLast)
  }, [])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage(await work())
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const backup = await exportBackup()
      await saveFile(backupFileName(backup.at), backup.text)
      setLast(backup.at)
      return `Backup saved: ${backup.rosters} roster${backup.rosters === 1 ? '' : 's'}.`
    })

  const restore = (file: File) =>
    run(async () => {
      const counts = await restoreBackup(await file.text())
      return `Restored: ${counts.added} new, ${counts.updated} updated, ${counts.kept} already up to date (rosters and games). Install their factions under Data if they are missing.`
    })

  const ask = () =>
    run(async () => {
      const granted = await requestPersistentStorage()
      setStorage(await storageState())
      return granted
        ? 'This browser will keep the data.'
        : 'The browser declined. Installing the app to the home screen usually changes that — and keep a backup.'
    })

  return (
    <fieldset className="settings__group">
      <legend>Backup</legend>
      <p className="settings__hint">
        {storage?.persisted === true
          ? 'Storage is persistent: the browser will not clear it on its own.'
          : storage?.persisted === false
            ? 'Storage is not persistent: the browser may clear lists and downloaded data when the app goes unused for a while.'
            : 'This browser does not say whether it will keep the data.'}
        {storage?.usage !== undefined && ` ${megabytes(storage.usage)} in use.`}
      </p>
      <p className="settings__hint">
        A backup is one file with every roster, game, setting, your collection and edited mission cards. Faction data
        is not inside — it downloads again from Data.{' '}
        {last ? `Last backup ${new Date(last).toLocaleString()}.` : 'No backup made on this device yet.'}
      </p>
      <div className="settings__actions">
        <button className="button" disabled={busy} onClick={() => void save()}>
          Save backup
        </button>
        <label className={`button button--quiet${busy ? ' button--disabled' : ''}`}>
          Restore backup
          <input
            type="file"
            accept="application/json,.json"
            hidden
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void restore(file)
            }}
          />
        </label>
        {storage?.persisted === false && (
          <button className="button button--quiet" disabled={busy} onClick={() => void ask()}>
            Keep data on this device
          </button>
        )}
      </div>
      {message && (
        <p className="settings__hint" role="status">
          {message}
        </p>
      )}
    </fieldset>
  )
}

/**
 * The account this device is logged in to (spec §4.4): everything made here is
 * saved to it automatically. An admin can invite others with one-time codes.
 */
function AccountSettings() {
  const [session, setSession] = useState<Session | null>(null)
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void getSession().then(setSession)
  }, [])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await task()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!session) return null
  return (
    <fieldset className="settings__group">
      <legend>Account</legend>
      <p className="settings__hint">
        Logged in as <b>{session.username}</b>
        {session.isAdmin ? ' (admin)' : ''}. Your lists, games, collection and settings are saved to
        your account automatically and appear on every device you log in on. Offline, changes wait on
        this device and are saved when the connection returns.
      </p>
      <div className="settings__actions">
        <button className="button button--quiet" disabled={busy} onClick={() => void run(saveNow)}>
          Save now
        </button>
        <button
          className="button button--quiet"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const yes = await ask({
                title: 'Log out?',
                message: 'Everything is saved to your account first, then removed from this device.',
                confirmLabel: 'Log out',
              })
              if (yes) await logOut()
            })
          }
        >
          Log out
        </button>
      </div>
      {session.isAdmin && (
        <>
          <p className="settings__hint">
            Invite someone: each code works once, for two weeks. They choose their own user name and
            password, and keep their own lists.
          </p>
          <div className="settings__actions">
            <button className="button" disabled={busy} onClick={() => void run(async () => setInvite(await createInvite()))}>
              Make an invitation code
            </button>
          </div>
          {invite && (
            <p className="settings__invite" role="status">
              <code>{invite.code}</code>
              <span className="settings__hint">valid until {new Date(invite.expiresAt).toLocaleDateString()}</span>
            </p>
          )}
        </>
      )}
      {message && (
        <p className="settings__hint" role="alert">
          {message}
        </p>
      )}
    </fieldset>
  )
}
