/**
 * The owner's server (worker/): accounts, saving, and the Wahapedia relay.
 * The session is kept on the device, so the app keeps working offline once a
 * person has logged in on it.
 */

import { getSetting, setSetting } from '@/data/db'

/** The deployed server; a dev build can point at `wrangler dev` with VITE_SERVER_URL. */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'https://wh40k-helper-server.wh40k-relay-5058a9.workers.dev'

export const SESSION_KEY = 'auth.session'
/** The last account used on this device, so another account starts from a clean slate. */
export const LAST_USER_KEY = 'auth.lastUser'

export type Session = { token: string; username: string; isAdmin: boolean }

/** Thrown when the server cannot be reached at all — offline, most likely. */
export class OfflineError extends Error {
  constructor() {
    super('No connection to the server.')
  }
}

/** Thrown when the server answered with a refusal; `status` 401 means the session is over. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const getSession = (): Promise<Session | null> => getSetting<Session | null>(SESSION_KEY, null)

async function request(path: string, init: { method?: string; json?: unknown; token?: string } = {}): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.json === undefined ? {} : { body: JSON.stringify(init.json) }),
    })
  } catch {
    throw new OfflineError()
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new ServerError(response.status, body.error ?? `The server answered ${response.status}.`)
  }
  return response
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; token?: string } = {}): Promise<T> {
  return (await request(path, init)).json() as Promise<T>
}

/** Whether nobody has an account yet, so the first one needs no invitation. */
export const isFirstAccount = async (): Promise<boolean> =>
  (await api<{ firstAccount: boolean }>('/auth/status')).firstAccount

/**
 * Keeps the session. The caller announces it (SESSION_CHANGED) once the device
 * is ready for that account — see `adoptAccount` — so a save never sends one
 * account's things to another.
 */
async function start(session: Session): Promise<Session> {
  await setSetting(SESSION_KEY, session)
  return session
}

export const logIn = async (username: string, password: string): Promise<Session> =>
  start(await api<Session>('/auth/login', { json: { username, password } }))

export const signUp = async (username: string, password: string, invite: string): Promise<Session> =>
  start(await api<Session>('/auth/signup', { json: { username, password, invite } }))

/** Ends the session here and on the server (the server part is best effort). */
export async function endSession(): Promise<void> {
  const session = await getSession()
  if (session) await api('/auth/logout', { method: 'POST', token: session.token }).catch(() => undefined)
  await setSetting(SESSION_KEY, null)
  window.dispatchEvent(new Event(SESSION_CHANGED))
}

export async function createInvite(): Promise<{ code: string; expiresAt: number }> {
  const session = await getSession()
  if (!session) throw new ServerError(401, 'Please log in.')
  return api('/invites', { method: 'POST', token: session.token })
}

/** Fetches a Wahapedia page or export file through the server, which adds the CORS headers. */
export async function fetchThroughServer(url: string): Promise<string> {
  const session = await getSession()
  if (!session) throw new ServerError(401, 'Please log in.')
  try {
    return await (await request(`/proxy?url=${encodeURIComponent(url)}`, { token: session.token })).text()
  } catch (e) {
    if (e instanceof OfflineError) throw new Error('No connection — try again when online.')
    throw e
  }
}

/** Fired on `window` when someone logs in or out on this device. */
export const SESSION_CHANGED = 'wh40k:session-changed'
