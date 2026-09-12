# wh40k-helper

A private, offline-first PWA for playing **Warhammer 40,000 (11th Edition)**: an army **List Builder**
with full legality validation, and a **Play Mode** for running a game (missions, VP/CP, wound
tracking, per-ability reminders).

Personal project. Unofficial and unaffiliated with Games Workshop. Not for distribution.

## Status

Bootstrapping. See [docs/spec.md](docs/spec.md) for the full specification and the phase plan.

| Phase | Scope | State |
|---|---|---|
| 0 | Source verification | done (spec Appendix A) |
| 1 | Data layer + datasheet browser | not started |
| 2 | List Builder + validation | not started |
| 3 | Play Mode core | not started |
| 4 | Missions (CA 2026-27) | not started |
| 5 | Reminders | not started |
| 6 | Polish / second faction | not started |

## Important: no game data in this repo

Army/rules data is **never committed here**. The app downloads it on-device on first run from:

- [BSData/wh40k-11e](https://github.com/BSData/wh40k-11e) — constraints and legality (BattleScribe JSON)
- [BSData/wh40k-11e-mfm](https://github.com/BSData/wh40k-11e-mfm) — official Munitorum Field Manual points (YAML)
- [Wahapedia data export](https://wahapedia.ru/wh40k11ed/the-rules/data-export/) — rules text and the mission deck (needs a user-owned CORS proxy or manual file import)

`.gitignore` blocks the usual datafile names. A fresh clone must contain no unit names, ability
text or points values.

## Attribution

Data by the **BSData** community and **Wahapedia** ("powered by Wahapedia"); points from the
official [Munitorum Field Manual](https://mfm.warhammer-community.com/en). Warhammer 40,000 and
all associated names are © Games Workshop. This app is a private, unofficial tool.
