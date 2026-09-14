# wh40k-helper — agent briefing

Private, offline-first PWA for playing Warhammer 40,000 11th Edition. One user (the owner),
never published, no backend, no accounts, no telemetry.

**Read these two files before doing anything:**

1. [docs/spec.md](docs/spec.md) — the full specification (v0.6) and the ground-truth Phase 0
   source verification in Appendix A. This is the contract; do not re-derive it.
2. [docs/PROGRESS.md](docs/PROGRESS.md) — what is built, what was learned the hard way, and what
   is next. **Update it at the end of every working session** so the next agent can continue.

**Current state (2026-09-14):** All six phases are built, plus the owner's feedback
round: role-grouped list builder with stats on every card, caps enforced in the unit editor
(evaluator `headroom`), detachment rules shown on the units they name, stat strips and a
Battle-shock step at the table, the 11e CP rule (both players gain 1 CP every Command phase), and
stratagems imported from Wahapedia's export (Dexie v8) into a per-phase panel. Since 2026-09-14 an
army may take **several detachments**, up to the Detachment Points budget the game system sets from
the battle size (never hard-coded — see the journal), and **Necrons** is a second fixture faction
the live suites run against automatically. The editor round of the same day added: attachment kinds
read from the association's own label (Leader / Support / whatever a codex invents — Necrons have
"Retainers"), units numbered per datasheet and renamable, an attach control that shows what a target
already holds plus a Detach button, an add-unit picker that stays open with running counts, a
**Reinforced** toggle that fills every model group (`roster/size.ts` — a mob is two groups, and
stopping at 19 of 20 models loses the data's bigger weapon allowance), and compulsory loadout groups
that can no longer be emptied. Everything was
walked through in headless Chrome on the real catalogue (recipe in the journal). The owner has
checked the app on the phone. The sync/proxy Worker is **deferred by the owner** ("not needed
now, maybe later") — do not push for it. Still open: a real game to tune the reminder defaults, and which factions come next. Leftovers are in the journal's "Next". `PARSER_VERSION` in `src/data/bsdata/parse.ts` must
be bumped whenever the parsed model changes — installed catalogues re-parse themselves from stored
raw text at start. Real-catalogue tests: `WH40K_FIXTURES=<dir>` with `gs.json` plus either one
faction flat (catalogue `.json`, its `.yaml`, libraries as `lib-*.json`) or a subdirectory per
faction sharing that `gs.json` — the live suites run over every faction they find, which is how a
second faction keeps catching single-codex assumptions (see `test/fixtures.ts`).

## Hard rules

- **No game data in this repo, ever.** Not unit names, ability text, points, or catalogues. The
  app downloads everything to the device at runtime. `npm run check:data` enforces this in CI —
  it matches source-format *markers*, never GW content. Scratch downloads go in the scratchpad
  directory, never in the working tree. **Two owner-approved exceptions (2026-09-13):** the
  deployed build ships the Chapter Approved mission deck and Wahapedia's stratagem export. The
  deploy workflow fetches both into `public/` (`missions-ca-2026-27.html`,
  `stratagems-wahapedia.csv` — git-ignored, exist only in a build) and the app imports them on
  first start. The files themselves are still never committed; the guard exempts exactly those
  two paths under `dist/`.
- **Nothing may be Ork-specific.** Orks are the v1 test faction; adding a faction must be a data
  install, not a code change. No faction names in code, no special-cased branches.
- **Offline-first.** The only network calls are the data updates on the Data screen and, when the
  owner has configured one, the owner's own sync endpoint on an explicit "Sync now" (spec §4.4).
  Never sync in the background.
- **PC and phone are both first-class.** Lists are built at a PC and played from the phone; keep
  the content column readable at 1280 px wide as well as at 390 px.
- **IndexedDB for all primary state** (via Dexie). `localStorage` is never used for real data.
- **Mobile-first.** Portrait ~360–430px, 44px touch targets, 16px body floor, dark by default,
  colour never the only carrier of meaning.

## Commands

```sh
npm run dev        # http://localhost:5173/wh40k-helper/
npm run dev:host   # reachable from the owner's phone on the same Wi-Fi
npm run build      # tsc -b && vite build
npm run typecheck
npm run check:data # the no-game-data guard CI also runs
```

Node 24 is pinned in `.nvmrc`. The Claude Code Bash tool starts a non-interactive shell that does
**not** read the profile, so prefix commands with `source ~/.bashrc` to get Node 24 instead of the
stale machine-wide Node 18. Every Bash call prints a red fnm banner ("We can't find the necessary
environment variables…"); it is noise. Heredocs and inline multi-line scripts fail silently in
that shell — write files with the Write/Edit tools and commit with `git commit -F <file>`.

Real-catalogue tests: `WH40K_FIXTURES=C:/path/with/gs.json npm test` (Windows-style path; the
fixtures live in the scratchpad, never in the tree). The directory holds one faction flat, or a
subdirectory per faction beside the shared `gs.json`; every faction found is run.

## Deploying

Push to `main` → GitHub Actions builds and deploys to
https://palviktortamas.github.io/wh40k-helper/ in about a minute. The service worker uses
`registerType: 'prompt'`, so the installed app shows a "new version available" toast rather than
reloading mid-game.
