/**
 * The owner's server (spec §4.4), a Cloudflare Worker with one D1 database.
 *
 * - Accounts: the first account made is the owner's and an admin; after that,
 *   signing up needs a one-time invitation code an admin made. Passwords are
 *   PBKDF2-hashed; failed attempts are counted per name and per address.
 * - Records: every list, game, collection row and setting a user keeps, newest
 *   copy only, each user's apart from everyone else's. A device sends what it
 *   changed and receives what changed elsewhere since it last asked.
 * - Relay: wahapedia.ru pages and export files, for signed-in users only, with
 *   the CORS headers that site lacks.
 */

import { hashPassword, inviteCode, normaliseCode, randomToken, sameText, sha256 } from './crypto.js'

export const COLLECTIONS = new Set(['rosters', 'games', 'collection', 'reminderOverrides', 'overrides', 'missions', 'settings'])
const PROXY_HOSTS = new Set(['wahapedia.ru', 'www.wahapedia.ru'])
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/
const MIN_PASSWORD = 10
const MAX_ITEMS = 500
const MAX_RECORD = 2_000_000
const PAGE = 500
const SESSION_DAYS = 365
const INVITE_DAYS = 14
const WINDOW = 15 * 60_000
const LIMITS = { name: 10, address: 40 }

const DEFAULT_ORIGINS = ['https://palviktortamas.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']

function cors(request, env) {
  const allowed = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS
  const origin = request.headers.get('origin') ?? ''
  return {
    ...(allowed.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
  }
}

const reply = (request, env, body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(request, env) },
  })

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function body(request) {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'The request was not readable.')
  }
}

/** Counts a failure against a key; throws once the key has failed too often lately. */
async function checkAttempts(env, key, limit, now) {
  const row = await env.DB.prepare('SELECT count, window_start FROM attempts WHERE key = ?').bind(key).first()
  if (row && now - row.window_start < WINDOW && row.count >= limit)
    throw new HttpError(429, 'Too many tries. Wait a quarter of an hour and try again.')
}

async function recordFailure(env, key, now) {
  await env.DB.prepare(
    `INSERT INTO attempts (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ? - attempts.window_start < ? THEN attempts.count + 1 ELSE 1 END,
       window_start = CASE WHEN ? - attempts.window_start < ? THEN attempts.window_start ELSE ? END`,
  )
    .bind(key, now, now, WINDOW, now, WINDOW, now)
    .run()
}

async function startSession(env, userId, now) {
  const token = randomToken()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now)
    .run()
  return token
}

async function currentUser(request, env, now) {
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) throw new HttpError(401, 'Please log in.')
  const hash = await sha256(token)
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.is_admin, s.last_used FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first()
  if (!row || now - row.last_used > SESSION_DAYS * 86_400_000) throw new HttpError(401, 'Please log in again.')
  // Touch at most once an hour, so a busy device does not write on every request.
  if (now - row.last_used > 3_600_000)
    await env.DB.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').bind(now, hash).run()
  return { id: row.id, username: row.username, isAdmin: row.is_admin === 1, tokenHash: hash }
}

async function signup(request, env, now) {
  const { username, password, invite } = await body(request)
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  await checkAttempts(env, `address:${address}`, LIMITS.address, now)
  if (typeof username !== 'string' || !USERNAME.test(username))
    throw new HttpError(400, 'A user name is 3–32 letters, digits, dots, dashes or underscores.')
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 200)
    throw new HttpError(400, `A password needs at least ${MIN_PASSWORD} characters.`)

  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()
  const first = (users?.n ?? 0) === 0
  let inviteHash
  if (!first) {
    inviteHash = await sha256(normaliseCode(invite))
    const row = await env.DB.prepare('SELECT used_by, expires_at FROM invites WHERE code_hash = ?').bind(inviteHash).first()
    if (!row || row.used_by || row.expires_at < now) {
      await recordFailure(env, `address:${address}`, now)
      throw new HttpError(403, 'That invitation code is not valid (or was used already).')
    }
  }
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()
  if (taken) throw new HttpError(409, 'That user name is taken.')

  const id = randomToken(12)
  const { hash, salt } = await hashPassword(password)
  const statements = [
    env.DB.prepare('INSERT INTO users (id, username, pass_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      id,
      username,
      hash,
      salt,
      first ? 1 : 0,
      now,
    ),
  ]
  // Claim the code in the same batch, and only if it is still unused.
  if (inviteHash)
    statements.push(env.DB.prepare('UPDATE invites SET used_by = ? WHERE code_hash = ? AND used_by IS NULL').bind(id, inviteHash))
  await env.DB.batch(statements)
  return { token: await startSession(env, id, now), username, isAdmin: first }
}

async function login(request, env, now) {
  const { username, password } = await body(request)
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const nameKey = `name:${String(username ?? '').toLowerCase()}`
  await checkAttempts(env, nameKey, LIMITS.name, now)
  await checkAttempts(env, `address:${address}`, LIMITS.address, now)
  const user = await env.DB.prepare('SELECT id, username, pass_hash, salt, is_admin FROM users WHERE username = ?')
    .bind(String(username ?? ''))
    .first()
  const ok = user && typeof password === 'string' && sameText((await hashPassword(password, user.salt)).hash, user.pass_hash)
  if (!ok) {
    await recordFailure(env, nameKey, now)
    await recordFailure(env, `address:${address}`, now)
    throw new HttpError(401, 'Wrong user name or password.')
  }
  return { token: await startSession(env, user.id, now), username: user.username, isAdmin: user.is_admin === 1 }
}

async function createInvite(env, user, now) {
  if (!user.isAdmin) throw new HttpError(403, 'Only an admin can invite.')
  const code = inviteCode()
  const expiresAt = now + INVITE_DAYS * 86_400_000
  await env.DB.prepare('INSERT INTO invites (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(normaliseCode(code)), user.id, now, expiresAt)
    .run()
  return { code, expiresAt }
}

/**
 * Takes what a device changed (kept only where newer than the server's copy)
 * and returns what changed since the device's cursor, a page at a time.
 */
async function sync(request, env, user) {
  const { cursor = 0, items = [] } = await body(request)
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new HttpError(400, `Send at most ${MAX_ITEMS} records at a time.`)
  const statements = []
  for (const item of items) {
    const { collection, id, updatedAt, deleted } = item ?? {}
    if (!COLLECTIONS.has(collection) || typeof id !== 'string' || id.length === 0 || id.length > 200) continue
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) continue
    const data = deleted ? null : JSON.stringify(item.data ?? null)
    if (data && data.length > MAX_RECORD) throw new HttpError(413, `One ${collection} record is too large to save.`)
    statements.push(
      env.DB.prepare(
        `INSERT INTO records (user_id, collection, id, updated_at, deleted, data, seq)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE user_id = ?))
         ON CONFLICT(user_id, collection, id) DO UPDATE SET
           updated_at = excluded.updated_at, deleted = excluded.deleted, data = excluded.data, seq = excluded.seq
         WHERE excluded.updated_at > records.updated_at`,
      ).bind(user.id, collection, id, updatedAt, deleted ? 1 : 0, data, user.id),
    )
  }
  if (statements.length > 0) await env.DB.batch(statements)

  const since = Number.isFinite(cursor) ? cursor : 0
  const { results } = await env.DB.prepare(
    'SELECT collection, id, updated_at, deleted, data, seq FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?',
  )
    .bind(user.id, since, PAGE + 1)
    .all()
  const page = results.slice(0, PAGE)
  return {
    items: page.map((r) => ({
      collection: r.collection,
      id: r.id,
      updatedAt: r.updated_at,
      ...(r.deleted ? { deleted: true } : { data: JSON.parse(r.data) }),
    })),
    cursor: page.length > 0 ? page[page.length - 1].seq : since,
    more: results.length > PAGE,
  }
}

async function proxy(request, env, url) {
  let target
  try {
    target = new URL(url.searchParams.get('url') ?? '')
  } catch {
    throw new HttpError(400, 'Bad address.')
  }
  if (target.protocol !== 'https:' || !PROXY_HOSTS.has(target.hostname)) throw new HttpError(403, 'Only wahapedia.ru.')
  const upstream = await fetch(target.toString(), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; wh40k-helper; private, owner-hosted relay)' },
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...cors(request, env),
    },
  })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) })
    const url = new URL(request.url)
    const now = Date.now()
    const route = `${request.method} ${url.pathname}`
    try {
      if (route === 'GET /auth/status') {
        const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()
        return reply(request, env, { firstAccount: (users?.n ?? 0) === 0 })
      }
      if (route === 'POST /auth/signup') return reply(request, env, await signup(request, env, now))
      if (route === 'POST /auth/login') return reply(request, env, await login(request, env, now))

      const user = await currentUser(request, env, now)
      if (route === 'GET /auth/me') return reply(request, env, { username: user.username, isAdmin: user.isAdmin })
      if (route === 'POST /auth/logout') {
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run()
        return reply(request, env, { ok: true })
      }
      if (route === 'POST /invites') return reply(request, env, await createInvite(env, user, now))
      if (route === 'POST /sync') return reply(request, env, await sync(request, env, user))
      if (route === 'GET /proxy') return await proxy(request, env, url)
      throw new HttpError(404, 'Not found.')
    } catch (error) {
      if (error instanceof HttpError) return reply(request, env, { error: error.message }, error.status)
      console.error(error)
      return reply(request, env, { error: 'The server had a problem.' }, 500)
    }
  },
}
