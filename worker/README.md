# Wahapedia relay

The app is offline-first and has no backend. Wahapedia sends no CORS headers, so the browser cannot
fetch its files directly. This tiny Cloudflare Worker (free tier) fetches one page or export file
from `wahapedia.ru` and hands it to the app with those headers, so the Data screen can refresh the
mission deck and the stratagems. It stores nothing.

Sync between devices does **not** use this Worker any more: it goes through a private gist on the
owner's GitHub (`src/sync/gist.ts`).

## Deploy (done 2026-11-27; repeat only to change it)

1. `npx wrangler login` (approve in the browser).
2. In this directory: `npx wrangler deploy`. The account needs a workers.dev subdomain; wrangler
   asks for one, or register it under Workers in the Cloudflare dashboard.
3. Set the passphrase as a secret: `npx wrangler secret put SYNC_PASSPHRASE` (30+ random characters).
4. In the app, Settings → Sync → "Your own endpoint": the Worker URL and the same passphrase, on
   each device.

## Behaviour

- `GET /proxy?url=<https://wahapedia.ru/…>` with `Authorization: Bearer <passphrase>` returns that
  page or file with CORS headers. Other hosts are refused (403), a missing or wrong passphrase gets
  401. Nothing runs in the background; the app calls it only when you tap a refresh on the Data
  screen.
