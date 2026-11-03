import { describe, expect, it } from 'vitest'
import { abilitiesInArmy } from './armyAbilities'
import type { Ability } from '@/data/model'

const plain: Ability = { id: 'a', name: 'Always', kind: 'datasheet', text: '' }
const granted: Ability = { id: 'b', name: 'With Some', kind: 'datasheet', text: '', onlyWith: ['Some', 'Other'] }

describe('abilities a unit has in this army', () => {
  it('keeps a rule every army has', () => {
    expect(abilitiesInArmy([plain, granted], [])).toEqual([plain])
  })

  it('keeps a detachment-granted rule when the army holds one of its detachments', () => {
    expect(abilitiesInArmy([plain, granted], ['Third', 'Other'])).toEqual([plain, granted])
  })

  it('drops it for an army without them', () => {
    expect(abilitiesInArmy([granted], ['Third'])).toEqual([])
  })
})
