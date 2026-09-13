/**
 * The owner's sync endpoint (spec §4.4): a Cloudflare Worker with one KV
 * namespace. It stores the owner's rosters and games — nothing else — and
 * merges by `updatedAt`, so two devices can each upload and download without
 * either overwriting the other's newer copy.
 *
 * Deploy: see README.md next to this file. Secrets: SYNC_PASSPHRASE.
 */

const COLLECTIONS = new Set(['rosters', 'games'])

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(), ...extra },
  })

const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
})

/** Constant-time-ish comparison so the passphrase cannot be guessed byte by byte. */
const sameSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() })

    const url = new URL(request.url)
    const match = /^\/sync\/([a-z]+)$/.exec(url.pathname)
    if (!match || request.method !== 'POST') return json({ error: 'not found' }, 404)
    const collection = match[1]
    if (!COLLECTIONS.has(collection)) return json({ error: 'unknown collection' }, 404)

    const auth = request.headers.get('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!env.SYNC_PASSPHRASE || !sameSecret(token, env.SYNC_PASSPHRASE))
      return json({ error: 'unauthorized' }, 401)

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'bad json' }, 400)
    }
    const incoming = Array.isArray(body?.items) ? body.items : []

    // Merge: newer updatedAt wins; a deletion is a record with deleted: true.
    for (const item of incoming) {
      if (!item || typeof item.id !== 'string' || typeof item.updatedAt !== 'number') continue
      if (!/^[\w-]{1,80}$/.test(item.id)) continue
      const key = `${collection}:${item.id}`
      const current = await env.SYNC.get(key, 'json')
      if (current && current.updatedAt >= item.updatedAt) continue
      const stored = item.deleted
        ? { id: item.id, updatedAt: item.updatedAt, deleted: true }
        : { id: item.id, updatedAt: item.updatedAt, data: item.data }
      await env.SYNC.put(key, JSON.stringify(stored))
    }

    // Reply with the whole merged collection.
    const items = []
    let cursor
    do {
      const page = await env.SYNC.list({ prefix: `${collection}:`, cursor })
      for (const { name } of page.keys) {
        const value = await env.SYNC.get(name, 'json')
        if (value) items.push(value)
      }
      cursor = page.list_complete ? undefined : page.cursor
    } while (cursor)

    return json({ items })
  },
}
