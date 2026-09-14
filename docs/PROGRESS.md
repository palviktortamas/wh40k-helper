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
| 2 | List Builder + validation | done — review findings fixed 2026-09-13, verified on real data |
| 3 | Play Mode core | **built 2026-09-13** — needs a session on the owner's phone |
| 4 | Missions (CA 2026-27) | **built 2026-09-13** — import, browser, setup wizard, scoring, Tactical deck, card editor, card-state trackers; WHEN DRAWN unit picks and twist automation remain |
| 5 | Reminders | **built 2026-09-13 (late night)** — heuristics, per-rule overrides, in-game phase panel; needs a real game to tune the defaults |
| 6 | Polish + second-faction test | **built 2026-09-13 (late night)** — linked library catalogues, two more factions pass every suite, Update all + roster diff |
| 7 | Owner feedback round: UI redesign, rules fixes, stratagems | **built 2026-09-13 (night 2)** — role-grouped list builder with stats, caps enforced in the editor, detachment rules on units, stat strips at the table, 11e CP fix, Battle-shock step, stratagem import + panel |
| 8 | Several detachments per army (11e DP budget) + Necrons | **built 2026-09-14** — DP budget read from the data, checkbox picker, every consumer pluralised, Dexie v9, Necrons in the fixtures |
| 9 | Editor round: attachment kinds, unit names, picker, unit size | **built 2026-09-14** — Leader/Support/Retainers told apart, numbered and renamable units, annotated attach control with Detach, picker stays open with counts, Reinforced toggle, compulsory loadouts can no longer be emptied |

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
- `AppShell` with a four-tab bottom bar.
- Theme tokens in `src/index.css`: dark default, light and system variants. Settings screen is
  real (theme switcher + the About/attribution screen the spec requires).
- Dexie at `src/data/db.ts`, currently **version 5** (v1 settings, v2 catalogues/health/overrides,
  v3 rosters, v4 roster-shape migration, v5 games). Sync configuration and tombstones live in
  the `settings` store under `sync.*` keys.
- `worker/` holds the source of the owner's optional Cloudflare sync endpoint (spec §4.4). It is
  not part of the Vite build and holds no game data.
- Service worker registered with `registerType: 'prompt'` → "new version available" toast via
  `src/app/useServiceWorkerUpdate.ts`. Never reloads mid-game.
- Icons are generated from geometry by `scripts/generate-icons.mjs` (hand-rolled PNG encoder, no
  binary blob that cannot be regenerated). Placeholder art — fine to replace.

### Phase 1 - data layer

- `src/data/sources.ts` - source URLs and precedence. No game content, only addresses.
- `src/data/bsdata/schema.ts` - BattleScribe v2.03 types, verified against the live files.
- `src/data/bsdata/parse.ts` - catalogue to internal model. Keeps the raw constraint and
  association graph untouched for the evaluator.
- `src/data/mfm/parse.ts` - the MFM YAML: pricing bands, detachments, enhancements, eligibility.
- `src/data/link/merge.ts` - name normalisation, merge, discrepancy and unmatched reporting.
- `src/data/install.ts` - catalogue discovery and the full install pipeline.
- `src/data/worker/` - the worker plus a typed client. The worker never touches IndexedDB; it
  returns plain data and the client persists it, so Dexie stays in one place.
- Each catalogue keeps its raw source text next to the parsed model so a future app version can
  re-parse offline.
- Screens: Data (install/update/remove, per-source versions), datasheet browser with search and
  role filters, datasheet detail, Data Health.
- Tests: `npm test`. Synthetic-fixture unit tests always run. Two suites are gated so CI stays
  deterministic - set `WH40K_FIXTURES=<dir>` (a directory holding `gs.json` plus one faction flat
  or a subdirectory per faction; **use a Windows-style path such as `C:/Users/...`, Git Bash
  `/c/...` paths are not understood by Node**) for the real-catalogue tests, and `WH40K_NETWORK=1` for the ones that hit
  GitHub. Both gated suites must stay lazy: `describe.skipIf` still evaluates the callback body at
  collection time, so reading a fixture at the top level throws before the skip applies.

### Phase 2 - list builder

- `src/roster/types.ts` - Roster and Selection. A roster is a tree of selection instances that
  mirrors the catalogue entry tree. **`Selection.count` is per copy of the parent** (a model with
  count 9 whose weapon child has count 1 means nine weapons); the evaluator, export, editor and
  Play Mode all read it that way. `linkId` records which entry link an option came through;
  `attachedTo` + `associationId` record leader attachment.
- `src/roster/vocabulary.ts` - the handful of game-system category names the app must recognise
  (Configuration, Character, Warlord, Epic Hero) and the association-group id → label table.
  Game-system vocabulary, never faction vocabulary.
- `src/roster/resolve.ts` - flattens BSData's link graph into a buildable tree, memoised per
  catalogue. Exposes `rootEntryIds` (datasheets), `configurationEntryIds` (roster setup entries
  from both files), `forceEntries`, `catalogueId`, and `childOptions()` for walking a resolved
  entry's selectable children with the group they sit in.
- `src/roster/evaluate.ts` - **the generic constraint evaluator**, rewritten after the review
  (see "Constraint evaluator - semantics" below). `analyseRoster()` returns the evaluation plus
  the editor's questions: `isEntryAvailable`, `isGroupAvailable`, `leaderTargets`.
- `src/roster/defaults.ts` - `instantiate()` takes the choices the data marks mandatory;
  `bareSelection()` for a childless pick; `isSameOption()` matches a selection to an option row
  by link, then group, then entry.
- `src/roster/coreChecks.ts` - layer 2: points limit (skipped when the data's own force limit is
  live), exactly one Warlord who must be a Character, detachment chosen, Epic Hero uniqueness,
  unattached-Leader warning, unspent-points warning, evaluator gaps. Each message cites its rule.
- `src/roster/store.ts` - Dexie `rosters` store, CRUD, duplicate (re-points leader attachments),
  the single `validate()` every screen calls, and the roster-shape helpers: `normaliseRoster`,
  `withDetachment`, `withWarlord`, `withBattleSize`, `withToggle`, `detachmentOptions`,
  `removeUnit`. Catalogue graphs are cached by id **and revision**.
- `src/roster/export.ts` - plain-text export with evaluated unit costs, leaders nested under the
  unit they lead, enhancements, and a plain statement of any validation gaps.
- Screens: `Rosters`, `RosterEditor` (limit, detachment, an "Army configuration" panel with the
  data's own toggles and setup groups, leader "Attach to" select, Warlord button on Characters
  only, per-unit points), `UnitEditor` (availability-gated option groups, steppers, nested
  loadouts).
- Tests: `src/roster/evaluate.test.ts` (invented catalogue, CI) covers group min/max, army-wide
  caps, size-dependent costs, conditional limits, Requisition Thresholds, and the three review
  regressions. `evaluate.live.test.ts` (fixture-gated) adds: configuration normalisation, every
  datasheet instantiates without tripping an availability gate, the flagship deep-weapon cap,
  enhancements gated by detachment and capped, Warlord via the data's upgrade, leader
  eligibility, army-wide caps reported once.

### Phase 3 - Play Mode core

- `src/play/types.ts` - `Game` = frozen roster snapshot + live state. `GameUnit` holds
  `ModelGroup[]`, one per model type in the roster tree, each with total/alive, wounds per model,
  wounds on the current model, and per-model weapons. Undo depth 30, five battle rounds.
- `src/play/snapshot.ts` - roster + parsed catalogue + validation → units. Wounds come from the
  stat line whose name the model name starts with (longest match), else the first line. The
  damaged-profile threshold is parsed from an ability named "Damaged: 1-N …".
- `src/play/actions.ts` - one pure reducer, `apply(game, action)`. Every action records the
  previous state for undo and writes a log line. Phase/turn progression grants 1 CP at the start of
  each Command phase and records VP at the end of each round; going back a turn takes the CP back.
  Damage does not carry over between models. Turn-scoped statuses (Advanced, Fell back) clear when
  the turn ends.
- `src/play/store.ts` - Dexie v5 `games`; `newGame()` freezes the roster (recording whether it was
  legal when started).
- `src/play/useWakeLock.ts` - screen stays on while a game is open.
- Screens: `Play` (continue, start from a roster — illegal lists need a confirm, history with
  results), `Game` (tracker with big Prev/Next, two-player CP / primary VP / secondary VP,
  undo, log, army view with leaders nested under their unit, quick "−1 model" / "−1 W" when the
  choice is unambiguous and a per-model-type panel otherwise, status chips, destroy/revive,
  end-of-game summary with VP by round), `GameUnitSheet` (stats, weapons table with counts from
  the *surviving* models, abilities with once-per-battle checkboxes, attached leader merged in).
- Tests: `src/play/actions.test.ts`, `src/play/snapshot.test.ts` on invented data.

### Phase 4 - Missions (core)

- **No mission data in the repo.** The Chapter Approved deck is Wahapedia's published page,
  converted on the device by `src/missions/parseDeck.ts` (DOM-based; the page's card vocabulary
  is `cgCardCA7`, `ca7Name`, `caPmBlock`, `caPmWhen`, `caPmScore`, `caPmVP`, `caPmCumul`,
  `caPmVPPair` for FIXED/TACTICAL pairs, `caAct*` for objective actions, `caPmIntro` for
  WHEN DRAWN, `ca7Fixed` marks the fixed-eligible secondaries, `caFdRow` the disposition
  pairings; section boundaries are `<h2 id>`s and each deck sits in `.Columns2` wrappers — the
  interactive generator after the twist deck repeats every card and must not be read).
  Schema in `src/missions/types.ts`; `blockApplies()` reads a block header's round wording.
- Import paths (Data screen → Mission deck): **shipped with the build** (since 2026-09-13, late
  night, on the owner's say-so: `scripts/fetch-mission-deck.mjs` runs in the deploy workflow,
  saves Wahapedia's page to `public/missions-ca-2026-27.html` — git-ignored, so the text never
  enters the repo — and `ensureMissionDeck()` imports it at app start when the device has none;
  the Data screen has "Load / Reload the shipped deck"; a dev server has no deck unless the
  script is run locally), **through the owner's endpoint** — the Worker gained `GET /proxy?url=`
  restricted to `wahapedia.ru` — or **"Import saved page"** (save the page as HTML in a browser,
  pick the file). Dexie v6 `missions` store, one record. The bundled page is a same-origin fetch
  the service worker precaches, so it also works offline; a failed fetch in CI is a warning and
  the app falls back to the other two paths.
- Screens: `Missions` (cards by deck, deployment maps from Wahapedia's image URLs), `MissionSetup`
  (the battle sequence as a form: dispositions → derived primaries via the disposition card rows,
  deployment/twist draw or pick, D6 for central objectives, roll-off for attacker, Fixed or
  Tactical with two Fixed picks), `GameMission` inside a game (primary scoring assistant showing
  the blocks that apply this round as tappable "+N VP" lines with an undo, the opponent's primary
  for reference, the Tactical deck: Draw 2, per-line scoring, "Achieved — discard", "Discard (+1 CP
  once per own turn)", "Discard & redraw (1 CP, once per battle)", WHEN DRAWN shuffle-back; Fixed
  mode scores with FIXED values and never discards). The 15 VP per battle round secondary cap is
  enforced and resets on the new round.
- `Game.mission` (optional, absent on older games) holds the setup and the live deck state; all of
  it is undoable. The setup wizard prefills the player's Force Disposition from the roster.
- Tests: `parseDeck.test.ts` (jsdom; the real page is fixture-gated as `missions.html` in
  `WH40K_FIXTURES`), `blockApplies` cases, and reducer tests for the deck rules.
- Walked through in headless Chrome: file import → 25/18/6/6 cards → wizard → scoring → draw →
  achieve → discard for CP, no console errors.
- **Card editor** (spec §6.1, 2026-09-13 night): "Edit" on any primary, secondary or twist card in
  the Missions screen opens `MissionCardEditor` — name, legend, WHEN DRAWN, rules paragraphs,
  objective-action rows, every scoring block (applies-in header, when, lines with VP or
  Fixed/Tactical VP pair, cap, join, cumulative), notes; add/remove lines and blocks.
  `updateMissionCard` swaps the card by id and stamps `deck.editedAt`; the Missions and Data
  screens say so, and warn that a re-import replaces the edits (card ids are name slugs, so a
  running game keeps pointing at the edited card). A `merge()` helper treats `undefined` as
  "delete the field" because the schema is strict-optional.
- **Card-state trackers** (spec §6.2): `MissionState.cardCounters` / `cardNotes` keyed by card id,
  shown as a `− N +` counter and a note field under the primary and every active secondary
  (`CardTracker` in `GameMission.tsx`). The counter is an undo step with a log line; the note is
  not — and **undo now carries current notes forward** (card notes and unit notes), otherwise a
  note typed after a counter change was wiped by the next undo. Old games have no maps; readers
  default to `{}`.
- Also from the Phase 3 leftovers: **default casualty order** — `defaultCasualtyGroup()` picks the
  largest living model group (plain models first, the lone sergeant last), shown as a quick
  "−1 <model>" button on mixed units next to "Remove models…" — and a **Reserves "Arrive"**
  action that clears Reserves / Deep Strike with a log line.
- Walked through again in headless Chrome (driver #4 in the scratchpad): edit → save → reload →
  Data line; "−1 Boy" default; Deep Strike → Arrive; counter +2, note, undo keeps the note; both
  survive a reload; no console errors.

### Phase 5 - Reminders (spec §6.4)

- `src/reminders/types.ts` - the spec's trigger list (`start_of_battle` … `custom`), `Reminder`
  (stable id = the BSData profile/rule/entry id, owner unit/detachment/army, trigger, one-line
  text, `once: 'battle' | 'turn'`, enabled) and `ReminderOverride`.
- `src/reminders/heuristics.ts` - **keyword defaults**, generic game vocabulary only: an ordered
  regex table where the specific moment wins over the phase it happens in ("selected as the
  target" → `when_targeted` before "Shooting phase"; "arrives from Reserves"; "opponent's …
  phase"; "end of your turn"), `once per battle` / `once per turn` detection, HTML and `**bold**`
  stripped, text = first sentence cut to 140 chars. A rule with neither a moment nor a limit is
  `custom` and **starts disabled** — that is what keeps the panel glanceable (Leader, Support,
  invulnerable saves, Deadly Demise…). A once-per-battle rule with no phase becomes an "any time,
  once" reminder shown in the Command phase.
- `src/reminders/derive.ts` - `remindersForGame(game, catalogue, overrides)`: each living unit's
  datasheet abilities and taken enhancements (owner unit), the detachment's rules (owner
  detachment, matched by `game.detachmentName`), and the `faction`/`core` rules every datasheet
  links to **once** as army rules. `remindersForCatalogue` lists everything for the settings
  screen. `showsNow` maps phase × turn → triggers (your Command: command/start-of-battle in round
  1/once-per-*/custom; Movement: movement + arriving from Reserves; Fight: fight + end of turn;
  opponent's phases: `opponent_turn` always, `when_targeted` in their Shooting and Fight,
  `when_charged` in their Charge, `fight_phase` in their Fight). `doneKey` is per round+turn+owner,
  or `battle:` for once-per-battle; `isDone` also honours the datasheet's "used" checkbox.
- Overrides: Dexie **v7** `reminderOverrides` keyed by rule id (`src/reminders/store.ts`), plus
  the master switch in `settings` (`reminders.enabled`). Overrides survive data updates and apply
  to every copy of a datasheet.
- Data model additions: `Detachment.rules` (the detachment entry's own `rules` + rule infoLinks)
  and `ParsedCatalogue.enhancements` (every upgrade entry with an Enhancement cost, text from its
  Abilities profile, keyed by entry id). `GameUnit.enhancements` is filled at snapshot time from
  the roster's upgrade selections whose `entryId` is an enhancement.
- **Parser fix found on the way (PARSER_VERSION 2):** `collectProfiles` followed entry links into
  shared *groups* — the Crusade tree, Enhancements, Warlord — so every datasheet carried ~150
  abilities that were not its own (14 000 for the test faction; the datasheet screens showed them
  too). Datasheet abilities now come from the entry, its models and its infoLinks only; weapons
  still follow group links. `reparseStaleCatalogues()` runs once at app start and re-parses any
  installed record whose `parserVersion` is older **from the raw text it kept** — no download,
  works offline. Bump `PARSER_VERSION` whenever the parsed shape or content changes.
- Screens: `GameReminders` (panel between the tools and the Mission section: "Reminders — X
  phase", grouped by Army / detachment / unit, checkbox per item, once-per-battle chip turns into
  "used" and locks, "on the table" hint on arrival reminders for units not in Reserves,
  Silence/Unmute master switch); Settings → **Set up reminders** → `Reminders` screen (faction
  select when several are installed, search, groups as `<details>`, per rule: on/off, trigger
  select, text input saved on blur, "edited" chip and Reset to default).
- Reducer: `checkReminder` toggles `GameState.remindersDone[key]`; for a once-per-battle unit
  reminder it also syncs `usedOnce` so the datasheet checkbox agrees; undoable, logged.
- Tests: `heuristics.test.ts`, `derive.test.ts`, reducer case in `actions.test.ts`; fixture-gated
  `heuristics.live.test.ts` (prints the trigger histogram, asserts >60% of rules get a real
  trigger and once-per-battle is caught) and a live parser test for detachment rules /
  enhancement text.
- Walked through in headless Chrome (driver #5): settings list (90 groups for the test faction),
  search, enable a passive rule with a new trigger and text → survives reload; game panel per
  phase on both turns, tick, undo, silence; no console errors.

### Phase 6 - Polish and the second-faction test

The point of the phase (spec §8): install another catalogue and prove nothing is faction-specific.
Done with **two** others, chosen as tests only (the owner has not picked the next factions):
a self-contained one and one whose every datasheet lives in a shared library. Both exposed
generality gaps, all fixed:

- **Linked library catalogues.** Every BSData catalogue imports others through `catalogueLinks`:
  all import `Unaligned Forces` (`importRootEntries: true` — Legends fortifications), and some
  keep their content in a `Library - …` / `… Library` file — the faction file is then nothing but
  ~100 root `entryLinks`, with 0 shared entries. The install pipeline now follows the links
  (`fetchLibraries`: the link's *name* is the file name, recursive, a missing library is a
  warning), keeps the texts in `record.raw.libraries`, and the parser and the evaluator graph
  index `[gs, ...libraries, cat]` with the catalogue winning on collision. `PARSER_VERSION` is 3,
  so installed factions re-parse at start; they will lack libraries until re-installed (the raw
  text of a library was never downloaded) — the Data screen says "with N linked libraries" once
  it has them.
- **Datasheet discovery is by root entry link**, not by "shared entry with a primary category":
  `rootEntries()` = the catalogue's root links, plus the root links of `importRootEntries`
  libraries, plus its own shared roots as a fallback. Roots resolve *with* their root link
  (`resolve()` remembers `rootLinks`) so link-carried categories/costs apply — for the test
  factions the root links carry nothing, so numbers did not move. Imported datasheets and
  detachments carry `library: <name>`; the datasheet browser shows a "linked" badge, the Data
  card counts them apart, and the MFM match-rate test excludes them.
- **Roster setup entries come from the catalogue's own links/entries only** (the library's
  only when the catalogue has none). Otherwise Unaligned Forces' own Detachment picker sat next
  to the faction's and every roster showed two "Detachment: at least 1" errors.
- **A shared library holds several factions' detachments** (24 for the test file, 15 legal for
  the faction). The data hides the others with `instanceOf primary-catalogue` gates, so
  `availableDetachmentOptions(roster, graph, analysis)` asks the evaluator per option; the
  roster editor and the live tests use it. The one already chosen stays listed.
- **Evaluator fix: a group's owner is its first `ancestor`.** The library's Enhancements group is
  hidden with `ancestor notInstanceOf Character`. A group is not a selection, so its conditions
  are evaluated against the owning selection — and `ancestors(owner)` skipped the owner, hiding
  enhancements for every Character of that faction. `Context.groupOwner` is set while a group's
  own modifiers run and `countInstances` includes the owner then. Orks never tripped it because
  their gates are worded differently. Test: `src/roster/libraries.test.ts` (invented library +
  group).
- **Live tests are faction-agnostic now**: `test/fixtures.ts` loads `gs.json`, one catalogue,
  optional `.yaml`, and `lib-*.json` libraries; the flagship and enhancement cases skip or search
  where a faction lacks the structure; the heuristics threshold is 50% (the second faction's
  rules text is less phase-worded). All three fixture sets pass every suite (83 / 78 / 78 tests).
- **Update all** (Data screen, next to "Installed") and the **data-update diff**: updating an
  installed faction re-validates its rosters before and after (`rosterStates`: points and error
  count) and lists the ones that changed with links, or "N rosters unchanged".
- Walked through in headless Chrome: the library-only faction installs from the live index
  (1 + 102 datasheets, 2 linked libraries, 24 detachments of which 15 offered), datasheet with
  6 abilities, roster → detachment → unit → editor, 128 reminder groups; no console errors.

### Owner feedback round (2026-09-13, night 2) — UI redesign, rules fixes, stratagems

The owner loaded their faction and asked for: stats/abilities visible while building, units
grouped so they can be found, weapon caps enforced in the editor, an overall UI that scales to a
large army ("more colours"), base stats on the table cards, detachment rules shown on the units
they improve, the 11e rules read so nothing like the CP generation is wrong, and a stratagem
list in Play Mode. Everything below was walked through in headless Chrome on the real catalogue
(driver `walk.mjs` in the scratchpad; it uses a *persistent* Chrome profile so the installed
faction survives re-runs, and it imports the stratagem CSV through the file input).

- **Rules verified against the 11e Core Rules (Wahapedia) and two secondary sources.** Command
  phase = Start → **Gain Core CP: "Both players gain 1 CP"** → Battle-shock step → Command
  abilities → End. The app used to grant only the active player 1 CP; `advance()` now grants
  both (and `retreat()` takes it back from both), a new game starts with **1 CP each**. Also
  encoded: each Stratagem once per phase, one Stratagem per unit per phase, a Battle-shocked unit
  cannot be targeted by its controller's Stratagems (footnote on the panel). Spec §6.2 corrected.
  No 11e cap on CP gained from other sources was found; tournaments may add one.
- **Stratagems (spec §6.3).** BSData has none (verified: zero stratagem entries). They come from
  Wahapedia's `Stratagems.csv` — `src/stratagems/parseCsv.ts` (generic pipe-CSV: BOM, trailing
  pipe, header-keyed), `select.ts` (Core + chosen detachment by normalised name; phase/turn
  match; TARGET-keyword match per unit), `store.ts` (Dexie **v8** `stratagems`, one record for
  every faction; import by file or through the owner's endpoint proxy). **Data facts:** the 11e
  Core set is the ten rows typed exactly `Core Stratagem` (Command Re-roll, Counteroffensive,
  Crushing Impact, Epic Challenge, Explosives, Fire Overwatch, Heroic Intervention, Insane
  Bravery, Rapid Ingress, Smokescreen); rows typed `Core – <Category> Stratagem` are 10th-edition
  leftovers (Tank Shock, Grenade, Go to Ground…) and `Boarding Actions – …` / `Challenger – …`
  are other game modes — all dropped. The table also lists movement "abilities"; only rows whose
  type contains "Stratagem" are kept. Faction rows join by the `detachment` column, so
  `Factions.csv` is not needed. HTML text is converted once, at import, into the app's marked
  form (`**KEYWORD**` from `<span class="kwb">`, `__bold__` from `<b>`, bullets from `<li>`) by
  `src/stratagems/marked.ts`; `Marked.tsx` is the one renderer — no HTML is ever injected. The
  same renderer now shows BSData's `**bold**` ability text properly.
- **Play Mode:** `GameStratagems` panel (Now / All, CP chip, WHEN always visible, tap for
  TARGET/EFFECT/RESTRICTIONS, **Use** = `useStratagem` action: spends CP, marks
  `GameState.stratagemsUsed[round:turn:phase:id]`, undoable, tap again to take back);
  `BattleShockStep` panel in your Command phase (`belowHalfStrength()` in `play/types.ts`, plus
  units already shocked, with Ld; Failed/Passed toggle the status); unit cards carry a **stat
  strip** (`StatStrip.tsx`, first profile only on cards, live W for single models) and a role
  stripe; the unit sheet shows detachment rules that name the unit, enhancements with text, and
  "Stratagems for this unit".
- **Detachment rules on units** (`src/roster/detachmentRules.ts`): a rule's bold-caps tokens are
  read as keyword clauses — "friendly **X** units" first, "**X** units" as fallback, `/` as
  alternatives, multi-word tokens need every word, "excluding **Y**" negates, stat letters and
  weapon abilities are skipped — and matched against the datasheet's keywords + faction
  keywords. A rule naming no unit is army-wide (`undefined`). Shown with a detachment chip in the
  unit editor's Datasheet panel and on the in-game sheet. **Not done:** BSData's
  detachment-conditional *profile modifiers* (69 owners in the test faction append weapon
  keywords such as `[ASSAULT]` when a detachment is present) are still not evaluated; the rule
  text says what they do.
- **List builder redesign.** `RosterEditor`: sticky summary (badge, points meter, DP,
  detachment + Force Dispositions), detachment rule `<details>`, issues folded into one
  `<details>`, **By role / My order** toggle (setting `rosters.unitsView` in IndexedDB), units
  grouped by battlefield role with subtotal and colour (`src/roster/roles.ts` — game-system
  vocabulary: Character / Battleline / Dedicated Transport / Other / Fortification), attached
  leaders nested inside their unit in role view, cards with stat strip, roll-up, enhancement
  chips, Remove asks first. `UnitPicker`: grouped by role, role chips, points at every size from
  the pricing bands, stat strip per row, **i** expands abilities/weapons/keywords. `UnitEditor`:
  stat strip, two columns at ≥900 px (options | Datasheet panel: weapons carried via the shared
  `play/weapons.ts` + `modelGroups()`, abilities, detachment rules, enhancements).
- **Navigating a big list** (owner: "units still not grouped, barely navigable" — they were
  looking at the deployed app before the push; fixed anyway): three densities (**Cards /
  Compact / My order**, setting `rosters.unitsView`), role groups fold on tap of their heading,
  and the sticky summary carries a **jump bar** (one chip per group, anchors `#group-<role>`
  with `scroll-margin-top` clearing the summary). Group headings use fixed words for the known
  roles and the data's own name for the rest — never pluralised ("Infantry").
- **Every primary category is a group** (owner, 2026-09-14: "epic hero, monster and mounted
  groups should be also"). The test faction's roots use nine primaries — Epic Hero, Character,
  Battleline, Infantry, Mounted, Monster, Vehicle, Dedicated Transport, Fortification — and the
  game system also defines Beast, Swarm and Aircraft. `roles.ts` knows all twelve (order,
  heading, colour token `--role-<key>`); `groupByRole()` is the one grouping used by the roster,
  the picker and the datasheet browser, and an unknown primary still gets its own group under
  the data's own name. Roles are not keywords: a Character that is also Infantry sits under
  Characters because that is its primary category in the data.
- **Caps in the editor.** The evaluator now reports **headroom**: per selection, the smallest
  `max − actual` over its own `selections` caps, and — for caps scoped beyond the parent
  (`unit`, `force`, entry-id) — tightened onto every ancestor up to the scope (one more "Boy w/
  Rokkit launcha" is one more rokkit launcha in the unit: `max 1 @unit` lives on the *weapon*
  child, the model entry itself only has `max 2 @parent`). `groupHeadroom` per
  `owner:groupId`. The `+` is disabled at 0 and the group head reads "n / limit · full" (limit
  derived from the room, because the evaluator counts special-weapon models in "9-18 Boyz" while
  the editor lists them in another group). Second net: before any increment `tryChange` runs a
  trial validation and refuses if the count of "at most" errors inside the unit would rise.
- **Design.** Tokens added: `--surface-sunken`, `--accent-soft`, five `--role-*` colours (dark and
  light); shared `Units.css` (stat strip, role stripe/tag, group heads, keyword mark, rule chips,
  ability list, points meter). No web fonts — offline-first PWA, system-ui stays; hierarchy comes
  from weight, size and letter-spaced uppercase labels. Colour is never alone: every role colour
  sits next to its word, Inv/hurt cells carry the value, used stratagems say "Used ✓".
  Layout guards: `.shell__main{overflow-x:hidden}`, `minmax(0,1fr)` grids, wrapping counters —
  the first screenshots showed the editor and the score panel widening the phone page.
- Tests: `detachmentRules.test.ts`, `stratagems/parseCsv.test.ts` (invented export slice in the
  real shape; parser, marked text, detachment join, phase match), CP tests updated. 89 pass with
  the fixtures, 69 in CI.

### Constraint evaluator - semantics (the things that are easy to get wrong)

- **A scope query searches the scope's whole subtree.** `includeChildSelections` does not gate
  visibility. A weapon with `max 1 @unit` two levels below the unit must be found.
- **Counts are relative to the scope.** A node's absolute count is the product of the counts on
  its path; a query reports `absolute / scopeAbsolute`. This is what makes per-copy counts and
  unit-scope caps agree.
- **Children resolve through the parent's resolved options**, matched by `linkId`, then
  `groupId`, then entry id, so link-carried constraints/costs survive. Re-resolving the bare
  shared entry loses 236 divergences in the current catalogue.
- **Option groups are not selections.** They are evaluated against the owning selection; a child
  that recorded its `groupId` counts only in that group (two sibling groups can share an option
  list).
- **A `selections` constraint with no `childId` counts the owning entry; a cost-typed constraint
  with no `childId` sums everything.**
- **`set hidden` is a legality gate**, on entries and on groups. A hidden selection, or one taken
  from a hidden group, is an error. The editor asks `isEntryAvailable(parent, entry, group)` /
  `isGroupAvailable` before offering anything; the unit picker asks with no parent.
- **Requisition Thresholds are `localConditionGroups`**; `before` needs a total document order.
- **Force entries, force category links and category entries own constraints too.** They are
  evaluated as virtual nodes that see the whole roster. This is where the data's own points
  limit (`pts max 0 @parent` set to 1000/2000/3000 by battle size, or incremented by the
  "Points limit" override count), the DP budget, the Enhancements cap, the Character minimum and
  the Warlord min/max live. `pointsLimitChecked` tells layer 2 to stand down.
- **Roster configuration is part of the tree.** Battle Size (game system), Detachment
  (catalogue) and Force Disposition (game system) are `Configuration`-role shared entries; the
  roster holds one bare selection of each and the user's pick underneath. Leaf toggles ("Show
  Legends") are on by being present. `withBattleSize` mirrors `pointsLimit` into the data's
  battle-size option by the number in its name, using the data's own override entry (whose
  *count* is the limit) for other values.
- **The Warlord is the data's own `Warlord` upgrade** linked into every unit, hidden by the data
  unless the unit is a Character; the `Warlord` category carries min 1 / max 1 at roster scope.
  `withWarlord` adds/removes that selection.
- **Associations** (`action: 'group'`) on a leader describe eligible units; their conditions are
  tested against the *candidate* unit except those flagged `queryFromSelf`, which read the leader.
  A unit's `max 1 associations childId=<group id>` counts attached leaders by label via
  `ASSOCIATION_LABELS`. `traverseAssociationGroup` pools the leader with its bodyguard unit.
- `instanceOf @primary-catalogue childId=<catalogue id>` compares against `graph.catalogueId`;
  `ancestor` tests every ancestor; `forces` queries return 1 only for the app's own force entry
  (the first non-hidden one in the game system).
- `add error` / `add warning` modifiers become issues. Army-wide constraints report once.
- Modifiers must all be applied before any constraint is read, because a modifier's `field` can be
  a constraint id.

### The spec's acceptance example was corrected (v0.6)

Spec section 9 used to ask for a 20-model unit built as "17 + 2 special + 1 leader model". In
catalogue revision 3 the first option group is capped at 18 and the leader models sit in a
separate group of 1-2, so the legal 20-model build is 16 + 2 special + 2 leader models (verified
2026-09-13: 180 pts, a third special weapon errors, the 4th copy pays the Requisition surcharge,
the leader attaches, one detachment enhancement applies, over-limit errors from the data's own
force constraint). The owner agreed and §9 now states the current build.

---

## Learned the hard way

Things that cost time and are not obvious from the spec:

- **`.gitignore` patterns are not anchored by default.** The rule `data/` also matched
  `src/data/`, so `db.ts` silently never got committed and CI failed on an unresolvable import.
  Use `/data/` for repo-root-only ignores.
- **The owner's machine had Node 18.16 at `I:\Program Files\node js`,** machine-wide. Resolved by
  installing **fnm** (user scope) + Node 24, hooked into the PowerShell profile and `~/.bashrc`.
  - **The Claude Code Bash tool shell is non-interactive** → prefix with `source ~/.bashrc` or you
    silently get Node 18. Every Bash call also prints a red *"We can't find the necessary
    environment variables to replace the Node version"* banner from fnm; it is noise, not a
    failure — read the exit code and the real output.
  - **In this Bash tool, heredocs (`<<'EOF'`) and multi-line inline Python patches fail
    intermittently and silently** (the command reports success but writes nothing, or bash says
    "unexpected EOF"). Write files and patches with the Write/Edit tools, and give `git commit`
    its message with `-F <file>` written by the Write tool.
- **Do not blanket-`overrides` a transitive dep to work around a Node version.** Pinning
  `lru-cache` fixed workbox and broke Babel. Fix the Node version instead.
- **TypeScript 7 removed `baseUrl`** — path aliases now resolve relative to the tsconfig.
- **Vite 8's native config loader** needs `import pkg from './package.json' with { type: 'json' }`.
- GitHub Actions can fail with *"job was not started because it repeatedly failed to be
  acquired"*. That is runner-allocation flake, not the build. Re-run it.
- **Verify a root-cause attribution by execution before acting on it.** The Phase 2 review first
  blamed the flagship false pass on link re-resolution; it was the scope-search bug. Both were
  real, both were fixed, but a fix aimed at the wrong one would have "worked" by accident.

### Source data - corrections to spec Appendix A

Appendix A was written against an earlier catalogue revision. Verified 2026-09-13 against
catalogue revision 3; **prefer these findings over Appendix A where they conflict**:

- **Leader and Support attachment are structured data, not prose.** Selection entries carry an
  `associations` array (`action: 'group'`, `childId: 'unit'`, `scope: 'force'`, `min`/`max`,
  `label: 'Leader' | 'Supported by'`, and condition groups that gate eligibility). Units declare
  `max 1` against association ids `1556-9b56-fba6-4370` (Leader) and `7dcd-7f61-69a7-0294`
  (Support); **those ids are defined nowhere in either file** — the constraint's `childName` is
  the only join to the association `label`, hence `ASSOCIATION_LABELS`.
- **The MFM mirror exposes `leaderTo` and `supportTo` as structured fields.**
- **The `NDP Detachment` category no longer exists.** Detachments are the entries carrying a
  non-zero `Detachment Points` cost (type id `82ae-1066-5107-6ae0`); exactly 15, same as the MFM.
- **Roster setup is data.** `Configuration`-role shared entries: Battle Size (with a "Battle Size"
  group of point-limit options and an "Override points limit?" → "Points limit" numeric entry
  whose count is the limit), Force Disposition, the "Show …" visibility toggles (game system,
  `import: true`), and the catalogue's Detachment picker (group of 17 options, each with DP cost
  and Force Disposition categories). The force entry "Army Roster" carries the pts / DP /
  Enhancements limits, modified by battle size.
- **The Warlord is an upgrade entry** (`Warlord` category, min 1 / max 1 at roster on the
  category) linked into every unit and hidden unless the root entry is a Character.
- **Every unit links in the whole Crusade option tree** (hundreds of upgrades under "Crusade",
  "Battle Traits", "Relics" groups), hidden unless a Crusade force exists. The hidden-group gate is
  what keeps the unit editor usable; do not remove it for speed.
- **Extra scopes the appendix omits:** `ancestor` (352 uses), `primary-catalogue`,
  `model-or-unit` and `upgrade`. `set hidden` is the most common modifier (466).
- **`modifier.field` can be a constraint id**, a cost type id, `hidden`, `name`, `annotation`,
  `defaultAmount`, `error`, `warning`, `category`.
- **A datasheet is a shared selection entry with a `primary` category link**; 52 of the current
  73 roots are of type `model`, 21 `unit`. Play Mode treats a `model` root as its own single model
  group.
- **BSData tags variants in brackets** ("... [Legends]", "... [Crucible]"); normalisation strips
  them or a fifth of the catalogue fails to join.
- Match rates after all of the above: **every detachment joins**, and ~93% of datasheets. The
  remainder are genuinely one-sided and are surfaced on the Data Health screen.

### Guard design

The no-game-data guard first flagged the parser and the docs for *naming* schema fields. Naming a
field is code, not data. Format markers now only count against files that could themselves be a
datafile (`.json`/`.yaml`/`.csv`); everything else is judged on size.

---

## Review findings - Phase 2 (2026-09-13) — all fixed

The independent review found 13 issues that produced false "Legal" badges. All are fixed in
commit "Fix the evaluator's false-legal bugs from the Phase 2 review" and covered by tests;
the semantics section above is the durable record. Summary of what changed per finding:

1. subtree scope search · 2. resolve children via the parent's options + `linkId` · 3. `set hidden`
gate + configuration in the tree · 4. force/category constraints as virtual nodes, detachment DP
counted · 5. link/group-aware option matching · 6. per-copy counts, absolute through the tree ·
7. `add error/warning` · 8. Warlord = data upgrade, Character required · 9. battle size in the
tree · 10. `ancestor`, `forces`, local-group `childId`, army-wide dedupe · 11. cost-typed
constraints default to "any" · 12. export prints evaluated costs and says "validation gaps" ·
13. graph cache keyed by revision.

---

## Done 2026-09-14 - several detachments per army, and Necrons

### An army takes as many detachments as its Detachment Points budget allows

The 11th-edition modular detachment system was already fully described by the data; the app was
what assumed one. **The budget is never written in code.** The game system puts a `max` on the
`Detachment Points` cost type on the force entry and moves it with the battle size: **2 DP base,
3 at Strike Force (2000 pts) or at Incursion if a 3DP detachment is taken, 4 at Onslaught**. The
detachment group is `min 1 / max -1`. So the generic evaluator enforces the budget with no new
check — `coreChecks` now asks only for *at least one* detachment, and nothing anywhere knows the
numbers 2, 3 or 4.

What changed:

- `EvaluationResult.detachments` (plural) plus `detachmentPointsLimit`, read off the resolved
  `max` constraint **after** modifiers — that is what makes it follow the battle size.
- `withDetachmentToggled(roster, graph, entryId, on)` adds/removes one; `withDetachment` is kept
  as "replace them all with this one" for the `pendingDetachmentId` migration path.
- Roster editor: a checkbox list with a `spent / limit DP` meter, options that would overspend
  shown **disabled but visible with "over budget"** rather than erroring after the fact. One rules
  section per chosen detachment.
- Downstream: stratagems are Core plus the union, under **one heading per detachment** at the
  table; reminders and datasheet rules come from every detachment, each tagged with its source;
  the export prints `Detachments: A (1 DP), B (2 DP) — 3/3 DP`.
- **Dexie v9**: `Game.detachmentName` → `detachmentNames: string[]`. The logic is a plain function
  (`src/play/migrate.ts`) so it is tested without an IndexedDB — there is no fake-indexeddb in this
  repo and adding one for this was not worth it. **The upgrade was also run for real**: a git
  worktree at the previous commit served the old app on the same port, its own Dexie database was
  seeded with an in-progress game, and the new app then opened it — round, phase, CP, VP and log
  all kept, `detachmentName` became `detachmentNames: ["Hand of the Dynasty"]`, and the Play screen
  listed the game. Worth repeating for any future migration; note that a **hand-built** IndexedDB
  at v8 is not a valid stand-in (Dexie drops stores it has no metadata for, and the game vanishes —
  that is the harness lying, not a bug).
- Force Dispositions needed no work: the picker is gated by the data, so two detachments widen the
  choice for free (verified — Take and Hold *and* Purge the Foe offered).

### Necrons, and fixtures that run every faction

`test/fixtures.ts` assumed one catalogue per directory, so "the second-faction test" was a manual
`WH40K_FIXTURES` swap nobody would repeat. It now reads either the old flat layout **or a
subdirectory per faction sharing one `gs.json`**, and the three live suites `describe.each` over
what they find. Necrons (rev 22, 68 datasheets + 23 from a linked library, 12 detachments, DP
costs 1–3) passes parsing, reminder heuristics and the constraint evaluator **unchanged** — the
hard rule that a faction is a data install, not a code change, held.

Fixture layout, for the next agent:

```
<dir>/gs.json
<dir>/orks/Orks.json      <dir>/orks/orks.yaml      <dir>/orks/lib-*.json
<dir>/necrons/Necrons.json <dir>/necrons/necrons.yaml
```

### The bug a second detachment found

The roster summary read **"TAKE AND HOLD / Purge the Foe"**. The MFM mirror shouts Force
Dispositions, BSData title-cases them, and which one is stored depends on whether the merge found
a discrepancy for *that* detachment — so one detachment could never show the clash and two could.
Both parsers now title-case at the boundary. **`PARSER_VERSION` → 4**; installed catalogues
re-parse themselves from stored raw text at start.

### Walked through in headless Chrome, on Necrons

Install Necrons from GitHub → new roster at 2000 pts → picker reads **0 / 3 DP** and lists all 12
detachments with costs → take Hand of the Dynasty (1 DP) → **1 / 3** → take Annihilation Legion
(2 DP) → **3 / 3**, the other ten disabled with "over budget" → both rule sections shown, summary
reads both names → untick one and the budget, summary and rules all follow → four units → export
correct → Force Disposition offers both detachments' → Warlord → start a game → stratagems under
**HAND OF THE DYNASTY (3) · ANNIHILATION LEGION (6) · CORE (10)** → reminders name both. **No
console errors.**

Recipe notes beyond the 2026-09-13 one: use `launchPersistentContext` with a profile in the
scratchpad so the faction install survives between runs; the roster name field is
`getByPlaceholder('New army')`; units are picked via `.picker__main`; the export goes to the
clipboard, so grant `clipboard-read` and read it with `navigator.clipboard.readText()`; starting
an illegal roster raises a `confirm`, so attach a `dialog` handler. For the stratagem panel in dev,
run `node scripts/fetch-mission-deck.mjs` first — `public/stratagems-wahapedia.csv` only exists in
a build, and its 404 is the one console error you can ignore.

---

## Done 2026-09-14 (later) - the editor round

### Attached characters are not all Leaders

Everything that joins another unit does so through an association whose `action` is `group`, and
the app flattened them: the warning, the card chip and the attach label all said "Leader". The kind
now comes from the **association's own label**, and deliberately not from a list of two — Necrons
attach Cryptothralls to a Cryptek as **"Retainers"**, which is neither. A live test over both
factions demands every attaching datasheet resolve to a kind: **Orks 17 Leader / 7 Support,
Necrons 13 / 6 / 2 Retainers, none unrecognised**. `'Supported by'` is shown as "Support"; anything
else is shown exactly as the data labels it.

The per-kind caps were already enforced — a second Leader did fail — but with **"Mob: at most 1
points in this selection (has 2)"**, because `describe()` in the evaluator called every
non-`selections` field "points". It now names the rule: "at most 1 Leader".

### Units are numbered, and can be renamed

`unitNames(roster)` derives "Boyz #1 / #2 / #3" from the roster rather than storing it, so deleting
one renumbers the rest and a lone unit keeps its plain name. `Selection.customName` overrides it
(optional field, no migration); clearing the field restores the numbering. The names reach the
cards, the attach picker, the unit editor, the text export and the **game snapshot**, so the table
shows what the list showed.

### The attach control, and Detach

"Attach as Leader" / "Attach as Support", each target annotated with what it already holds —
`Boyz #1 · Leader taken by Warboss` (disabled) or `Boyz #1 · free · Leader: Warboss` when a support
character looks at the same unit. Capacity comes from the association's own `max`. Detach is its
own button; it used to be a "— not attached —" line buried in the dropdown, which is why the owner
thought it was missing.

### The picker stays open

Picking no longer closes it, each row carries a running "n in list" count, and the back control
says Done.

### Reinforced: one tap to full size

The owner's report was "the weapon limit should change when the unit is reinforced". **The
evaluator was already right** — a probe showed Special Weapons room 3 at 10 models and 6 at 20. The
trap is that a mob is *two* model groups: pressing + on the troopers alone reaches 18 Boyz + 1 Nob
= **19 models, already charged at the 20-model price of 180 pts**, and the data's
`increment 3 when the unit has ≥ 20 models` never fires.

`roster/size.ts` fills **every** model group by asking the evaluator for `headroom` and
`groupHeadroom` and taking what it offers, one model at a time so a shared group cap is never
overshot. Nothing here knows any unit's sizes. Size means *models directly under the unit*, so
weapon options hanging off those models are untouched — a bigger mob is not a better-armed one.
Shrinking reads the minimum off a freshly instantiated copy, which keeps the loadout.

Verified in the browser: 10 models · 90 pts · Special Weapons **0/3** → tick → 20 models · 180 pts ·
**0/6** → untick → back to 10 · 90 · 0/3. A live test grows and shrinks every resizable unit in both
factions (31 in total) without adding a single error, and records which allowances actually grow
with size: **Orks Special Weapons 3→6** and Grot Tank extra weapon 1→2; Necrons has none, which is
why that assertion is asked of the fixtures as a whole rather than per faction.

### A compulsory loadout cannot be emptied

Taking a `min 1 / max 1` group to zero left an illegal unit **and hid the nested options of
whatever was removed**, so there was no way back — the owner's "I have to choose a loadout, can't
choose none". `−` is now disabled at the group's minimum, with the reason in the tooltip. Because
`+` is greyed while such a group is full, that alone would make switching impossible, so in a
one-of-N group **`+` on another option swaps to it** (and skips the increment guard, since a swap
does not grow anything).

### Reading before choosing (2026-09-14, later still)

Three complaints with one shape: the app knew things it was not showing.

- **An enhancement can be read before it is taken.** `OptionTree` carries an optional
  `texts: Map<entryId, string>`; any option the catalogue has rules text for gets an `i` that
  expands in place. Built from `catalogue.enhancements`, so it costs nothing and will cover
  whatever else the parser learns to carry.
- **A detachment says what it gives you.** Its `<details>` now has three sections — Rules,
  Enhancements (name, points, full text) and Stratagems (CP, turn/phase, effect).
  `roster/detachmentInfo.ts` does the join the sources force: the **mirror** lists a detachment's
  enhancements by name and price, **BSData** carries the text, and only the name connects them, so
  it matches through `normaliseName` (the same matcher the cross-source merge uses) and still lists
  an enhancement whose text it cannot find rather than dropping it. The Core stratagems are left
  out on purpose: they belong to every army and say nothing about *this* detachment.
- **A unit shows who has joined it.** The unit editor lists its attached characters with kind and
  points, and every ability and enhancement they bring appears in the Abilities section tagged
  `WARBOSS · LEADER`. Which of a character's abilities confer to the bodyguard is a judgement the
  rules make in prose, so everything is listed and tagged rather than guessed at.

Watch out when testing enhancements: a detachment's enhancements are often gated ("WAGON unit
only"), so an empty Enhancements group on a Warboss is the *data* being right. Blitz Brigade shows
none; War Horde offers four.

### Loadouts on a full-size unit (2026-09-14, later still)

Three bugs, one root: **a special-weapon model replaces an ordinary one**. "Boy w/ Rokkit launcha"
is not an extra Boy, it is one of the mob's Boyz carrying a rokkit. The data says so by nesting the
Special Weapons group *inside* the size group — worth knowing, because the editor renders those
rows against the **unit**, not against the Boy, so the plain Boy is their *sibling*, not their
parent. An hour went into that; the DOM nesting suggests otherwise.

1. **Taking a special weapon at full size was refused.** The unit is 18/18, so adding one breaks the
   size cap and the increment guard says "At the limit the data allows for this option" while the
   owner has zero of them. `OptionRow` now, on refusal, offers the evaluator a version that takes
   one from a sibling model (largest first) and uses the first it accepts — hint: "Replaced one
   Boy". Which sibling is the right donor is never assumed; the evaluator decides.
2. **Two Nobz shared one loadout.** Two models are one selection with `count: 2`, so the loadout
   hanging off it is shared. `roster/split.ts` separates a pick into one selection per model, each
   with its own copy, and `GroupEditor` then renders a row per copy ("Nob 1 of 2"). `mergeSelection`
   puts identical copies back, so it is not a one-way door; copies equipped differently refuse to
   merge rather than silently discarding one. The offer is capped at **6 copies** — sixteen
   expandable loadouts is not an editor, and a big unit's variation is what the data's own
   special-weapon entries are for.
3. **Reinforcing a mob that already had a special weapon overshot to 19/18** — my own bug from the
   Reinforced toggle. `withUnitSize` grew the replacement model too (changing the loadout) and could
   not see the size cap, because that model's group is the nested one. Growth now skips models
   outside the unit's own size groups **and** offers every step to the evaluator, largest first,
   keeping the first that adds no error. No group topology is hard-coded.

Fixture note: a synthetic catalogue only reproduces this if the special-weapons group is nested in
the **size group**, not in the model entry. Put it in the model entry and the evaluator will happily
allow 21 models, and the test will lie.

### Faction states, and four smaller fixes (2026-09-14, evening)

**Marks — states a codex names, granted and read from the data.** The owner asked for Ork
"riled up": choose which unit a Warboss riles up, rile the whole army with a Waaagh!, and see the
5+ invulnerable it grants. None of that is in code as Ork anything. `src/play/marks.ts` discovers
the states from the installed catalogue, using the data's own convention: it bolds **KEYWORDS** in
capitals and writes states in prose (**riled up**).

A phrase counts as a state only when something **sets** it *and* something **reads** it — a state
nothing can put a unit into is a turn of phrase, and one nothing reacts to changes nothing. On the
owner's data that yields **Orks: 7 states, 95 granting abilities (85 self, 8 chosen, 2 army-wide);
Necrons: none**, which is correct — the Necron codex invents no such state.

Hard-won details, all of which cost a wrong first attempt:

- A rule's subject is often a line above the grant ("That unit: — Is no longer battle-shocked. —
  Is **riled up** until…"), so the "is this about a unit?" test must read the **whole rule**, not
  the words before the mention. Scoped to the sentence it found 14 grants instead of 95.
- "If this unit is on the battlefield, friendly ORKS units are **riled up**" *grants*; "While this
  unit is **riled up**, …" *reads*. The difference is whether the if/while clause runs unbroken to
  the mention — a comma between means the condition was about something else.
- A rule that only grants a state is not an effect of having it. An effect is a rule that mentions
  the state somewhere that is **not** a grant. That one line is what keeps "War Cry" out of the
  list of things being riled up does for you.
- "selected to shoot" is a moment, not a state; `damaged` is the wounds threshold the app already
  tracks. Both are excluded by name-shape and by the core-state list.

In Play: a unit sheet offers the states that can reach it, shows every rule that speaks about them
tagged with the state, and badges an invulnerable save the state grants (`5+ invulnerable save
while riled up`). A reminder whose rule grants a state gets the control to do it — a unit picker
showing who already has it for "select one friendly unit", a "Make all N riled up" button for an
army-wide sweep, and the duration in the rules' own words. Marks are cleared by hand; expiry from
prose ("until the start of your next turn") would be guesswork, so the wording is shown instead.

**Follow-ups the same evening:** who a state reaches is a property of the **whole rule**, not of
the sentence that grants it — an army rule names its audience once at the top ("Friendly ORKS with
this ability can: …") and grants the state three bullets later, so reading the sweep from the
granting sentence made the Waaagh! offer a unit picker instead of applying to everyone. Fixing that
also corrected the split on real data: the army rule is repeated on every datasheet, so the counts
moved from 85 self / 2 army to 12 self / 75 army, which is what the data actually says. A game in
progress can now be deleted from the Play screen; only finished ones could be.

**Four smaller fixes:**

- Stratagems say who they can be used on: "Target:" on the row in Play, and Target/When/Effect in
  the detachment section when building a list.
- Secondaries showed the other mode's scoring. A card can price a deed differently in Fixed and
  Tactical *and* carry lines that exist in only one — one scores per character killed in Fixed and
  all-or-nothing in Tactical, on the same face. `missions/scoring.ts` picks the lines and the value
  for the mode being played.
- **"Once per battle round" matched "once per battle"** — one word apart, a whole game in
  consequence: the ability was filed as once-per-battle and vanished after its first tick.
- An ability that fires when a model is destroyed is not a reminder; it surfaced in whatever phase
  its text happened to name. Those start switched off (31 abilities in one faction, 23 in the
  other) and can be switched on in Settings like any other.

### Reminder quality, and three Play fixes (2026-09-14, late)

The owner read the reminders one by one and found them full of errors. Two root causes, both
measurable, both now guarded by live tests over the real catalogues.

**Phase vocabulary was being read as a moment.** `TRIGGER_RULES` matched things like
`ranged (attack|weapon)s?` and `melee attacks`, so a passive modifier — "Ranged attacks that target
this unit have -1 D" — was filed under Shooting and shown every Shooting phase. That is why
reminders appeared "on the whole page". The patterns now match **moments** ("in your Shooting
phase", "selected to shoot", "has shot") and never bare vocabulary.

**A rule's duration was being read as its trigger.** "In your Shooting phase, …, until the end of
the turn" matched the `end_of_turn` rule, which sat above the phase rules, and landed in the wrong
panel. A rule that *opens* by naming its phase now wins outright — checked against the rule's own
text, because `infer` prepends the ability name and its full stop breaks an anchored match.

**And a reminder must be something to do.** A rule that only changes a profile or grants a keyword
("Friendly WARBIKERS units have BATTLELINE") needs no reminding; it is always true. Enabled now
requires a moment **and** an action ("you can", "select", "roll", "re-roll", …) or a once-per-X.

Measured on the owner's data: rules that state a phase and are filed elsewhere went **3 → 0**
(Necrons) and **4 → 0** (Orks); passive-but-enabled went **13 → 4** and **42 → 6**. Both examples
the owner named are fixed — one is no longer a reminder at all, the other moved to the phase it
states. Two live assertions now hold the line: zero misfiled, and fewer than 45% of a codex enabled.

Note the older assertion "most rules must get a trigger" had to be inverted: most of a codex *is*
passive, so it now checks a band rather than a floor.

**Three Play fixes:**

- **Opening a unit landed wherever the list was scrolled.** `window.scrollTo` does nothing here —
  the app scrolls the shell's `<main>`, not the document. `screens/scrollToTop.ts` finds the
  scrolling ancestor rather than naming it. Measured: 3879 → 0.
- Stratagems are gone from the unit sheet. The phase panel already lists them, and repeating them
  pushed the stat line off the screen.
- Every stratagem row expands, including those not timed for this phase. They always could — they
  simply had no affordance, so a chevron is now on every row and the dimmed ones keep it in the
  accent colour: dimmed is not disabled, and their rules are worth reading before committing to a
  turn.

---

## Next

### Step 1 - a session on the owner's phone

Still the top item. The multi-detachment picker and the per-detachment stratagem headings have
only been seen at 390×844 in headless Chrome, never under a thumb; the detachment list is now
twelve rows on Necrons, which is the first screen here that may want scrolling on a phone.

**Done in headless Chrome (2026-09-13, evening), not yet on a phone.** A Playwright-core driver
against the dev server, at a 390×844 viewport, went through: install the faction from GitHub →
new roster → detachment → the spec §9 20-model unit built with the steppers (180 pts) → a leader
added, nominated Warlord, attached via "Attach to" → an enhancement from the detachment's group
→ Force Disposition picked → **✓ Legal, 305 pts, no console errors** → start a game → remove one
model of a specific type → weapons table → six phase steps → undo → log. Screens render cleanly at
phone width. Two bugs found and fixed there, both in the in-game weapons table (see Phase 3 notes:
name matching is now most-specific-first, and a combined-weapon container counts only the part of
its name its children do not cover).

Recipe, for the next agent: `npm install playwright-core` in the scratchpad, launch with
`executablePath` pointing at the system Chrome, drive `http://localhost:5173/wh40k-helper/#/…`,
screenshot to the scratchpad and Read the PNGs. The script names real units, so it lives in the
scratchpad, never in the tree. Do **not** pass `hasTouch: true` — the first click was swallowed.

Still to do **on the phone**: open an *old* roster (created before v4) and confirm
`normaliseRoster` converts it; install-to-home-screen and offline behaviour of the new screens;
feel of the steppers and the "Remove models…" panel with a thumb; unit-editor speed on a large
unit (every group asks `isGroupAvailable`; memoise per render in `UnitEditor` if it lags — it did
not in Chrome).

### Done 2026-09-13 (late) - owner decisions and spec v0.6

The owner decided: **transports are v1**, the **§9 example is updated** to the current data,
and the app must **move lists between a PC and the phone** and be **pleasant on a desktop
browser**. Spec v0.6 records all four (§2, §3, §4.4, §9, §10). Built the same evening and
walked through in headless Chrome:

- **Embarking (Play Mode).** `GameUnit.embarkedIn`; `embark` / `disembark` actions; a
  transport's card (any unit whose datasheet has a transport capacity) offers an "Embark a unit"
  select with the capacity text as a reminder (not enforced — it mixes counts and keywords);
  passengers render inside the transport like leaders inside their unit; a destroyed transport
  spills its passengers with a log line; undo restores. Leaders always ride with their unit.
- **Transfer by text (`src/roster/transfer.ts`).** "Share" on a roster card puts a versioned JSON
  envelope on the clipboard (share sheet on touch devices only — desktop Chrome has
  `navigator.share` too and opens the Windows dialog, which is not what you want at a PC);
  "Import" on the Rosters screen accepts paste or a file, adopts the roster with a fresh id and a
  non-colliding name, and warns when the faction is not installed on this device.
- **Sync (`src/sync/client.ts`, `worker/`).** Settings → "Sync between your devices": endpoint
  URL + passphrase, "Sync now". One `POST /sync/rosters` and one `/sync/games` per tap; the
  Worker (Cloudflare, KV, source and deploy steps in `worker/README.md`) merges by `updatedAt`
  and returns the merged set; the client applies newer records and honours tombstones (local
  deletions are recorded in a `sync.tombstones` setting by `deleteRoster` / `deleteGame`).
  **The owner has not deployed the Worker yet** — the client was only tested against a dead URL
  (clean error) and by reading the code; test against a real deployment is the next step.
- **Desktop layout.** Content column max 760 px, header and tab bar follow it above 900 px.
- Duplicate Warlord messages: layer 2 stands down when the data's Warlord category minimum is
  live (`warlordChecked`), as it already did for the points limit.

### Step 2 - Phase 3 leftovers

- **Sync Worker — deferred by the owner** (late 2026-09-13: "not needed now, maybe later"). The
  client and `worker/` stay as they are; do not push for deployment. When the owner picks it up:
  deploy per `worker/README.md`, sync PC ↔ phone once, fix what that shows, then consider syncing
  on opening the Rosters screen (spec allows it "once trusted"). The endpoint proxy for the
  mission deck and Wahapedia rules text (Phase 1b) wait for the same moment.
- **Phone check done by the owner** (late 2026-09-13) after all six phases were built, with no
  problems reported. The shipped mission deck arrived after that check.
- ~~Model-removal default order~~ and ~~Reserves "arrive"~~ — done 2026-09-13 night (see Phase 4
  notes). The default is by group size; if a faction has a mixed unit whose plain models are not
  the largest group, that unit needs the "Remove models…" panel, which is still there.
- ~~Stratagems per detachment on the in-game datasheet~~ — done 2026-09-13 night 2 via the
  Wahapedia stratagem import (see "Owner feedback round"). **The owner decided (2026-09-13, night 2) that the
  build ships `Stratagems.csv` too:** `scripts/fetch-mission-deck.mjs` fetches it into the
  git-ignored `public/stratagems-wahapedia.csv`, the guard exempts exactly `dist/missions-ca-*.html`
  and `dist/stratagems-wahapedia.csv` (`SHIPPED_IN_BUILD`), Workbox precaches `.csv`, and
  `ensureStratagems()` imports it at app start when the device has none (a dev server has none
  unless the script is run locally). File import and the endpoint proxy remain as fallbacks.
- Weapon-profile matching (`weaponCounts` in `GameUnitSheet.tsx`): per loadout entry, exact
  name or the weapon a "➤ X - Mode" sub-profile belongs to first, else whole-word containment
  for combined weapons. Profiles no survivor carries are folded into "Other profiles".
  Verified on the real 20-model unit after casualties; watch other factions' naming.

### Step 3 - Phase 4 leftovers

Built (see "Phase 4 - Missions (core)"), including the card editor and the card-state trackers
(2026-09-13 night). Still to do, in rough order of value:

- **Adding a whole house-rule card** — the editor edits existing cards only. Would need an
  "Add card" per deck plus a delete; the Tactical deck shuffles `deck.secondaries`, so a new
  secondary would join it automatically.
- **Preserving edits across a re-import** — today the import replaces the deck and the edits.
  A diff of edited cards against the fresh import, re-applied by id, would keep them.
- **WHEN DRAWN prompts** that pick a unit or objective (Beacon, A Tempting Target, Burden of Trust)
  are shown as text; wiring them to the army list is the next step.
- **Twist effects on setup**: Mirrored World (shared primary, D6 table) and Scrambled
  Communications (swap primaries) are shown as text, not applied automatically.
- The Data screen's "Refresh through my endpoint" is untested until the owner deploys the Worker.
- Secondary scoring for the opponent is a plain number (spec §6.2 says so); fine.

### Step 4 - Phase 5 leftovers

Built (see "Phase 5 - Reminders"). What a real game will tell:

- **Tune the heuristics** with the owner: which defaults are wrong or noisy. The Reminders
  settings screen is the escape hatch meanwhile. Candidates: core-rule abilities (Deep Strike,
  Scouts, Stealth…) currently land as *army* rules because BSData links them as shared rules;
  showing them per unit would need the parser to keep the link per datasheet (it does — they
  are in `sheet.abilities` with kind `faction`; `derive.ts` chooses to pool them).
- **Stratagems** are imported now (Wahapedia export, Data screen); the in-game panel filters by
  phase. Turning them into reminders (the heuristics already understand the WHEN wording) is a
  small follow-up if the panel proves too far from the reminders list in a real game.
- **Detachment-conditional weapon keywords** (BSData profile modifiers, e.g. `[ASSAULT]` while a
  detachment is present) are not evaluated; the detachment rule text is shown on the unit instead.
- **Role grouping** is on the roster, the picker and the datasheet browser; Settings → Reminders
  still lists units flat.
- The unit-sheet's "Stratagems for this unit" is a keyword match on the TARGET line; Wahapedia's
  `Datasheets_stratagems.csv` (datasheet id → stratagem id) would be exact but needs the
  Wahapedia datasheet ids joined to BSData by name.
- **Weapon keywords** (spec lists them as reminder sources) are not reminders yet — Sustained
  Hits, Lethal Hits etc. are visible in the weapons table; a per-unit "keywords in play" line in
  the Shooting/Fight panel would be the cheap version.
- The panel shows every copy of a datasheet separately; a "×2" merge for identical units would
  shorten it.

### Phase 1b - deferred, needs a proxy

Wahapedia sends no CORS headers, so its rules text and the mission deck need the small user-owned
Cloudflare Worker (spec 4.2) or the manual file-import flow. Not started.

### Step 5 - Phase 6 leftovers

- **Re-install the owner's faction once** after this update so its linked library (Legends
  fortifications) is downloaded; until then the re-parsed record simply lacks them.
- A shared library's other factions still appear in Settings → Reminders (detachment groups)
  and as "linked" datasheets in the browser; gating them by the evaluator's availability there
  is possible but was not needed for play.
- Legends fortifications from Unaligned Forces are datasheets now; the roster picker hides them
  behind the data's own "Show Legends" toggle as before.
- PWA offline hardening was reviewed, not changed: hash routing, `registerType: 'prompt'`,
  Workbox precaches the build, data lives in IndexedDB. Confirm on the phone with the checklist.

### Not yet built from Phase 1/2's own scope

- ~~"Update all" button~~ and ~~re-validating rosters after a data update~~ — done in Phase 6.
- Per-item overrides on the Data Health screen, still unwired.
- The alias table for names normalisation cannot join.

### Open questions for the owner

- Which two factions come next (only needed to pick a Phase 6 test catalogue)?

Answered 2026-09-13: transports are v1 (built); the §9 example is updated in spec v0.6.
