import { describe, expect, it } from 'vitest'
import { parseRuleTerms, termFor } from './terms'

// An invented export slice in the real file's shape: the stratagem table also
// lists the edition's move, shoot and fight types, which rules name in bold.
const CSV =
  '﻿faction_id|name|id|type|cp_cost|legend|turn|phase|detachment|detachment_id|description|\n' +
  '|HOP MOVE|1|Movement Ability||||Ability "Move"|||<div class="strGreyBg"><b>MAXIMUM DISTANCE:</b> Hop roll + 6".</div><div class="str11Line"></div><b>ELIGIBLE IF:</b> Your unit is <b>unengaged</b>.<br><b>AFTER MOVING:</b><br><ul><li>Your unit is not <b>eligible to declare a charge</b>.</li></ul>|\n' +
  '|HOP MOVE|2|Movement Ability||||Ability "Move"|||<b>ELIGIBLE IF:</b> Any unit.|\n' +
  '|CLOSE‑IN SHOOTING|3|Shooting Ability||||Ability "Shoot"|||<b>EFFECT:</b> Your unit shoots.|\n' +
  '|RE-ROLL|4|Core Stratagem|1||Either player’s turn|Any phase|||<b>WHEN:</b> Any phase.|\n'

describe('rule terms in the stratagem export', () => {
  it('keeps the move and shooting types, once each, with their text', () => {
    const terms = parseRuleTerms(CSV)
    expect(terms.map((t) => [t.name, t.kind])).toEqual([
      ['HOP MOVE', 'Move'],
      ['CLOSE-IN SHOOTING', 'Shoot'],
    ])
    const hop = terms[0]!.text
    expect(hop).toContain('__MAXIMUM DISTANCE:__ Hop roll + 6".')
    expect(hop).toContain('• Your unit is not __eligible to declare a charge__.')
  })

  it('finds a term from the words a rule writes it in', () => {
    const terms = parseRuleTerms(CSV)
    expect(termFor('hop move', terms)?.name).toBe('HOP MOVE')
    expect(termFor('Close-in  shooting', terms)?.name).toBe('CLOSE-IN SHOOTING')
    expect(termFor('unengaged', terms)).toBeUndefined()
  })
})
