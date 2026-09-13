# Sync endpoint

The app is offline-first and has no backend. To move rosters and games between a PC and a
phone without pasting JSON, the owner can host this tiny Cloudflare Worker (free tier). It stores
only the owner's rosters and games, keyed by id, and merges by `updatedAt`.

## Deploy (once, ~5 minutes)

1. Create a free Cloudflare account and install the CLI: `npm i -g wrangler` (or use `npx`).
2. In this directory: `npx wrangler login`.
3. Create the storage namespace: `npx wrangler kv namespace create SYNC` and paste the printed
   `id` into `wrangler.toml`.
4. Choose a long random passphrase (30+ characters) and store it as the secret:
   `npx wrangler secret put SYNC_PASSPHRASE`.
5. `npx wrangler deploy`. Note the `https://wh40k-helper-sync.<you>.workers.dev` URL it prints.
6. In the app, Settings → Sync: enter that URL and the same passphrase on **each** device, then
   tap **Sync now**.

## Behaviour

- `POST /sync/rosters` and `POST /sync/games` with `Authorization: Bearer <passphrase>` and a
  body `{ items: [{ id, updatedAt, data } | { id, updatedAt, deleted: true }] }`.
- The Worker keeps the newer copy of each id and replies with the whole merged collection. The app
  then applies anything newer than its own copy and deletes what the other device deleted.
- Nothing runs in the background; the app only talks to the endpoint when you tap Sync.

No game data ever reaches the Worker — a roster references catalogue entries by id, and each
device downloads the data itself.
