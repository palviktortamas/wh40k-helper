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
| 2 | List Builder + validation | built; **review found false-legal bugs, unfixed** |
| 3 | Play Mode core | blocked on the Phase 2 review fixes |
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

### Phase 2 - list builder

- `src/roster/types.ts` - Roster and Selection. A roster is a tree of selection instances that
  mirrors the catalogue entry tree, so validation can always walk back to the governing entry.
- `src/roster/resolve.ts` - flattens BSData's link graph into a buildable tree. An entry rarely
  holds its own children: option groups and weapons arrive through `entryLink`s, and a link may
  add its own constraints, modifiers and costs on top of the target. Memoised per catalogue.
- `src/roster/evaluate.ts` - **the generic constraint evaluator**. Applies modifiers first (a
  modifier can change a cost *and* a constraint's limit), then tests constraints.
- `src/roster/defaults.ts` - `instantiate()` takes the choices the data marks mandatory, so adding
  a unit does not open the editor on errors the user did not cause. 73 of 74 datasheets
  instantiate clean; the one that does not is a genuine data quirk and shows as an error.
- `src/roster/coreChecks.ts` - layer 2: points limit, exactly one Warlord, detachment chosen,
  unspent-points warning. Each message cites its rule.
- `src/roster/store.ts` - Dexie v3 `rosters` store, CRUD, duplicate, and the single `validate()`
  every screen calls. Catalogue graphs are cached; re-resolving 2 MB per keystroke would blow the
  100 ms budget.
- `src/roster/export.ts` - plain-text export, and it states when unresolved discrepancies affect
  the list.
- Screens: `Rosters` (list, create, duplicate, delete, legality badge), `RosterEditor` (points
  limit, detachment, warlord, reorder, issue list, unit picker, text export), `UnitEditor` (the
  per-model loadout editor).
- Tests: `src/roster/evaluate.test.ts` runs in CI on an invented catalogue and covers group
  min/max, army-wide caps, size-dependent costs, conditional limits and Requisition Thresholds.
  `evaluate.live.test.ts` is fixture-gated.

### Constraint evaluator - the semantics that are easy to get wrong

- **Option groups are not selections.** They get no node in the roster tree, yet they carry the
  constraints behind "9-18 models" and "at most 3 special weapons". They must be evaluated
  against the selection that *owns* them, counting the owner's children whose entry belongs to
  that group (nested groups included). Missing this makes every unit look legal.
- **A constraint with no `childId` counts instances of the entry that owns it.** "max 6 @force" on
  a unit means six of *that* unit, not six of anything. Defaulting `childId` to the owning entry
  id is what makes army-wide caps behave.
- **Requisition Thresholds are `localConditionGroups`, not the plain `before` condition.** The
  shape is: count the selections in a scope that individually satisfy the inner conditions, then
  compare that count against the group's own value - "at least 3 of this entry come before this
  one" means this is the 4th copy. A `conditionGroup` holding *only* local groups looks like an
  empty group, so an implementation that ignores them returns true and charges the surcharge on
  the very first unit. Verified against the official points: 20 models = 180, 10 models = 90,
  four 10-model units = 370.
- `before` needs a total document order across the whole roster, not sibling ordinals.
- Modifiers must all be applied before any constraint is read, because a modifier's `field` can be
  a constraint id.

### The spec's own acceptance example no longer matches the data

Spec section 9 asks for a 20-model unit built as "17 + 2 special + 1 leader model". In catalogue
revision 3 that unit's first option group is capped at 18 and the leader models sit in a separate
group of 1-2, so 17 + 2 = 19 breaks the cap. The legal 20-model build is 16 + 2 special + 2 leader
models. The evaluator is right and the spec example is stale - it was written from the previous
edition's datasheet. **Raised with the owner; spec not edited.**

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

## Review findings - Phase 2 (2026-09-13, not yet fixed)

An independent review of the evaluator found real correctness bugs. **These produce false "Legal"
badges, which is the worst failure mode this app has** - a wrong error is annoying, a wrong pass
loses a game. Fix these before building on the evaluator.

Ranked, with what was confirmed by execution:

1. **Constraints at a non-`self` scope only search the scope node and its direct children.**
   `queryNodes` in `evaluate.ts` uses `[target, ...target.children]` when
   `includeChildSelections` is false, but BattleScribe searches the scope's whole subtree - the
   flag controls how nested counts roll up, not whether descendants are visible at all.
   CONFIRMED: a weapon carrying `max 1 @unit` sits two levels below the unit (unit > model >
   weapon), so it is never counted and the limit never fires. This is the single cause of the
   spec's flagship case passing when it should not: a 12-model unit with two special-weapon
   models validates as legal either way you express it. **Fix this first.**

2. **`build()` re-resolves children by entry id, discarding link-carried data.**
   `evaluate.ts` calls `graph.resolve(selection.entryId)`, which resolves the *bare shared entry*;
   any constraints, modifiers or cost overrides carried by the `entryLink` that pulled the entry
   into this particular parent are lost. CONFIRMED by diffing in-place resolution against
   re-resolution across the catalogue: **236 of 19,754 child resolutions differ**, e.g. a
   transport's weapon options lose their `max N @parent` entirely, so unlimited copies validate.
   The fix needs care: `Selection` records `groupId` but not the link id, and the same shared
   entry can be linked twice under one parent (see 5), so walking the parent's *resolved* children
   needs a disambiguator.

3. **`set hidden` modifiers are ignored.** Treated as presentation-only, but the data uses them as
   its main "you may only take X if Y" gate - 448 of them, covering option-requires-sibling,
   unit-type restrictions, per-detachment enhancement groups and Legends/Crucible toggles. The UI
   filters only the base `hidden` flag, so all of these are offered and accepted. Compounding
   this: `roster.detachmentId` is not a selection in the tree and the evaluator never reads it, so
   every detachment-gated condition is structurally unevaluable even once `hidden` is implemented.
   Making the detachment a real selection in the roster tree probably fixes both.

4. **Force-entry and category-entry constraints are never evaluated.** Nothing reads
   `categoryEntry.constraints`, `forceEntry.constraints` or `categoryLink.constraints`. That drops
   the Enhancements cap per force, the Detachment Points budget, category caps, and a minimum
   Character requirement. The detachment's own DP cost is also never added, so
   `detachmentPoints` reads 0 and the budget cannot be checked regardless.

5. **The same shared entry reached through two sibling groups collapses into one selection.**
   `UnitEditor` matches `existing` by `entryId` alone and `countInGroup` ignores `groupId`, so a
   model with two arm groups sharing a weapon list satisfies both groups with one pick (false
   legal), or errors on both when given two (false error). One stepper drives both groups.

6. **Nested counts are absolute in the evaluator but per-copy in the export.** `instantiate` gives
   a weapon `count: 1` under a model of `count: 9`; `export.ts` multiplies child by parent, the
   evaluator sums raw counts. Points are unaffected today because wargear is free, but any
   unit-scope weapon count is wrong. Settle this *with* finding 1, or restoring those constraints
   still will not catch the flagship case.

7. `add error` / `add warning` modifiers are swallowed - `add` only handles categories, so the
   error text lands in `categoryIds` and nothing is reported. Nine in the data, one of which is
   the sole encoding of a per-N-models weapon limit.

8. **Warlord is not required to be a Character.** `coreChecks.ts` only checks the id resolves, and
   the UI offers the toggle on every unit - yet the error message already claims the rule.

9. Battle-size dependent limits never apply: the data encodes battle size as a *selection*
   ("Incursion", "Strike Force"), which this app's roster never contains because `pointsLimit` is
   a plain number. Same root cause as 3 - some roster-level configuration has to exist as
   selections.

10. Smaller, latent: `ancestor` scope resolves to the immediate parent only (352 uses, all
    category checks two levels up); a `forces` query returns 1 regardless of `childId`;
    `testLocalGroup` hard-codes the candidate filter to the holding entry instead of
    `local.childId` (harmless for all 29 current uses, not generic); army-wide errors are emitted
    once per instance, so seven copies produce seven identical messages.

11. Cost-typed constraints inherit the `childId` default meant for `selections`, so an
    `Enhancements max 1 @self` sums only children whose entry is the character itself and can
    never fire. Low impact today - a group cap happens to catch the same case.

12. The text export prints the *base* unit cost, not the evaluated one: a 20-model unit shows a
    header of 180 and a unit line of 90. It also labels evaluator gaps as "unresolved data
    discrepancies", which spec 4.1 reserves for source disagreements.

13. HYPOTHESIS (needs a browser, not reproduced): the cached catalogue graph in `store.ts` is
    keyed by catalogue id, which is stable across revisions, so after a data update the same
    session keeps validating against the old in-memory graph.

**Checked and found sound:** Requisition Thresholds and size-dependent costs (1x10=90, 1x20=180,
4x10=370, 5x10=470, 4x20=730 all match the official points); `roster`/`force` duplicate caps;
group min/max including group modifiers; the selection-tree edits in `store.ts` and `UnitEditor`
(no stale-closure or wrong-parent bug, ids unique, `duplicateRoster` re-ids and clears the warlord
reference, autosave writes are ordered so there is no lost-write race).

**A note on method.** The review initially attributed the flagship false pass to finding 2. It is
actually finding 1 - the constraints in that specific case live on the entry, not the link, and
are present. Both bugs are real and both were confirmed, but they are independent. Verify a
root-cause attribution by execution before acting on it.

---

## Next

**Phase 3 - Play Mode core.** Runs a game from a saved roster.

1. Game model and Dexie store; start a game from a roster (legal, or overridden with a warning).
2. Battle round and phase tracker, CP and VP counters for both players.
3. Army view: per-unit models alive, wounds on the current model, damaged-profile indicator,
   status chips. Removing models must ask which model type died so weapon counts stay right -
   the roster tree already distinguishes them, which is what makes this possible.
4. Datasheet view during play with loadout-aware weapon counts.
5. Undo for the last N actions; game log; end-of-game summary; game history.

### Still open from Phase 2

These are real gaps, not polish:

- **Leader attachment UI.** The `associations` graph is parsed and stored but nothing consumes it
  yet; a leader cannot be attached to a bodyguard unit. Needed properly by Phase 3's army view.
- **Enhancements.** The cost type and the entries resolve, but there is no UI to add one to a
  character, and no check of the per-detachment limit.
- **Epic Hero uniqueness and Support attachment legality** are not in `coreChecks.ts`; they may
  already be enforced by catalogue constraints, which has not been verified.
- **Transport / embarking** assignment (spec section 10 lists this as an open question).
- Per-item overrides on the Data Health screen, still unwired.
- Roster re-validation and diff after a data update.

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
