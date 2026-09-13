# wh40k-helper — agent briefing

Private, offline-first PWA for playing Warhammer 40,000 11th Edition. One user (the owner),
never published, no backend, no accounts, no telemetry.

**Read these two files before doing anything:**

1. [docs/spec.md](docs/spec.md) — the full specification (v0.5) and the ground-truth Phase 0
   source verification in Appendix A. This is the contract; do not re-derive it.
2. [docs/PROGRESS.md](docs/PROGRESS.md) — what is built, what was learned the hard way, and what
   is next. **Update it at the end of every working session** so the next agent can continue.

**Current state (2026-09-13):** Phases 1 and 2 are built and deployed, but a review found bugs in
the constraint evaluator that produce false "Legal" badges. Phase 3 is blocked behind fixing them.
Start at "Next → Step 1" in the progress journal, and write the failing regression test before
touching the evaluator.

## Hard rules

- **No game data in this repo, ever.** Not unit names, ability text, points, or catalogues. The
  app downloads everything to the device at runtime. `npm run check:data` enforces this in CI —
  it matches source-format *markers*, never GW content. Scratch downloads go in the scratchpad
  directory, never in the working tree.
- **Nothing may be Ork-specific.** Orks are the v1 test faction; adding a faction must be a data
  install, not a code change. No faction names in code, no special-cased branches.
- **Offline-first.** The only network calls are the data updates on the Data screen.
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
stale machine-wide Node 18.

## Deploying

Push to `main` → GitHub Actions builds and deploys to
https://palviktortamas.github.io/wh40k-helper/ in about a minute. The service worker uses
`registerType: 'prompt'`, so the installed app shows a "new version available" toast rather than
reloading mid-game.
