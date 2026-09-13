# wh40k-helper

A private, offline-first PWA for playing **Warhammer 40,000 (11th Edition)**: an army **List Builder**
with full legality validation, and a **Play Mode** for running a game (missions, VP/CP, wound
tracking, per-ability reminders).

Personal project. Unofficial and unaffiliated with Games Workshop. Not for distribution.

**Live app:** https://palviktortamas.github.io/wh40k-helper/

## Running it

Requires **Node 22.12+** (Vite 8's floor). The repo pins Node 24 in `.nvmrc`; with
[fnm](https://github.com/Schniz/fnm) or nvm installed, `cd` into the project and it switches for you.

```sh
npm install
npm run dev        # http://localhost:5173
npm run dev:host   # also reachable from your phone on the same Wi-Fi
npm run build      # production bundle into dist/
npm run typecheck
npm run check:data # asserts no game data is in the repo or the bundle
```

Pushing to `main` redeploys to GitHub Pages in about a minute. An installed PWA shows a
"new version available — reload" prompt on next open rather than reloading mid-game.

## Status

Bootstrapping. See [docs/spec.md](docs/spec.md) for the full specification and the phase plan.

| Phase | Scope | State |
|---|---|---|
| 0 | Source verification | done (spec Appendix A) |
| — | PWA scaffold + Pages deploy | done |
| 1 | Data layer + datasheet browser | done |
| 2 | List Builder + validation | built; review fixes pending |
| 3 | Play Mode core | blocked on Phase 2 fixes |
| 4 | Missions (CA 2026-27) | not started |
| 5 | Reminders | not started |
| 6 | Polish / second faction | not started |

## Important: no game data in this repo

Army/rules data is **never committed here**. The app downloads it on-device on first run from:

- [BSData/wh40k-11e](https://github.com/BSData/wh40k-11e) — constraints and legality (BattleScribe JSON)
- [BSData/wh40k-11e-mfm](https://github.com/BSData/wh40k-11e-mfm) — official Munitorum Field Manual points (YAML)
- [Wahapedia data export](https://wahapedia.ru/wh40k11ed/the-rules/data-export/) — rules text and the mission deck (needs a user-owned CORS proxy or manual file import)

`.gitignore` blocks the usual datafile names, and `npm run check:data` (also a CI step) fails the
build if anything with the shape of a catalogue, CSV export or MFM dump appears in the repo or in
`dist/`. A fresh clone must contain no unit names, ability text or points values.

## Attribution

Data by the **BSData** community and **Wahapedia** ("powered by Wahapedia"); points from the
official [Munitorum Field Manual](https://mfm.warhammer-community.com/en). Warhammer 40,000 and
all associated names are © Games Workshop. This app is a private, unofficial tool.
