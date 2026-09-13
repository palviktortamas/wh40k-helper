# Manual test checklist

For the owner, on the phone and at the PC. Everything below was exercised in headless Chrome on
2026-09-13; this is what a human should confirm. Tick as you go; note anything odd in the
journal's "Next".

Live app: https://palviktortamas.github.io/wh40k-helper/ — the installed PWA shows a "new version
available" toast on open; tap Reload first.

## 1. Data

- [ ] Data → **Check for factions** lists the catalogues; **Install** your faction. Card shows
      datasheets, detachments, revision, and "sources agree" or a discrepancy count.
- [ ] **Browse datasheets** and open one: stats, weapons, abilities, pricing bands look right.
- [ ] Turn Wi-Fi/data off: the app still opens, the faction is still there. (Offline-first.)
- [ ] **Mission deck → Import saved page**: on the PC, open the Wahapedia mission-deck page, save it
      as HTML, import the file. Expect "Imported 25 primary, 18 secondary missions".
- [ ] **Browse cards**: Primary tab grouped by disposition, Secondary tab shows 4 "Fixed-eligible"
      chips, Deployment tab shows the six maps, Dispositions tab shows the 5×5 pairing table.
- [ ] **Edit** on a card: change the name, a VP value and add a note → **Save card** → the card
      shows the change, the header says "Edited locally", and it survives a reload. The Data screen's
      deck line says "edited locally … importing again replaces the edits".

## 2. Rosters (list builder)

- [ ] **New roster** with a name and a points limit → editor opens with "✕ errors" (expected:
      no detachment, no Warlord, no Force Disposition, no Character).
- [ ] **Detachment** select lists every detachment with its DP; picking one changes the DP shown.
- [ ] **Army configuration**: pick a Force Disposition; the toggles (Legends etc.) are checkboxes
      and default off. Changing the **Limit** keeps the battle size in step (no "pts at most 0").
- [ ] **Add unit** → search → pick. Tap the unit → editor. Build the spec §9 20-model unit with the
      steppers (16 + 2 special + 2 leader models). Unit shows **180 pts** and no errors.
- [ ] Add a **third** special-weapon model → a specific error names the cap. Remove it.
- [ ] Add a Character; **Warlord** button appears only on Characters; tapping it sets the chip and
      clears the Warlord errors. Tap again to unset.
- [ ] **Attach to**: the Character's select lists only units it may lead; attach it. The unit card
      reads "Led by …", the leader reads "Leads …".
- [ ] Open the Character's editor: an **Enhancements** group is offered only for the chosen
      detachment; take one → points rise, "1 enhancement" appears; take a second → error.
- [ ] Badge turns **✓ Legal**. Add a 4th copy of a datasheet capped at 3 → error names it.
      Add units past the points limit → "at most N pts in the army".
- [ ] **Export text** → clipboard text lists units, per-model loadouts, leader nested under its
      unit, enhancement, [WARLORD], evaluated unit costs.
- [ ] Rosters list: **Duplicate** (leader attachment survives), **Delete** asks for confirmation.
- [ ] **Old roster** (created before today): opens without errors about battle size, the old
      detachment and Warlord are carried over.

## 3. PC ↔ phone

- [ ] PC: **Share** on a roster card → "Roster JSON copied". Paste into a chat to yourself.
- [ ] Phone: Rosters → **Import** → paste → the roster appears as "Name (2)" if the name exists,
      validates green (faction installed) or asks you to install the faction.
- [ ] Phone: **Share** opens the share sheet (touch device); PC copies to the clipboard.
- [ ] After deploying the Worker (`worker/README.md`): Settings → Sync on both devices, **Sync now**
      on the PC then on the phone → rosters appear on both; delete one on the phone, sync both →
      it disappears on the PC.
- [ ] With the Worker: Data → Mission deck → **Fetch/Refresh through my endpoint** imports the deck.
- [ ] Desktop browser at full width: content in a centred column, tab bar aligned under it, nothing
      stretched edge to edge.

## 4. Play

- [ ] Play → **New game**: roster select shows legality; an illegal list asks before starting.
- [ ] **Mission setup**: your disposition prefilled from the roster; pick the opponent's → both
      primaries derived. **Draw** deployment, **Roll D6** central objectives, **Roll off** attacker,
      choose Tactical. Try Fixed: two fixed-eligible picks, no duplicates.
- [ ] Game screen: round 1, your Command phase, you have 1 CP. **Next** walks
      Command → Movement → Shooting → Charge → Fight → opponent's turn (they gain 1 CP) → round 2.
      **Prev** goes back and takes the CP back. Screen does not dim while the game is open.
- [ ] CP / Primary / Secondary steppers for both players; totals update; never below zero.
- [ ] **Mission panel**: only the primary's blocks for this round are active; tap a "+N VP" line →
      Primary VP rises, "−" undoes. **Draw 2** → two secondaries appear with deck count 16.
      Tap a scoring line → Secondary VP. **Achieved — discard** removes the card.
      **Discard (+1 CP)** gives CP once per turn. **Discard & redraw (1 CP, once)** disappears after
      use. Score past 15 in a round → capped, log says so.
- [ ] **Card trackers**: under the primary and each active secondary, a **− N +** counter and a
      note field. + twice, type a note, **Undo** → the counter goes back, the note stays.
      Both survive a reload.
- [ ] Army: unit cards show models alive / total, current model's wounds for multi-wound models,
      leaders nested inside their unit.
- [ ] **−1 model** on a single-type unit removes one; on a mixed unit the quick button is
      **−1 <plain model>** (largest group first, the sergeant last) and **Remove models…** lists each
      model type with −1 / +1 (and −1 W / +1 W for multi-wound). Remove one special-weapon model.
- [ ] Toggle **Reserves** or **Deep Strike** on a unit → an **Arrive** button appears; tapping it
      clears the status and logs "arrives from …".
- [ ] Tap the unit name → datasheet: the weapons table counts follow the survivors (one fewer of
      that weapon); "Other profiles" folds away wargear nobody carries; abilities with "once per
      battle" have a **used** checkbox that strikes them through.
- [ ] Damage a multi-wound model to 0 → model removed, no carry-over; last model → unit
      "✕ Destroyed", **Revive** restores it.
- [ ] Statuses under **More…**: Battle-shocked etc. toggle; Advanced / Fell back clear at end of turn.
- [ ] Transport: **Embark a unit** select on a transport, the unit moves inside it with an
      "Embarked" label; **Disembark**; destroy the transport → passengers spill out (log line).
- [ ] **Reminders** panel (between the tools and the Mission): in your Command phase it lists
      Command-phase and once-per-battle rules grouped by Army / detachment / unit; **Next** into
      Movement swaps the list (army-wide rules, arrival-from-Reserves rules). Tick one → strikes
      through, log says "done"; tick a **once per battle** one → chip says "used" and the same
      ability is ticked on the unit's datasheet. **Silence** hides the list, **Unmute** restores.
      On the opponent's Charge phase, "when charged" rules appear.
- [ ] **Undo** reverts the last action, repeatedly. **Log** lists everything newest first.
- [ ] **End game** → summary with result, VP by round, units lost; **Reopen game** undoes it.
      History on the Play tab shows Won/Lost/Draw; Delete asks first.

## 5. Settings

- [ ] Theme switch: dark / light / system, persists after reload.
- [ ] **Set up reminders**: groups for Army rules, each detachment, Enhancements and every unit;
      search narrows them. Turn a passive rule on, change its "when" and text → "edited" chip,
      **Reset to default** appears; both survive a reload and show up in the next game.
      The master checkbox silences reminders in games.
- [ ] After this update the app re-parses installed factions once at start (no download): the
      datasheet view of a unit shows only its own abilities, not hundreds of Crusade upgrades.
- [ ] Sync section: saving URL + passphrase persists; a wrong URL gives a readable error.
- [ ] About shows version and build commit.
