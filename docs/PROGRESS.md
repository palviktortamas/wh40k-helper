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
| 1 | Data layer + datasheet browser | done (Wahapedia enrichment deferred to 1b) |
| 2 | List Builder + validation | next |
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
  It matches *format markers* in data files and oversized files anywhere, so the guard itself
  stays free of GW content. See "Guard design" below for why markers do not count against code.

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

### Phase 1 - data layer

- `src/data/sources.ts` - source URLs and precedence. No game content, only addresses.
- `src/data/bsdata/schema.ts` - BattleScribe v2.03 types, verified against the live files.
- `src/data/bsdata/parse.ts` - catalogue to internal model. Keeps the raw constraint and
  association graph untouched for the Phase 2 evaluator.
- `src/data/mfm/parse.ts` - the MFM YAML: pricing bands, detachments, enhancements, eligibility.
- `src/data/link/merge.ts` - name normalisation, merge, discrepancy and unmatched reporting.
- `src/data/install.ts` - catalogue discovery and the full install pipeline.
- `src/data/worker/` - the worker plus a typed client. The worker never touches IndexedDB; it
  returns plain data and the client persists it, so Dexie stays in one place.
- Dexie v2 adds `catalogues`, `health` and `overrides`. Each catalogue keeps its raw source text
  next to the parsed model so a future app version can re-parse offline.
- Screens: a real Data screen (install/update/remove, per-source versions), a datasheet browser
  with search and role filters, a datasheet detail view (stats, weapon tables, composition,
  abilities, pricing bands), and a Data Health screen.
- Tests: `npm test`. Synthetic-fixture unit tests always run. Two suites are gated so CI stays
  deterministic - set `WH40K_FIXTURES=<dir>` for the real-catalogue tests, and `WH40K_NETWORK=1`
  for the ones that hit GitHub. Both gated suites must stay lazy: `describe.skipIf` still
  evaluates the callback body at collection time, so reading a fixture at the top level throws
  before the skip applies.

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

### Source data - corrections to spec Appendix A

Appendix A was written against an earlier catalogue revision. Verified 2026-09-13 against
catalogue revision 3; **prefer these findings over Appendix A where they conflict**:

- **Leader and Support attachment are structured data, not prose.** Selection entries carry an
  `associations` array (`action: 'group'`, `childId: 'unit'`, `scope: 'force'`, `min`/`max`, and
  condition groups that gate eligibility). Units declare `max 1` against association ids
  `1556-9b56-fba6-4370` (Leader) and `7dcd-7f61-69a7-0294` (Support). Appendix A never mentions
  this. It also means leader eligibility does **not** need the Wahapedia `Datasheets_leader` table.
- **The MFM mirror exposes `leaderTo` and `supportTo` as structured fields.** Appendix A says
  eligibility "appears in the notes text, not as structured fields" - no longer true.
- **The `NDP Detachment` category no longer exists.** Do not key off it. Detachments are the
  entries carrying a non-zero `Detachment Points` cost (type id `82ae-1066-5107-6ae0`), which
  yields exactly 15 - the same set the MFM mirror lists. Appendix A's "BSData 17 vs MFM 15"
  discrepancy has been resolved upstream.
- **Extra scopes the appendix omits:** `ancestor` (352 uses), `primary-catalogue`, `model-or-unit`
  and `upgrade` all appear as `condition.scope`. The Phase 2 evaluator must handle them.
- **`modifier.field` can be a constraint id**, not just a named field or a cost type id - that is
  how a constraint limit is changed conditionally (e.g. a force-wide max that drops at a smaller
  points limit). Budget for this in the evaluator.
- **A datasheet is a shared selection entry with a `primary` category link**, and that link is its
  battlefield role. The entry whose role is `Configuration` is the roster's detachment picker, not
  a unit - exclude it.
- **BSData tags variants in brackets** ("... [Legends]", "... [Crucible]") where the mirror uses
  the bare name; normalisation has to strip them or a fifth of the catalogue fails to join.
- Every entry carries all eight cost types, mostly zero. Crusade and Blackstone costs are ignored.
- Match rates after all of the above: **every detachment joins**, and ~93% of datasheets. The
  remainder are genuinely one-sided (Crucible units absent from the MFM; Legends entries the
  mirror does not price) and are surfaced on the Data Health screen rather than dropped.

### Guard design

The no-game-data guard first flagged the parser and the docs for *naming* schema fields. Naming a
field is code, not data. Format markers now only count against files that could themselves be a
datafile (`.json`/`.yaml`/`.csv`); everything else is judged on size. Verified both ways: clean on
the repo, and it still catches a real catalogue file dropped into the tree.

---

## Next

**Phase 2 - List Builder.** The generic BattleScribe constraint evaluator is the centre of it;
everything else is UI on top.

1. **Constraint evaluator.** Implement the vocabulary in spec Appendix A.1 *plus* the corrections
   above. Start with the subset the data actually uses and log unsupported constructs rather than
   failing silently. `before` (ordinal position among siblings) is how Requisition Thresholds
   work; `modifier.field` pointing at a constraint id is how conditional limits work.
2. Roster model and Dexie store; create/duplicate/rename/delete; points limit presets.
3. Per-model loadout editor - the hard requirement in spec 5.2. Model slots with individual
   equipment, enforcing "1 in 10 may take ...".
4. Leader attachment from the `associations` graph; enhancements; warlord toggle.
5. Hard-coded 11e core checks as the second layer (spec 5.3), each error citing its rule.
6. Plain-text roster export; backup export/import.
7. Wire the per-item overrides on the Data Health screen - deferred from Phase 1 deliberately,
   since an override only means something once a roster total depends on it.

Acceptance target (spec 9): a legal 2000-pt list whose 20-model unit carries the exact loadout the
spec names, with a leader attached, one enhancement and a warlord - green badge; and each of the
four illegal variations producing a specific error that names its rule.

### Phase 1b - deferred, needs a proxy

Wahapedia sends no CORS headers, so its rules text and the mission deck need the small user-owned
Cloudflare Worker (spec 4.2) or the manual file-import flow. Not started. The app is fully usable
for list building without it.

### Not yet built from Phase 1's own scope

- "Update all" button (per-catalogue install/update works; the bulk action does not exist).
- Re-validating an existing roster after a data update and showing a diff - needs rosters first.
- The alias table for names normalisation cannot join. Not needed yet: every detachment joins and
  the unmatched datasheets are genuinely one-sided.

### Open questions for the owner

Spec §10 lists these; still unanswered:

- Which two factions come next (only needed to pick a Phase 6 test catalogue)?
- Transports/embarking in Play Mode: v1 or slip to Phase 6?
