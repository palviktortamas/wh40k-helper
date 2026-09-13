import { describe, expect, it } from 'vitest'
import { htmlToMarked, parseMarked } from './marked'
import { parsePipeCsv, parseStratagems, splitDescription } from './parseCsv'
import { appliesNow, forDetachment } from './select'

// An invented export slice in the real file's *shape*: BOM, pipes, trailing pipe, HTML text.
const CSV =
  '﻿faction_id|name|id|type|cp_cost|legend|turn|phase|detachment|detachment_id|description|\n' +
  '|RE-ROLL|1|Core Stratagem|1|Fate bends.|Either player’s turn|Any phase|||<b>WHEN:</b> Any phase.<br><br><b>TARGET:</b> One friendly unit.<br><br><b>EFFECT:</b> Re-roll.|\n' +
  '|OLD ONE|2|Core – Battle Tactic Stratagem|1||Your turn|Shooting phase|||<b>WHEN:</b> old|\n' +
  '|WALK|3|Movement Ability|||||||text|\n' +
  'ZZ|BIG PUSH|4|Test Horde Stratagem|2|Push.|Your turn|Charge phase|Test Horde|9|<b>WHEN:</b> Your Charge phase.<br><br><b>TARGET:</b> One friendly <span class="kwb">GRUNT</span> unit.<br><br><b>EFFECT:</b> +1 to <b>charge rolls</b>.<br><br><b>RESTRICTIONS:</b> Once per battle.|\n' +
  'ZZ|OTHER|5|Other Mob – Strategic Ploy Stratagem|1||Opponent’s turn|Shooting or Fight phase|Other Mob|10|<b>WHEN:</b> x|\n'

describe('Wahapedia pipe CSV', () => {
  it('drops the BOM and the trailing empty column', () => {
    const rows = parsePipeCsv(CSV)
    expect(rows).toHaveLength(5)
    expect(rows[0]!['faction_id']).toBe('')
    expect(rows[0]!['name']).toBe('RE-ROLL')
    expect(Object.keys(rows[0]!)).not.toContain('')
  })

  it('keeps the current Core set, faction stratagems, and nothing else', () => {
    const list = parseStratagems(CSV)
    expect(list.map((s) => s.name)).toEqual(['RE-ROLL', 'BIG PUSH', 'OTHER'])
    const core = list[0]!
    expect(core.core).toBe(true)
    expect(core.turn).toBe("Either player's turn")
    const push = list[1]!
    expect(push.cp).toBe(2)
    expect(push.detachment).toBe('Test Horde')
    expect(push.target).toBe('One friendly **GRUNT** unit.')
    expect(push.effect).toBe('+1 to __charge rolls__.')
    expect(push.restrictions).toBe('Once per battle.')
    expect(list[2]!.category).toBe('Strategic Ploy')
  })

  it('splits a description into its sections', () => {
    const parts = splitDescription('<b>WHEN:</b> A<br><b>TARGET:</b> B<br><b>EFFECT:</b> C')
    expect(parts).toEqual({ when: 'A', target: 'B', effect: 'C' })
  })
})

describe('marked text', () => {
  it('converts keyword spans, bold and lists', () => {
    expect(htmlToMarked('x <span class="kwb">INFANTRY</span> <b>y</b><ul><li>a</li><li>b</li></ul>')).toBe(
      'x **INFANTRY** __y__\n• a\n• b',
    )
    expect(parseMarked('a **K** b').map((p) => p.kind)).toEqual(['text', 'keyword', 'text'])
  })
})

describe('selecting stratagems for a game', () => {
  const list = parseStratagems(CSV)

  it('joins by detachment name, case- and punctuation-insensitively, plus the Core set', () => {
    expect(forDetachment(list, 'TEST HORDE').map((s) => s.name)).toEqual(['RE-ROLL', 'BIG PUSH'])
    expect(forDetachment(list, undefined).map((s) => s.name)).toEqual(['RE-ROLL'])
  })

  it('knows which phase and turn a stratagem is for', () => {
    const push = list[1]!
    expect(appliesNow(push, 'charge', 'me')).toBe(true)
    expect(appliesNow(push, 'charge', 'opponent')).toBe(false)
    expect(appliesNow(push, 'fight', 'me')).toBe(false)
    const other = list[2]!
    expect(appliesNow(other, 'shooting', 'opponent')).toBe(true)
    expect(appliesNow(other, 'fight', 'opponent')).toBe(true)
    expect(appliesNow(other, 'shooting', 'me')).toBe(false)
    expect(appliesNow(list[0]!, 'movement', 'opponent')).toBe(true)
  })
})
