/**
 * The owner's relay for Wahapedia (spec §4.2): a Cloudflare Worker that
 * fetches one page or export file from wahapedia.ru and hands it to the app
 * with the CORS headers the site lacks, so the Data screen can refresh the
 * mission deck and the stratagems. That one host only, behind a passphrase.
 *
 * Sync between devices no longer runs through here — it uses a private gist
 * (src/sync/gist.ts) — so the Worker stores nothing.
 *
 * Deploy: see README.md next to this file. Secrets: SYNC_PASSPHRASE.
 */

const PROXY_HOSTS = new Set(['wahapedia.ru', 'www.wahapedia.ru'])

const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
})

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors() } })

async function proxy(url) {
  let target
  try {
    target = new URL(url.searchParams.get('url') ?? '')
  } catch {
    return json({ error: 'bad url' }, 400)
  }
  if (target.protocol !== 'https:' || !PROXY_HOSTS.has(target.hostname))
    return json({ error: 'host not allowed' }, 403)
  const upstream = await fetch(target.toString(), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; wh40k-helper; private, owner-hosted relay)' },
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...cors(),
    },
  })
}

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
    const auth = request.headers.get('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!env.SYNC_PASSPHRASE || !sameSecret(token, env.SYNC_PASSPHRASE))
      return json({ error: 'unauthorized' }, 401)

    if (url.pathname === '/proxy' && request.method === 'GET') return proxy(url)
    return json({ error: 'not found' }, 404)
  },
}
