# The owner's server

A Cloudflare Worker (free tier) with one D1 database. It does three things for the app:

- **Accounts.** A person logs in once per device. The first account ever made is the owner's and an
  admin. After that, signing up needs a one-time invitation code an admin makes in Settings → Account
  (valid for two weeks). Passwords are PBKDF2-hashed and only a hash of each session token is stored.
  Failed logins are counted per name (10) and per address (40) in a quarter-hour window.
- **Saving.** Every list, game, collection row and setting a person makes is a record. The app sends
  what changed a moment after the change and gets back what changed on their other devices. The newer
  copy wins, and a deletion wins over older copies. Each person's records are kept apart.
- **Wahapedia relay.** `GET /proxy?url=https://wahapedia.ru/…` for logged-in users, with the CORS
  headers that site lacks, so the Data screen can refresh the mission deck and stratagems.

Requests are answered only for the app's own origins (`ALLOWED_ORIGINS`, by default GitHub Pages and
the local dev server).

## Deployed

`https://wh40k-helper-server.wh40k-relay-5058a9.workers.dev`, database `wh40k`. The app has this URL
built in (`src/sync/server.ts`); a dev build can point elsewhere with `VITE_SERVER_URL`.

## Change it

```sh
npx wrangler login
npx wrangler d1 execute wh40k --remote --file=schema.sql   # only when the schema changes
npx wrangler deploy
```

## Work on it locally

```sh
npx wrangler d1 execute wh40k --local --file=schema.sql
npx wrangler dev --port 8787 --local
VITE_SERVER_URL=http://localhost:8787 npm run dev          # from the repo root
```

The tests (`src/server.test.js`) run the server against Node's built-in SQLite with `npm test`.
