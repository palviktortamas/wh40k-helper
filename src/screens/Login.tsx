import { useEffect, useState } from 'react'
import { adoptAccount } from '@/sync/engine'
import { isFirstAccount, logIn, OfflineError, SESSION_CHANGED, signUp } from '@/sync/server'
import './Login.css'

/**
 * The way in (owner's decision 2026-11-27: log in before anything). One log-in
 * per device; after that the app works offline as before and saves to the
 * person's account whenever it can. A new account needs an invitation code
 * from an admin — except the very first one, which becomes the admin.
 */
export function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [first, setFirst] = useState(false)
  const [offline, setOffline] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    isFirstAccount()
      .then((isFirst) => {
        setFirst(isFirst)
        if (isFirst) setMode('signup')
      })
      .catch((e) => setOffline(e instanceof OfflineError))
  }, [])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const session =
        mode === 'login' ? await logIn(username.trim(), password) : await signUp(username.trim(), password, invite)
      await adoptAccount(session.username)
      window.dispatchEvent(new Event(SESSION_CHANGED))
    } catch (e) {
      setError(e instanceof OfflineError ? 'No connection. Logging in needs the internet once on each device.' : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <h1>WH40k Play Helper</h1>
      {offline && (
        <p className="login__note" role="status">
          No connection. Logging in needs the internet once on each device; after that the app works offline.
        </p>
      )}
      <form
        className="login__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2>{mode === 'login' ? 'Log in' : first ? 'Create the first account' : 'Create an account'}</h2>
        {mode === 'signup' && first && (
          <p className="login__note">Nobody has an account yet. This one will be the admin, who can invite others.</p>
        )}
        <label>
          User name
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            required
          />
        </label>
        <label>
          Password{mode === 'signup' ? ' (at least 10 characters)' : ''}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 10 : undefined}
            required
          />
        </label>
        {mode === 'signup' && !first && (
          <label>
            Invitation code
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="XXXX-XXXX-XXXX"
              required
            />
          </label>
        )}
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
      {!first && (
        <button
          className="button button--quiet login__switch"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? 'Got an invitation code? Create an account' : 'Have an account? Log in'}
        </button>
      )}
    </main>
  )
}
