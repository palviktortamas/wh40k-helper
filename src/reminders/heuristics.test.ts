import { describe, expect, it } from 'vitest'
import { infer, plainText, shortText } from './heuristics'

// Invented rule text in the game's generic phase vocabulary — no real cards.

describe('reminder heuristics', () => {
  it('reads the phase from the text, and keeps what happens with it', () => {
    const r = infer('Battle Cry', 'In your Command phase, this unit can shout. If it does, add 1 to its Leadership until your next turn.')
    expect(r.trigger).toBe('command_phase')
    // Both halves: a reminder that says only when to act reminds you of nothing.
    expect(r.text).toBe(
      'In your Command phase, this unit can shout. If it does, add 1 to its Leadership until your next turn.',
    )
    expect(r.enabled).toBe(true)
    expect(r.once).toBeUndefined()
  })

  it('prefers the specific moment over the phase it happens in', () => {
    expect(infer('Counter', 'Each time an enemy unit declares a charge against this unit, it can shoot in the Charge phase.').trigger).toBe('when_charged')
    expect(infer('Shield', 'Each time this unit is selected as the target of a ranged attack, roll a D6.').trigger).toBe('when_targeted')
    expect(infer('Drop', 'When this unit arrives from Strategic Reserves, it can make a Normal move.').trigger).toBe('on_arrival_from_reserves')
    expect(infer('Spite', "In your opponent's Shooting phase, this unit can move 3\".").trigger).toBe('opponent_turn')
    expect(infer('Tally', 'At the end of your turn, count models within range.').trigger).toBe('end_of_turn')
  })

  it('tells the start of a battle round from the start of the battle', () => {
    expect(infer('Tribute', 'At the start of the battle round, gain 1CP.').trigger).toBe('start_of_round')
    expect(infer('Muster', 'At the start of the battle, place a marker.').trigger).toBe('start_of_battle')
  })

  it('tells whose turn ends', () => {
    expect(infer('Wane', "At the end of your opponent's turn, heal 1 model.").trigger).toBe('end_of_opponent_turn')
    expect(infer('Lull', 'At the end of each turn, remove the marker.').trigger).toBe('end_of_each_turn')
    expect(infer('Lull', 'Do this at the end of the turn.').trigger).toBe('end_of_each_turn')
    // A duration is still not a moment.
    expect(infer('Haste', 'This unit can advance. Lasts until the end of the turn.').trigger).not.toBe('end_of_each_turn')
  })

  it('reads the stated phase from past the first full stop', () => {
    const r = infer('Zeal', 'ALPHA model only. At the start of the Fight phase, this unit gains Lethal Hits. If it fails a Battle-shock test, it loses it.')
    expect(r.trigger).toBe('fight_phase')
    expect(infer('Lurch', 'Hardy. In your Movement phase, after this unit moves, it can take a Battle-shock test.').trigger).toBe('movement_phase')
    // Without any stated phase the battle-shock moment still means Command.
    expect(infer('Nerve', 'Each time a unit takes a Battle-shock test, add 1.').trigger).toBe('command_phase')
  })

  it('strips every mark from the plain form', () => {
    expect(plainText('^^**ALPHA^^** and ^^BETA^^ <ins>new</ins> *slant* ***Example:** x.*')).toBe('ALPHA and BETA new slant Example: x.')
  })

  it('marks once-per-battle and once-per-turn, and uses them as the trigger when there is no phase', () => {
    const once = infer('Big Shout (Once per battle)', 'Roll a D6.')
    expect(once.once).toBe('battle')
    expect(once.trigger).toBe('once_per_battle')
    expect(once.enabled).toBe(true)
    const phased = infer('Rally', 'Once per battle, in your Command phase, this unit regains a model.')
    expect(phased.once).toBe('battle')
    expect(phased.trigger).toBe('command_phase')
    expect(infer('Trick', 'Once per turn, re-roll one dice.').trigger).toBe('once_per_turn')
  })

  it('leaves passive rules off by default', () => {
    const r = infer('Thick Hide', 'This model has a 5+ invulnerable save.')
    expect(r.trigger).toBe('custom')
    expect(r.enabled).toBe(false)
  })

  it('strips HTML and cuts long text', () => {
    expect(plainText('<b>Hit</b> &amp; run<br/>fast')).toBe('Hit & run fast')
    const long = shortText(`${'word '.repeat(60)}end.`)
    expect(long.length).toBeLessThanOrEqual(140)
    expect(long.endsWith('…')).toBe(true)
  })

  it('does not mistake "once per battle round" for "once per battle"', () => {
    // The wording differs by one word and the consequence is a whole game: a
    // once-per-round ability marked once-per-battle disappears after its first
    // use and never comes back.
    const perRound = infer("Keep Goin'! (Once per battle round, per army)", 'In your Command phase, you can do the thing.')
    expect(perRound.once).toBe('turn')

    const perBattle = infer('Last Stand (Once per battle, per unit)', 'In your Command phase, you can do the thing.')
    expect(perBattle.once).toBe('battle')
  })

  it('starts an ability that fires when a model dies switched off', () => {
    // Nothing to remember: it happens on its own, and it would otherwise show
    // up every phase its text happens to name.
    const r = infer(
      'Deadly Demise 1',
      'Each time a model in this unit is destroyed, after any passengers have made their escape moves, roll one D6.',
    )
    expect(r.enabled).toBe(false)
  })

  it('leaves an ability that merely mentions destroying things switched on', () => {
    const r = infer('Big Guns', 'In your Shooting phase, each time this unit destroys an enemy unit, gain 1 CP.')
    expect(r.enabled).toBe(true)
  })

  it('keeps a passive that matters at the table', () => {
    // Nothing to *do*, but you must remember it the moment you are shot at.
    const r = infer(
      'Thick Plates',
      "Attacks that target this unit with a S greater than this unit's T have -1 to wound rolls.",
    )
    expect(r.trigger).toBe('when_targeted')
    expect(r.enabled).toBe(true)
  })

  it('drops a rule that is only about building the list', () => {
    expect(infer('Support', 'This model can be attached to the following unit: - BIG MOB - SMALL MOB').enabled).toBe(false)
    expect(
      infer('Leader', 'Before the battle, in the Muster Armies step, you can select one friendly bodyguard unit.').enabled,
    ).toBe(false)
  })

  it('drops a rule whose whole content is a keyword grant', () => {
    expect(infer('Fast Attack', 'Friendly **WARBIKERS** units have **BATTLELINE**.').enabled).toBe(false)
  })

  it('summarises a rule by the clause that says when to act', () => {
    // A rule can open with a list-building aside and carry its real content
    // below. Summarising by the first sentence showed the aside and nothing
    // else, which read as a reminder that reminds you of nothing.
    const r = infer(
      'Adrenaline',
      '- Friendly **WARBIKERS** units have **BATTLELINE**.\n- When a friendly **SPEED FREEKS** unit is selected to make an **advance/fall-back move**, that unit\'s ranged attacks have [ASSAULT] until the end of the turn.',
    )
    expect(r.text).toContain('selected to make an advance/fall-back move')
    expect(r.text).not.toContain('BATTLELINE')
    expect(r.enabled).toBe(true)
  })

  it('does not read "eligible to declare a charge" as the Charge phase', () => {
    // It describes a state the unit is left in, not a moment to act.
    const r = infer(
      'Roll On',
      'When this unit is selected to make an advance move, that move does not prevent it from being eligible to declare a charge.',
    )
    expect(r.trigger).toBe('movement_phase')
  })
})

describe('a reminder has to say what to do, not only when', () => {
  it('carries the clauses the moment governs', () => {
    // The real shape: the moment is a heading and what it does is the bullets
    // under it. Quoting the heading alone leaves the reminder saying "something
    // happens now" — which is worse than useless at the table.
    const r = infer(
      'Adrenaline',
      '- Friendly **WARBIKERS** units have **BATTLELINE**.\n' +
        '- When a friendly **SPEED FREEKS** unit is selected to make an **advance/fall-back move**:\n' +
        "    - That unit's ranged attacks have **[ASSAULT]** until the end of the turn.\n" +
        '    - That move does not prevent that unit from being **eligible to declare a charge**.',
    )
    expect(r.text).toContain('selected to make an advance/fall-back move')
    expect(r.text).toContain('[ASSAULT]')
    expect(r.text).not.toContain('BATTLELINE')
  })

  it('stops at the next moment rather than running the whole rule together', () => {
    const r = infer(
      'Two Moments',
      'In your Command phase, this unit can shout. In your Shooting phase, this unit can spit.',
    )
    expect(r.text).toContain('shout')
    expect(r.text).not.toContain('spit')
  })
})
