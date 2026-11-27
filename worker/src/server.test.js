// The server against a real SQLite database (Node's built-in), shaped like Cloudflare's D1.
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import server from './index.js'

/** Just enough of D1's API: prepare/bind/first/all/run, and batch in one transaction. */
function fakeD1() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...next) => statement(sql, next),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  })
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      db.exec('BEGIN')
      try {
        for (const s of list) db.prepare(s.sql).run(...s.args)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

let env
const ORIGIN = 'https://palviktortamas.github.io'
async function call(method, path, { token, json, ip = '1.1.1.1' } = {}) {
  const response = await server.fetch(
    new Request(`https://server.test${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        'cf-connecting-ip': ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(json ? { 'content-type': 'application/json' } : {}),
      },
      ...(json ? { body: JSON.stringify(json) } : {}),
    }),
    env,
  )
  return { status: response.status, body: await response.json(), headers: response.headers }
}

beforeEach(() => {
  env = { DB: fakeD1() }
})

describe('accounts', () => {
  it('lets the first account in without a code, and makes it the admin', async () => {
    expect((await call('GET', '/auth/status')).body).toEqual({ firstAccount: true })
    const made = await call('POST', '/auth/signup', { json: { username: 'owner', password: 'long enough pw' } })
    expect(made.status).toBe(200)
    expect(made.body.isAdmin).toBe(true)
    expect((await call('GET', '/auth/status')).body).toEqual({ firstAccount: false })
    const me = await call('GET', '/auth/me', { token: made.body.token })
    expect(me.body).toEqual({ username: 'owner', isAdmin: true })
  })

  // Bots: after the owner, nobody gets in without a code the owner made.
  it('needs an unused invitation code for everyone after the first', async () => {
    const owner = (await call('POST', '/auth/signup', { json: { username: 'owner', password: 'long enough pw' } })).body
    const without = await call('POST', '/auth/signup', { json: { username: 'bot', password: 'long enough pw' } })
    expect(without.status).toBe(403)
    const invite = (await call('POST', '/invites', { token: owner.token })).body
    expect(invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const friend = await call('POST', '/auth/signup', {
      json: { username: 'friend', password: 'another long pw', invite: invite.code.toLowerCase().replace(/-/g, ' ') },
    })
    expect(friend.status).toBe(200)
    expect(friend.body.isAdmin).toBe(false)
    const again = await call('POST', '/auth/signup', { json: { username: 'friend2', password: 'another long pw', invite: invite.code } })
    expect(again.status).toBe(403)
    // Only an admin invites.
    expect((await call('POST', '/invites', { token: friend.body.token })).status).toBe(403)
  })

  it('logs in with the right password only, and slows down guessing', async () => {
    await call('POST', '/auth/signup', { json: { username: 'owner', password: 'long enough pw' } })
    expect((await call('POST', '/auth/login', { json: { username: 'OWNER', password: 'long enough pw' } })).status).toBe(200)
    for (let i = 0; i < 10; i++) {
      expect((await call('POST', '/auth/login', { json: { username: 'owner', password: 'wrong' } })).status).toBe(401)
    }
    // Locked for this name, even with the right password, until the window passes.
    expect((await call('POST', '/auth/login', { json: { username: 'owner', password: 'long enough pw' } })).status).toBe(429)
  })

  it('refuses short passwords and odd names, and ends a session on logout', async () => {
    expect((await call('POST', '/auth/signup', { json: { username: 'owner', password: 'short' } })).status).toBe(400)
    expect((await call('POST', '/auth/signup', { json: { username: 'a b', password: 'long enough pw' } })).status).toBe(400)
    const owner = (await call('POST', '/auth/signup', { json: { username: 'owner', password: 'long enough pw' } })).body
    expect((await call('POST', '/auth/logout', { token: owner.token })).status).toBe(200)
    expect((await call('GET', '/auth/me', { token: owner.token })).status).toBe(401)
  })

  it('answers only the app’s own origins', async () => {
    const r = await call('GET', '/auth/status')
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  })
})

describe('records', () => {
  const signupWith = async (username, invite) =>
    (await call('POST', '/auth/signup', { json: { username, password: 'long enough pw', ...(invite ? { invite } : {}) } })).body

  it('keeps the newer copy and hands each device what changed since it last asked', async () => {
    const { token } = await signupWith('owner')
    const first = await call('POST', '/sync', {
      token,
      json: { cursor: 0, items: [{ collection: 'rosters', id: 'r1', updatedAt: 5, data: { id: 'r1', name: 'A', updatedAt: 5 } }] },
    })
    expect(first.body.items.map((i) => i.id)).toEqual(['r1'])
    const cursor = first.body.cursor

    // An older copy from a slower device is ignored; a newer one wins.
    await call('POST', '/sync', { token, json: { cursor, items: [{ collection: 'rosters', id: 'r1', updatedAt: 3, data: { name: 'old' } }] } })
    const same = await call('POST', '/sync', { token, json: { cursor, items: [] } })
    expect(same.body.items).toEqual([])
    const newer = await call('POST', '/sync', {
      token,
      json: { cursor, items: [{ collection: 'rosters', id: 'r1', updatedAt: 9, data: { id: 'r1', name: 'B', updatedAt: 9 } }] },
    })
    expect(newer.body.items).toEqual([{ collection: 'rosters', id: 'r1', updatedAt: 9, data: { id: 'r1', name: 'B', updatedAt: 9 } }])

    // A deletion travels like any change.
    const gone = await call('POST', '/sync', {
      token,
      json: { cursor: newer.body.cursor, items: [{ collection: 'rosters', id: 'r1', updatedAt: 12, deleted: true }] },
    })
    expect(gone.body.items).toEqual([{ collection: 'rosters', id: 'r1', updatedAt: 12, deleted: true }])
  })

  it('keeps each user’s records apart', async () => {
    const owner = await signupWith('owner')
    const { code } = (await call('POST', '/invites', { token: owner.token })).body
    const friend = await signupWith('friend', code)
    await call('POST', '/sync', { token: owner.token, json: { items: [{ collection: 'collection', id: 'x', updatedAt: 1, data: { a: 1 } }] } })
    const seen = await call('POST', '/sync', { token: friend.token, json: { cursor: 0, items: [] } })
    expect(seen.body.items).toEqual([])
  })

  it('needs a login for records and for the relay, and refuses unknown kinds', async () => {
    expect((await call('POST', '/sync', { json: { items: [] } })).status).toBe(401)
    expect((await call('GET', '/proxy?url=https://wahapedia.ru/x')).status).toBe(401)
    const { token } = await signupWith('owner')
    const r = await call('POST', '/sync', { token, json: { items: [{ collection: 'secrets', id: 'x', updatedAt: 1, data: 1 }] } })
    expect(r.body.items).toEqual([])
    expect((await call('GET', '/proxy?url=https://example.com/', { token })).status).toBe(403)
  })

  it('pages a long history', async () => {
    const { token } = await signupWith('owner')
    for (let batch = 0; batch < 3; batch++) {
      const items = Array.from({ length: 250 }, (_, i) => ({ collection: 'settings', id: `k${batch}-${i}`, updatedAt: 1, data: { v: i } }))
      await call('POST', '/sync', { token, json: { items } })
    }
    const page1 = await call('POST', '/sync', { token, json: { cursor: 0, items: [] } })
    expect(page1.body.items).toHaveLength(500)
    expect(page1.body.more).toBe(true)
    const page2 = await call('POST', '/sync', { token, json: { cursor: page1.body.cursor, items: [] } })
    expect(page2.body.items).toHaveLength(250)
    expect(page2.body.more).toBe(false)
  })
})
