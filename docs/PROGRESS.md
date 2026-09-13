# Progress journal

Running handoff log. The spec is [spec.md](spec.md); this file records what is actually built,
what was learned that the spec could not have predicted, and what comes next.

**Update the bottom three sections at the end of every working session.**

---

## Phase status

| Phase | Scope | State |
|---|---|---|
| 0 | Source verification | done — see spec Appendix A |
| — | Repo, PWA scaffold, Pages deploy | done |
| 1 | Data layer + datasheet browser | in progress |
| 2 | List Builder + validation | not started |
| 3 | Play Mode core | not started |
| 4 | Missions (CA 2026-27) | not started |
| 5 | Reminders | not started |
| 6 | Polish + second-faction test | not started |

---

## Done

### Repo and hosting

- Public repo `palviktortamas/wh40k-helper`, deployed to
  https://palviktortamas.github.io/wh40k-helper/ by `.github/workflows/deploy.yml` on push to
  `main`. Pages source is set to "GitHub Actions" (not a branch).
- `scripts/check-no-game-data.mjs` runs in CI and fails the build if anything shaped like a
  BattleScribe catalogue, Wahapedia CSV or MFM dump appears in the tracked tree or in `dist/`.
  It matches *format markers* (`battleScribeVersion`, `datasheets_wargear`, …) and oversized
  files, so the guard itself stays free of GW content. `docs/spec.md` and the script are
  allowlisted because they name the schemas.

### App scaffold

- TypeScript + React 19 + Vite 8 + `vite-plugin-pwa` 1.3, TypeScript 7, React Router 7.
- Hash routing (`HashRouter`) — static host, no rewrite rules, survives PWA launch.
- `AppShell` with a four-tab bottom bar; screens are honest placeholders naming their phase.
- Theme tokens in `src/index.css`: dark default, light and system variants. Settings screen is
  real (theme switcher + the About/attribution screen the spec requires).
- Dexie at `src/data/db.ts`, version 1, `settings` store, with `getSetting`/`setSetting`.
- Service worker registered with `registerType: 'prompt'` → "new version available" toast via
  `src/app/useServiceWorkerUpdate.ts`. Never reloads mid-game.
- Icons are generated from geometry by `scripts/generate-icons.mjs` (hand-rolled PNG encoder, no
  binary blob that cannot be regenerated). Placeholder art — fine to replace.

---

## Learned the hard way

Things that cost time and are not obvious from the spec:

- **`.gitignore` patterns are not anchored by default.** The rule `data/` also matched
  `src/data/`, so `db.ts` silently never got committed and CI failed on an unresolvable import.
  Use `/data/` for repo-root-only ignores. Check `git status` after adding files under a path
  that resembles an ignore rule.
- **The owner's machine had Node 18.16 at `I:\Program Files\node js`,** machine-wide and not
  user-writable. The build toolchain needs Node ≥ 20 (`diagnostics_channel.tracingChannel` for
  workbox's glob chain, global `crypto` for terser). Resolved by installing **fnm** (user scope,
  no admin) + Node 24, hooked into the PowerShell profile and `~/.bashrc` (a `~/.bash_profile`
  shim had to be created — login shells skip `.bashrc` without it).
  - The stale Node 18 is still first on the **machine** PATH and needs an elevated command to
    remove; every shell the owner actually uses is hooked, so this is cosmetic.
  - **The Claude Code Bash tool shell is non-interactive and reads neither profile** → prefix
    with `source ~/.bashrc` or you silently get Node 18.
- **Do not blanket-`overrides` a transitive dep to work around a Node version.** Pinning
  `lru-cache` fixed workbox and broke Babel. Fix the Node version instead.
- **TypeScript 7 removed `baseUrl`** — path aliases now resolve relative to the tsconfig.
- **Vite 8's native config loader** needs `import pkg from './package.json' with { type: 'json' }`.
- GitHub Actions can fail with *"job was not started because it repeatedly failed to be
  acquired"*. That is runner-allocation flake, not the build. Re-run it.

---

## Next

Phase 1 — Data. Deliverable per spec §8: browse every Ork unit with correct stats, weapons,
abilities and points, plus a report of records that could not be matched across sources.

1. Inspect the live BSData schema and the MFM YAML **into the scratchpad, never the repo**, and
   confirm Appendix A still holds.
2. Internal model types (spec §4.3) — faction, datasheet, model, weapon profile, ability, and the
   raw BSData constraint graph kept faithfully for the Phase 2 evaluator.
3. BSData JSON parser + MFM YAML parser, running in a Web Worker (the catalogue is ~2 MB).
4. Dexie stores for raw payloads, parsed catalogues, and source versions.
5. Cross-source linking by normalised name + faction, with an alias table; unmatched records
   surfaced rather than dropped.
6. Data screen: install/update per catalogue, last-updated dates, "Update all".
7. Read-only datasheet browser behind the Data tab.

Deferred to Phase 1b (needs the Cloudflare Worker proxy or manual file import, since Wahapedia
sends no CORS headers): the Wahapedia CSV enrichment and the mission deck.

### Open questions for the owner

Spec §10 lists these; still unanswered:

- Which two factions come next (only needed to pick a Phase 6 test catalogue)?
- Transports/embarking in Play Mode: v1 or slip to Phase 6?
