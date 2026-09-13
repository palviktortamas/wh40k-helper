# Warhammer 40,000 (11th Edition) Play Helper — Specification

Version 0.7 — 2026-09-13 (v0.5: Phase 0 source verification added as Appendix A; v0.6: §9 example
corrected to the current data, transports decided for v1, §4.4 cross-device transfer and sync added,
desktop usability added to §3; v0.7: the mission deck ships with the build — fetched from Wahapedia
at deploy time, never committed — per the owner's decision; §6.1 and §10 note it)
Audience: Claude Code (implementer). Owner: a single private user; app is never published.

---

## 1. Purpose

A personal, mobile-first app for playing Warhammer 40,000 11th Edition. Two modes:

1. **List Builder** — build and validate army lists (comparable to New Recruit / the official Warhammer 40k app): units, models, per-model weapon loadouts, leaders, enhancements, detachments, points limits, legality checks.
2. **Play Mode** — run a game from a saved list: mission setup (primary + secondary missions per the Chapter Approved 2026-27 rules), live army view with stats and attacks, per-unit wound tracking, and configurable per-ability reminders (once-per-battle, command-phase, on-charge, etc.).

Scope for v1: **Orks only**, but nothing may be Ork-specific in the code — data is loaded per faction and 1–2 more factions will be enabled later by simply loading their catalogues.

## 2. Users, constraints, non-goals

- One user (the owner), occasionally 1–2 friends using the owner's phone or their own copy of the app.
- **No accounts, no third-party backend, no analytics, no telemetry.** All data lives on the device and works offline. The one exception is the owner's own optional sync endpoint (§4.4), which the owner hosts and which stores nothing but the owner's rosters and games.
- Not published to any store. Not distributed publicly. Contains GW rules text only insofar as the community datafiles and the user's own entries contain it — this is fine for private use; do not add any sharing/publishing feature.
- Non-goals for v1: multiplayer sync, opponent's army tracking, dice roller, Crusade, Combat Patrol, Boarding Actions, Kill Team, painting/collection tracking.

## 3. Platform & tech

- **Progressive Web App (PWA)**, installable to the home screen on iOS Safari and Android Chrome. Must work fully **offline** after first load (service worker, precached app shell and datafiles).
- Mobile-first UI (portrait, ~360–430 px wide). Large touch targets, dark theme by default (games are often played in dim clubs), light theme optional. **The same build must also be usable and pleasant in a desktop browser** — lists are typically built at a PC and played from the phone: content centred in a readable max width (~760 px), the tab bar still reachable, no stretched full-width controls, keyboard-navigable forms. Landscape/tablet layout follows from that.
- Persistence: IndexedDB (via a thin wrapper such as Dexie) for rosters, games, imported datafiles and settings. Provide a full **Export / Import backup** as a single JSON file (share sheet / file picker) so data survives a phone change. Never use `localStorage` for primary data.
- Stack: Claude Code chooses, with the constraint that it is a single static bundle deployable to **GitHub Pages** (decided). Suggested: TypeScript + React (or Svelte/Vue) + Vite + `vite-plugin-pwa`. No SSR, no server code. Deploy via a GitHub Actions workflow on push to `main`; the data-update logic must work from the Pages origin (fetch GitHub raw + Wahapedia + mfm mirror over HTTPS; if any source blocks cross-origin requests, fall back to the file-import flow described in §4.2 — never snapshot GW data into the public repo).
  - Testing loop: pushing to `main` redeploys in about a minute; the installed PWA picks up the new version on next open (show a "new version available — reload" toast). Also provide `npm run dev -- --host` so the owner can open the dev build from the phone over local Wi-Fi, and print a QR code of the Pages URL in the README.
  - Note on GitHub Pages: free for **public** repositories; publishing Pages from a **private** repo needs a paid GitHub plan. A public repo means the app URL is reachable by anyone who knows it (no listing anywhere, no search indexing — add `<meta name="robots" content="noindex">`), which is acceptable for private use. If the owner later wants the repo private for free, Cloudflare Pages is the drop-in alternative.
- Wake lock (`navigator.wakeLock`) while in Play Mode so the screen stays on.

## 4. Data layer — online sources & import

### 4.1 Sources (all verified live as of 2026-09-13)

Three complementary online sources exist. Each is used for what it is best at; none is scraped from HTML — all are machine-readable files.

| # | Source | URL | Format | Used for |
|---|--------|-----|--------|----------|
| A | **BSData wh40k-11e** (community BattleScribe data, actively maintained, Orks included, tracks the new Codex: Orks) | `https://github.com/BSData/wh40k-11e` | **JSON** (BattleScribe schema serialised as JSON — NOT the XML `.gst/.cat` of earlier editions): `Warhammer 40,000.json` (game system) + one `<Faction>.json` per faction, e.g. `Orks.json` (2.1 MB) | **List-building constraints and legality** (option limits, unit-size options, per-size points, enhancement limits, detachment/detachment-point rules, leader eligibility), unit/weapon/ability data as fallback |
| B | **Wahapedia 11th-edition Data Export** (official CSV dump provided by the site owner for exactly this purpose; updated whenever the site updates) | Index: `https://wahapedia.ru/wh40k11ed/the-rules/data-export/` → spec + file links in `https://wahapedia.ru/wh40k11ed/Export%20Data%20Specs.xlsx` | Pipe-delimited (`\|`) UTF-8 CSV tables linked by ids (factions, datasheets, models/stat lines, wargear/weapon profiles, abilities, keywords, stratagems, detachments/enhancements, `Last_update.csv`); long text fields are HTML | **Rules text and datasheet display** (abilities, stratagems, detachment rules with full text), **and the Chapter Approved 2026-27 mission cards** — Wahapedia publishes the full deck online at `https://wahapedia.ru/wh40k11ed/the-rules/mission-deck-2026-27/` (see §6.1); check whether the export contains a missions/secondaries table, otherwise the mission page is parsed once into the app's own JSON |
| C | **Official Munitorum Field Manual (online)** by Games Workshop | `https://mfm.warhammer-community.com/en` (mirrored as parsed JSON snapshots in `https://github.com/BSData/wh40k-11e-mfm`) | Web page / JSON mirror | **Authoritative points**, leader & *Support* eligibility lists, detachment points, Force Dispositions, and the new **Requisition Thresholds** (extra cost when taking many copies of a datasheet). Use the BSData mfm mirror programmatically; link the official page in-app for the user to verify |

Rules of precedence when sources disagree: points → C (mfm mirror) over A over B; constraints → A; rules text → B over A; Force Dispositions → C over A (B's `Detachments.csv` stores only one Force Disposition per detachment and is lossy — verified: War Horde is Take and Hold **and** Purge the Foe in both A and C). Every record keeps its source id so cross-linking (BSData entry ↔ Wahapedia datasheet ↔ MFM line) is by **normalised name + faction**, with a small manual alias table for mismatches. Show the version/last-update date of each source in Settings → Data.

**Cross-source error checking (required).** The sources are community-maintained and each has bugs (BSData's issue tracker shows regular Ork typos — wrong attack counts, missing ability text). The app therefore uses the overlap deliberately:
- After every data update, run a **consistency check** comparing, per unit: points at each size (A vs C), stat line and weapon profiles (A vs B), unit composition / model counts (A vs B vs C starting strengths), leader & Support eligibility (A vs C), enhancement costs (A vs C), detachment names and detachment points (A vs B vs C).
- Results go to a **Data Health** screen: list of discrepancies with the values from each source, the source the app chose (by precedence), and a per-item **manual override** ("use Wahapedia value", "use BSData value", or a typed value with a note). Overrides persist across updates and are included in the backup.
- Units/records that exist in only one source are flagged as "unmatched" rather than silently dropped; the alias table can join them.
- In the List Builder and datasheet view, a small warning icon appears on any unit or weapon that has an unresolved discrepancy, tapping it opens the Data Health entry. Roster totals use the chosen value, but the roster export mentions "N unresolved data discrepancies" if any affect it.
- The check must not block usage: it runs in the worker after import and the UI stays responsive.

Claude Code must inspect the current BSData repo structure and schema (BattleScribe data format v2.03 serialised as JSON: `gameSystem`, `catalogue`, `selectionEntry`, `selectionEntryGroup`, `entryLink`, `profile`/`characteristic`, `cost`, `constraint`, `modifier`, `condition`, `categoryEntry`, `forceEntry`, `rule`, `infoLink`) and the Wahapedia Export Data Specs workbook before designing the internal model. Do not assume the 10th-edition layout; 11th edition changed detachments (modular detachment system with detachment points and Force Dispositions), enhancements, leader/support characters, Requisition Thresholds and army construction, and each source encodes this in its own way.

**Reference implementation to learn from (not to copy wholesale):** `https://github.com/fjlaubscher/depot` — an open-source React + Vite PWA with IndexedDB offline storage that already has a CLI converting the Wahapedia 11e CSV export into typed JSON. Its data pipeline and CSV parsing are directly relevant; its UI/roster features are not the target.

### 4.2 Import flow
- Settings → **Data** screen:
  - Shows the game system version, list of available catalogues (parsed from the repo's index / file list), and which ones are installed, with the last-updated date.
  - "Install / Update" per catalogue and "Update all". Downloads raw files from GitHub (`raw.githubusercontent.com`, main branch or a tagged release — configurable), parses them, stores the **parsed** internal representation in IndexedDB, and keeps the raw XML for re-parsing after app updates.
  - Fallback: "Import from file" (user picks `.gst`/`.cat`/`.catz` files manually) for when GitHub is unreachable.
- Parsing happens in a Web Worker (the Ork catalogue plus the shared game system file is large).
- The same screen updates the Wahapedia CSV export (filtered to installed factions + core/mission tables) and the MFM points mirror. One "Update all" button does everything and reports what changed.
- **CORS reality (verified 2026-09-13):** `raw.githubusercontent.com` (BSData + MFM mirror) sends `Access-Control-Allow-Origin: *` → fetchable directly from the browser. **Wahapedia sends no CORS headers** → its CSVs and the mission-deck page cannot be fetched by the app directly. Therefore:
  - **Core path (works with zero extra infrastructure):** BSData + MFM mirror only. This already gives stats, weapons, ability text, points, constraints, detachments, Force Dispositions and leader eligibility — enough for the entire List Builder and the army side of Play Mode.
  - **Wahapedia enrichment + mission deck via a user-owned proxy:** a tiny Cloudflare Worker (free tier, ~20 lines, generated by Claude Code, allow-list `wahapedia.ru` only, adds CORS headers, no storage). The owner creates a free Cloudflare account and pastes the worker; the app has a Settings field for the proxy URL. Without a proxy the app still works, and Settings offers **"Import from files"** (owner downloads the CSVs / saves the mission page on the phone and picks them) as the manual fallback.
  - Do **not** mirror Wahapedia files into the public repo (see below), even via a scheduled Action.
- **No game data is committed to the public repository or served from the Pages origin.** The repo contains code only. On first launch the app shows a one-time "Download game data" step (Orks pre-selected) that fetches BSData, the Wahapedia export slice, the MFM mirror and the mission deck directly from their sources into IndexedDB; from then on everything is offline. Mission deck JSON is generated on-device from the Wahapedia page (or its export) rather than shipped in the repo. The conversion code and schemas live in the repo; the data does not. If a source blocks browser requests (CORS), the fallback is a small `data-sources.json` of URLs plus a user-initiated "Import from files" flow — still no GW content in the repo.
- Only installed catalogues appear in the List Builder.
- Existing rosters remember which data version they were built with; after an update, re-validate and show a diff of what changed for that roster (points changed, unit/option removed, new validation errors).

### 4.3 Internal model (minimum)
- **Faction / Catalogue**: id, name, version, army rules, detachments (with their rules, enhancements, stratagems), keywords.
- **Datasheet (unit)**: id, name, keywords, unit composition options (model counts, e.g. 10 or 20 Boyz), points per size, stat lines (M, T, Sv, W, Ld, OC, invulnerable save if any), abilities (core, faction, datasheet, wargear, leader/"can attach to" list), damaged profile, transport capacity.
- **Model** (within a unit): name, count constraints, default weapons, weapon **option groups** with min/max (e.g. "for every 10 models, 1 may replace slugga+choppa with rokkit launcha").
- **Weapon profile**: name, range, A, BS/WS, S, AP, D, keywords (Sustained Hits, Lethal Hits, Torrent, Blast, Devastating Wounds, Anti-X, Hazardous, Pistol, Heavy, Assault, Melta, Twin-linked, Precision, Ignores Cover, Lance, Extra Attacks, Indirect Fire, One Shot …); support multiple profiles per weapon (e.g. strike/sweep).
- **Ability / Rule**: id, name, full text, type (Core / Faction / Detachment / Datasheet / Wargear / Enhancement / Stratagem), and **reminder metadata** (see §6.4).
- **Constraints** (from BSData): the raw constraint/modifier/condition graph, kept faithfully so the validator can evaluate it.

### 4.4 Cross-device transfer and sync (added v0.6)

The owner builds lists at a PC and plays from the phone, so a roster must move between devices without a phone change or a cable. Two mechanisms, both offline-first:

1. **Transfer by text/file (no infrastructure).** Any roster can be exported as a single JSON document (versioned envelope: app id, kind, schema version, the roster, the catalogue it belongs to) via copy-to-clipboard, the share sheet, or a file; the Rosters screen imports one by paste or file picker. Importing assigns a fresh id, keeps the catalogue id, and re-validates against the data installed on the receiving device (the data itself is downloaded per device, never transferred). The full backup of §3 uses the same envelope with `kind: 'backup'`.
2. **Sync through an owner-hosted endpoint.** A tiny Cloudflare Worker with a KV namespace (free tier), deployed by the owner from source kept in this repo (`worker/`), with a single long random passphrase set on both devices in Settings → Sync. The app talks to it only when the user taps *Upload* / *Download* (or, once trusted, on opening the Rosters screen), never in the background. Storage is a per-record document keyed by roster/game id with `updatedAt`; merge is last-writer-wins by `updatedAt`, deletions are tombstones, and nothing is ever overwritten on the device without the newer copy having a later timestamp. The endpoint holds only rosters and games — no game data, no personal data beyond what the owner typed. The same Worker later carries the Wahapedia proxy (§4.2) so there is exactly one piece of owner infrastructure. Without a configured endpoint the Sync section explains how to deploy one and the app is unchanged otherwise.

## 5. List Builder

### 5.1 Rosters
- Create / duplicate / rename / delete rosters. Each roster: name, faction (catalogue), detachment(s) per the 11e system, **points limit** (presets 500 / 1000 / 1500 / 2000 / 3000 + custom), notes.
- Roster list screen shows name, faction, detachment, points used / limit, and a green/red legality badge.
- Text export of the roster in a clean, shareable format (New Recruit-style plain text: unit, size, points, per-model loadout summary, leader attachments, enhancements, warlord). Copy to clipboard / share sheet. (Import of New Recruit exports is **out of scope** for v1.)

### 5.2 Adding and configuring units
- Browse units by role/category (as defined in the catalogue: Characters, Battleline, Dedicated Transports, Other, etc.), with search. Show points at each available unit size.
- Unit editor:
  - Unit size selector (from composition options).
  - **Per-model loadout editor.** This is a hard requirement and the main complaint about other apps. The unit is represented as individual model slots, each with its own equipment. Example the app must handle exactly: *20 Boyz = 1 Boss Nob (power klaw or big choppa, slugga), 2 Boyz with rokkit launcha, 17 Boyz with slugga + choppa* — the editor must let the user set that, enforce the option limits ("1 in 10 may take …"), and display a compact roll-up ("17× slugga & choppa · 2× rokkit launcha · Boss Nob: power klaw, slugga").
  - Provide quick "loadout presets" per unit ("all melee", "max special weapons") only if trivially derivable; not required.
  - Enhancements (Characters only, per detachment rules and limits).
  - **Warlord** toggle (exactly one per army).
  - **Leader attachment**: for units with the Leader ability, choose which eligible Bodyguard unit they join. Show the attached leader inside the bodyguard unit in list and play views. Enforce: eligible targets only, one leader per unit unless a rule allows two, a leader can't attach to a unit that already has one (unless permitted), etc. — take eligibility from the data.
  - Transport assignment (which units start embarked) — nice-to-have for v1, needed for Play Mode later.
  - Per-unit free-text note.
- Reordering units in the roster (drag or up/down buttons).

### 5.3 Validation ("tells you if something is illegal")
Two layers, both running live on every change; results shown as an error list at the top of the roster and as badges on the offending units.

1. **Generic BattleScribe constraint evaluator** — implements the semantics of BSData `constraint` (min/max on selections/points, scope `roster`/`force`/`parent`/category, `shared`, `includeChildSelections`), `modifier`/`condition`/`conditionGroup` (set/increment/decrement/append; `atLeast`/`atMost`/`equalTo`/`instanceOf`/`notInstanceOf` …). This is what makes "1 rokkit per 10 Boyz", "max 3 of a datasheet", "Epic Hero once", "enhancement limits", "detachment points" etc. work without hand-coding them, and it is what allows adding more factions later for free. Start by supporting the subset of the schema actually used in `wh40k-11e` and log unsupported constructs.
2. **Hard-coded 11th-edition core checks** (belt-and-braces, in case the datafiles don't encode them): points ≤ limit; exactly one Warlord; Epic Heroes unique; leader and *Support* attachment legality (per MFM eligibility lists); duplicate limits per the 11e core rules; **Requisition Thresholds** (extra points when exceeding the per-datasheet threshold — show the surcharge explicitly in the unit's cost); detachment requirements and detachment-point budget; derive and display the roster's available **Force Disposition(s)** for Play Mode. Claude Code must read the free 11e Core Rules (Warhammer Community PDF) and the current Orks Faction Pack / Munitorum Field Manual before writing these and cite the rule in each error message.

Errors (illegal) vs warnings (legal but suspicious, e.g. points left over > 50, unit without a loadout chosen, leader not attached). Legality badge is red only for errors.

## 6. Play Mode

### 6.1 Game setup
- Start from a roster (must be legal; allow override with a warning). Enter opponent name/faction (free text), points size, who has first turn (or "roll off" later).
- **Mission data** comes from the Chapter Approved 2026-27 Mission Deck, which Wahapedia publishes in full at `https://wahapedia.ru/wh40k11ed/the-rules/mission-deck-2026-27/` (including a working reference mission generator whose behaviour the app should mirror). The deploy workflow fetches that page into the build (`missions-ca-2026-27.html`, git-ignored — the repo itself holds no card text) and the app converts it on the device with a documented schema, importing it on first start; a saved copy of the page can also be imported by hand, or fetched through the owner's endpoint. The app also offers an in-app editor so the owner can fix typos or add house rules. *(v0.7: the owner decided on 2026-09-13 that the deployed app may ship the deck.)* Deck contents to encode:
  - **5 Force Disposition cards** (Take and Hold, Purge the Foe, Disruption, Reconnaissance, Priority Assets). Each maps the *opponent's* Force Disposition → *your* Primary Mission (5×5 = 25 primaries, 30 cards incl. duplicates). The player's available Force Dispositions come from their detachment (MFM/BSData).
  - **25 Primary Missions**, each with scoring blocks: applicability window (e.g. "First and second battle round", "Second battle round onwards", "End of the battle"), timing ("End of your turn" / "End of your Command phase (or end of your turn in BR5)"), condition text, VP value, cumulative bonuses, OR alternatives, and optional **Objective Actions** (starts / units / use limit / completes / effect / restrictions) and start-of-battle or start-of-turn setup steps (e.g. Punishment's *condemned* units, Locate and Deny's operation markers).
  - **6 Deployment cards** (Tipping Point, Sweeping Engagement, Search and Destroy, Hammer and Anvil, Dawn of War, Crucible of Battle) — name + card image URL (images shown from Wahapedia, cached for offline).
  - **18 Secondary Missions** (identical Attacker/Defender decks): scoring blocks as above, plus `fixed_eligible` flag and separate FIXED/TACTICAL VP values where they differ, `vp_cap` ("up to 5VP"), and **WHEN DRAWN** rules (e.g. draw-and-reshuffle in BR1, discard-and-redraw if no eligible targets, Plunder/Cleanse mutual exclusion, Beacon/A Tempting Target/Burden of Trust unit or objective selection).
  - **6 Twists** (Nowhere to Hide, Mirrored World, Scrambled Communications, Martial Pride, Ruinscape, Night Fighting) — text plus their mechanical effect on setup (Mirrored World: both use one of 5 listed primaries or D6; Scrambled Communications: swap primaries).
- Setup wizard follows the CA battle sequence: Muster → each player picks a Force Disposition (revealed together) → derive both Primary Missions → draw Deployment (random or pick) → optional Twist → central objective roll (D6: 1–5 one central objective, 6 two) → Attacker/Defender → Secondary mode → Battle Formations (transports, strategic reserves) → first turn. Every random step has a "draw" button and a manual override.
- Secondary mode: **Fixed** (choose two Fixed-eligible cards; cannot be discarded, active all game) or **Tactical** (deck behaviour in §6.2).

### 6.2 Game flow tracker
- Battle round (1–5) and phase tracker (Command → Movement → Shooting → Charge → Fight; plus "opponent's turn" state). Big Next/Prev buttons.
- **CP** counter (auto +1 for **both** players in every Command phase — the 11e Core Rules "Gain Core CP" step gives both players 1 CP in each player's Command phase, verified 2026-09-13; editable), **VP** counters for primary, secondaries, and total for both players (opponent's VP tracked as a plain number).
- **Secondary missions (Tactical)** — implement exactly as CA 2026-27 states (all numbers configurable in mission data):
  - Start of your Command phase: **draw two** cards face-up; they join any still-active cards (no hand-size cap).
  - Resolve **WHEN DRAWN** rules immediately (prompt for unit/objective selections; offer the reshuffle/redraw buttons only when the card allows it).
  - **Once per battle**, end of your Command phase: spend **1 CP** to discard one active card and draw one replacement.
  - End of each player's turn (active player first): score achieved cards (respecting per-card VP caps), then discard achieved Tactical cards. Then, on your own turn only, you may **discard one or more** active cards to gain **1 CP** (once, not per card).
  - **Fixed** mode: two cards chosen at setup, never discarded, scored whenever met; use FIXED VP values.
  - Enforce the **15 VP per battle round** scoring cap on secondaries as per the deck rules (end-of-battle VP are exempt).
- **Primary mission scoring assistant**: at each scoring timing (end of your Command phase from BR2, end of your turn, end of battle) show the primary's relevant scoring blocks for the current round as tappable checklist items with their VP; the app adds VP, the player confirms. Track mission state the card needs (operation markers placed, objectives *decoyed/triangulated/consecrated/trapped*, condemned units, beacon unit, guarded objectives, etc.) with simple counters/toggles.
- Undo for the last N actions (score change, discard, unit destroyed, etc.).
- Game log (timestamped list of actions), and a **game summary** at the end (result, VP by round). Game history stored locally.

### 6.3 Army view during play
- List of your units (leaders shown inside their bodyguard unit; embarked units under their transport). Each unit card shows: name, stat line, current models alive / total, wounds remaining on the current model (and for multi-wound models and characters), damaged-profile indicator, OC, and status chips (Battle-shocked, Advanced, Fell Back, Destroyed, in Reserves/Deep Strike, Embarked, once-per-battle used).
- Tap a unit → **datasheet view**: full stats, **weapons table with the actual loadout counts** ("17× slugga (A1 …), 2× rokkit launcha (A1 …), 20× choppa …"), abilities with full text, leader's abilities and weapons merged in, available stratagems for this detachment with CP cost and phase.
- Quick actions on the unit card: −1 model / −N models, damage current model, mark destroyed, toggle Battle-shock, toggle statuses, revive/undo. Removing models must respect loadout: the user picks which model type died (default: plain models first, then specials, character last) so weapon counts stay correct.
- Reserves: mark units as in Strategic Reserves / Deep Strike, and "arrive" them.

### 6.4 Reminders / helpers per ability
- Every ability, enhancement, detachment rule, stratagem and weapon keyword can have **reminder metadata**: trigger (`start_of_battle`, `command_phase`, `movement_phase`, `shooting_phase`, `charge_phase`, `fight_phase`, `when_charged`, `when_targeted`, `on_arrival_from_reserves`, `end_of_turn`, `opponent_turn`, `once_per_battle`, `once_per_turn`, `custom`), owner (unit/detachment/army), short one-line text, and a "used" checkbox when once-per-X.
- Metadata source: a heuristics pass over the rule text at import time (keyword matching: "Once per battle", "In your Command phase", "when this unit is selected to charge", "Waaagh!", "Stratagem … Shooting phase" …) produces defaults, **fully overridable by the user** per ability in a Reminders settings screen (toggle on/off, change trigger, change text). Overrides persist across data updates (keyed by stable rule id / name).
- At runtime: when the phase changes, a compact "Reminders for this phase" panel lists the enabled reminders whose trigger matches, grouped by unit; each can be checked off (and once-per-battle ones lock for the rest of the game). Master switch to silence all reminders. Reminders should be glanceable, not modal pop-ups.
- Example expected behaviour: at the start of the Command phase the panel shows "Waaagh! — call it? (once per battle)", "Warlord: enhancement X — activate", "Mek: Fix It — pick a vehicle within 3\"", "Stratagem Y available (1 CP)"; in the Charge phase, "Boyz: +1 to hit when charged/charging (Get Stuck In)" etc. Exact content comes from the data.

## 7. Cross-cutting requirements

- **Offline-first** everything. The only network calls are the datafile updates in Settings.
- **Performance**: roster validation must feel instant (<100 ms after a change) on a mid-range phone; heavy parsing off the main thread.
- **Data safety**: autosave on every change; backup export/import; no destructive action without undo or confirmation.
- **Extensibility**: adding a faction = installing its catalogue. No faction names in code, no Ork-specific branches. Reminder heuristics are keyword-based and generic.
- **Accessibility/usability**: readable at arm's length on a gaming table; minimum 16 px body text in play mode; high contrast; colour never the only carrier of meaning.
- **Attribution**: a Settings → About screen crediting BSData and Wahapedia ("powered by Wahapedia", as the site owner requests), linking the official Munitorum Field Manual, and stating the app is unofficial and private.

## 8. Suggested delivery phases

1. **Phase 1 — Data**: fetch, parse and cache BSData `Warhammer 40,000.json` + `Orks.json`, the Wahapedia CSV export (Orks + shared tables), the MFM mirror; cross-link records; internal model; datasheet browser (read-only). Deliverable: browse every Ork unit with correct stats, weapons, abilities, points, and a report of records that could not be matched across sources.
2. **Phase 2 — List Builder**: rosters, per-model loadouts, leaders, enhancements, warlord, detachment; generic constraint evaluator + core checks; text export; backup.
3. **Phase 3 — Play Mode core**: game setup, round/phase tracker, CP/VP, army view with wound/model tracking, datasheet view with loadout-aware weapon counts.
4. **Phase 4 — Missions**: mission JSON schema, one-off conversion of the Wahapedia mission deck page into `missions-ca-2026-27.json`, in-app editor, Force Disposition → primary derivation, setup wizard, secondary draw/discard/score per CA 2026-27, primary scoring assistant, game log/summary.
5. **Phase 5 — Reminders**: heuristic tagging, per-ability override UI, per-phase reminder panel, once-per-battle locks.
6. **Phase 6 — Polish**: PWA install/offline hardening, wake lock, data-update diff, second faction test (pick any other catalogue and verify nothing is Ork-specific).

Each phase must end with the app runnable on the owner's phone (deployed to the static host) and a short checklist of manual tests.

## 9. Acceptance criteria (samples)

- Can build a legal 2000-pt Ork list including a 20-Boyz unit with the exact loadout the current datasheet allows — `16× Boy (slugga+choppa), 2× Boy w/ rokkit launcha, 2× Nob (one with kustom choppa + kombi-skorcha)`; the first option group is capped at 18 and the Nobz sit in their own 1–2 group, so the old "17 + 2 + 1 Boss Nob w/ power klaw" build is not legal in the current data — a Warboss attached as Leader, one enhancement, warlord set; app shows green at 180 pts for the unit (verified against catalogue revision 3 on 2026-09-13).
- Adding a 3rd rokkit to that Boyz unit, a 2nd warlord, a 4th copy of a datasheet, or exceeding 2000 pts each produce a specific error naming the rule.
- After "Update data" changes a unit's points, the roster's total and badge update and the diff screen lists the change.
- If BSData and the MFM mirror disagree on a unit's points, the Data Health screen shows both values, the unit shows a warning icon, and choosing an override changes the roster total immediately.
- In Play Mode, removing 5 Boyz asks which models die and the weapons table counts update accordingly; the once-per-battle Waaagh! reminder disappears after being checked; the app keeps working in airplane mode.
- Installing another faction's catalogue and building a small list with it requires zero code changes.
- A fresh clone of the repository, searched for any unit name, ability text or points value, finds nothing: game data exists only on the user's device.

## 10. Open questions / assumptions (for the owner to confirm)

1. **Missions**: shipped with the build from Wahapedia's published deck (§6.1), fetched at deploy time and never committed — **decided 2026-09-13**; the owner only proofreads. If a future deck (2027-28) appears, the fetch script's URL and the parser's section names are what change.
2. **Opponent tracking**: only the opponent's VP/CP numbers, not their army (assumed).
3. **Hosting**: GitHub Pages (decided). Owner creates the public repo and enables Pages; Claude Code adds the deploy workflow.
4. **Transports/embarking** in Play Mode: **decided v1 (2026-09-13).** Units embark in and disembark from a transport during play; embarked units are shown under their transport; capacity is shown from the datasheet as a reminder, not enforced (the capacity text mixes model counts and keywords).
5. **Language**: UI in English (assumed); data is English from BSData.
6. Which two factions come next (only to pick a test catalogue for Phase 6)?


---

## Appendix A — Phase 0 findings (source verification, 2026-09-13)

Everything below was checked by actually downloading and parsing the files. Claude Code should treat this as ground truth for the first sprint and re-verify only if a fetch fails.

### A.1 BSData `wh40k-11e` (git clone, main @ 2026-09-12)
- **Format is JSON, not XML.** 47 files: `Warhammer 40,000.json` (game system, 0.96 MB) and one JSON per faction/library, e.g. `Orks.json` (2.15 MB, `catalogue.revision` 3, `battleScribeVersion` 2.03). Structure is the BattleScribe schema verbatim (`catalogue.sharedSelectionEntries`, `sharedSelectionEntryGroups`, `sharedProfiles`, `sharedRules`, `categoryEntries`, `entryLinks`, `catalogueLinks`; characteristics carry text in a `$text` key). Raw URL pattern: `https://raw.githubusercontent.com/BSData/wh40k-11e/main/Orks.json`.
- **Cost types:** `pts`, `Detachment Points`, `Enhancements`, plus Crusade/Blackstone types (ignore). **Profile types:** Unit (M,T,Sv,W,LD,OC,InSv), Ranged Weapons (Range,A,BS,S,AP,D,Keywords), Melee Weapons (Range,A,WS,S,AP,D,Keywords), Abilities (Description), Transport (Capacity), Psychic Abilities.
- **Constraint/condition/modifier vocabulary actually used** (counts across gs + Orks): `max` 1099, `set` 934, `append` 579, `atLeast` 527, `instanceOf` 523, `min` 447, `lessThan` 319, `greaterThan` 287, `notInstanceOf` 277, `atMost` 236, `increment` 223, `add` 62, `equalTo` 57, `decrement` 30, `before` 29, `divide` 26, `replace` 20, `floor` 5, `set-primary` 4, `remove` 4, `multiply` 2. Also `repeats`, `conditionGroups` (and/or), `localConditionGroups`, `childId` values `model` / `any` / entry ids, scopes `self`/`parent`/`unit`/`force`/`roster`/`root-entry`/`<entryId>`, flags `includeChildSelections`, `includeChildForces`, `shared`. The evaluator must implement exactly this set; `before` (ordinal position of this selection among siblings) is the unusual one and is how **Requisition Thresholds** are encoded.
- **Boyz (`e3b1-1240-2476-cd86`) — the spec's test case is fully encoded:**
  - Groups `9-18 Boyz` (min 9, max 18; model entry `Boy` min 6) and `1-2 Nobz` (min 1, max 2) → 18 Boyz + 2 Nobz is legal, 20 models.
  - `Special Weapons` group max 3, `increment 3` when unit has more than 10 models; each of `Boy w/ Big shoota` / `Boy w/ Rokkit launcha` / `Boy w/ Burna` max 1 at unit scope, `set 2` when ≥20 models.
  - Points: `pts` 90, `set 180` when models > 10; `increment 10` when at least 3 Boyz units come `before` this one in the parent (= "your 4th+ unit costs +10" Requisition Threshold). Force-wide max 6 Boyz, `set 4` when the roster is `1. Incursion (1000 Point limit)`.
  - Nob has a `Kustom Choppa and Kombi-skorcha` option group; abilities are profiles typed Abilities (`Never Too Busy to Fight`, `Ammo Runts (Once per battle, per unit)`, `Tide of Muscle`) — good raw material for reminder heuristics (the "(Once per battle…)" suffix is literally in the name).
  - Detachment-conditional modifiers append weapon keywords (e.g. `SUSTAINED HITS 1` when the Mob-handed Brutality detachment is present) — the datasheet view should evaluate these so weapon tables reflect the chosen detachment.
- **Detachments:** shared entry `Detachment` (roster min 1 / max 1) with group `Detachment` of 17 options (War Horde, Da Big Hunt, Dread Mob, Green Tide, Bully Boyz, Kult of Speed, Taktikal Brigade, Ramship Raiders, Kaptin Killers, Blitz Brigade, Runt Swarm, Shoota Boyz, Wreckas, Madcap Meks, Flyboyz, Brute Bosses, Wurrband). Each option carries **categoryLinks for its Force Disposition(s)** and a `NDP Detachment` category (e.g. War Horde → `Take and Hold`, `Purge the Foe`, `3DP Detachment`). Group max is `-1` (unbounded) — the DP budget is enforced via the `Detachment Points` cost type, which Claude Code must locate in the game-system file.
- Mission cards are **not** in BSData (0 hits for any primary/secondary name).

### A.2 Wahapedia 11e Data Export (downloaded 2026-09-13; `Last_update.csv` = 2026-09-11 01:31)
- Spec workbook: `https://wahapedia.ru/wh40k11ed/Export%20Data%20Specs.xlsx` (EN + RU sheets). Files, all at `https://wahapedia.ru/wh40k11ed/<Name>.csv`: `Factions`, `Source`, `Datasheets`, `Datasheets_abilities`, `Datasheets_keywords`, `Datasheets_models`, `Datasheets_options`, `Datasheets_wargear`, `Datasheets_unit_composition`, `Datasheets_models_cost`, `Datasheets_stratagems`, `Datasheets_enhancements`, `Datasheets_detachment_abilities`, `Datasheets_leader`, `Stratagems`, `Abilities`, `Enhancements`, `Detachment_abilities`, `Detachments`, `Detachments_chapter_dp`, `Last_update`.
- Format: UTF-8 **with BOM**, `|` delimiter, every row ends with a trailing `|` (→ an extra empty column), long text fields are HTML. Sizes: Datasheets 0.86 MB, Stratagems 1.1 MB, Wargear 0.63 MB, Options 0.37 MB.
- Orks: faction id `ORK`, 67 datasheets (matches MFM's 67). Boyz = `000000016`. `Datasheets_models` has full stat lines incl. `inv_sv`, `base_size`; `Datasheets_wargear` has structured weapon profiles (`range,type,A,BS_WS,S,AP,D,description`=keywords); `Datasheets_models_cost` includes the Requisition rows (`YOUR 1ST TO 3RD UNITS COST` 10→90 / 20→180, `YOUR 4TH + UNIT COSTS` 10→100 / 20→190); `Datasheets_leader` gives leader→attached pairs (8 leaders can join Boyz); `Datasheets.csv` has `is_support`, `leader_head/footer`, `damaged_w`, `loadout` (HTML default loadout text).
- **`Datasheets_options` is prose only** ("For every 10 models in this unit, 1 Boy model can have their Shoota replaced with…") → per-model option limits come from BSData, Wahapedia is display/cross-check.
- `Detachments.csv` (`id,faction_id,name,legend,type,dp,force_disposition`) lists 17 Ork detachments but **only one Force Disposition per row** (War Horde → "Take and Hold" only; BSData and MFM both say Take and Hold + Purge the Foe). Treat this column as lossy.
- **No CORS headers** on any Wahapedia URL → proxy or file import required (see §4.2).

### A.3 Official MFM via `BSData/wh40k-11e-mfm` (git clone 2026-09-13)
- Scraper repo; data lives in `data/<faction>.yaml` (**YAML**, not JSON — bring a YAML parser) plus `data/meta.yaml`; `DATA-CHANGELOG.md` records points changes. `data/orks.yaml`: `version: 1.4`, `firstSeen: 2026-09-02`, 67 units, 15 detachments. Raw URL: `https://raw.githubusercontent.com/BSData/wh40k-11e-mfm/main/data/orks.yaml` (CORS OK).
- Unit shape: `{name, pricing:[{range:'[1,3]', label:'Your 1st To 3rd Units Cost', costs:[{models:10, points:90},{models:20, points:180}]}, {range:'[4,)', …100/190}]}` — Requisition Thresholds are explicit. Detachment shape: `{name, dp, objectives:['TAKE AND HOLD','PURGE THE FOE'], enhancements:[{name, points}]}`. Leader/Support eligibility appears in the notes text, not as structured fields — verify before relying on it; otherwise take eligibility from BSData/Wahapedia.
- Name normalisation is needed for matching: MFM title-cases ("Kult Of Speed" vs "Kult of Speed"); enhancement names carry "(Upgrade)" suffixes; curly apostrophes (’) appear.
- **Discrepancy found:** BSData and Wahapedia list 17 Ork detachments, MFM 15 (`Ramship Raiders`, `Kaptin Killers` absent from the official MFM page too — probably from the Armageddon box/campaign supplement rather than the codex). This is exactly the "unmatched record" case the Data Health screen must show rather than hide.

### A.4 Mission deck
- Full CA 2026-27 deck is on `https://wahapedia.ru/wh40k11ed/the-rules/mission-deck-2026-27/` (HTML, 459 KB, no CORS). Content verified: 5 Force Disposition cards, 25 primaries with objective actions, 6 deployments (card images at `https://wahapedia.ru/wh40k11ed/img/maps/cards/CA7_<Name>.png`), 18 secondaries with WHEN DRAWN rules and Fixed/Tactical values, 6 Twists, plus the battle sequence and the Tactical-deck rules quoted in §6.2. Not in the CSV export → parse the HTML page (through the proxy or from a saved file) into the app's mission JSON on-device.

### A.5 Consequences for the plan
1. Phase 1 parses **JSON** (BSData) + **YAML** (MFM mirror); Wahapedia CSV parsing is Phase 1b behind the proxy/file-import switch.
2. The generic constraint evaluator is confirmed as the right approach; its required vocabulary is listed in A.1.
3. The app is fully usable for list building with only the two CORS-friendly sources; Wahapedia adds richer text, images and the mission deck.
4. Cross-source checking already pays off on day one (Force Disposition column, missing detachments, name casing).
