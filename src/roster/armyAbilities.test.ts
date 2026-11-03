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

  describe('with a character attached', () => {
    const withHero: Ability = { id: 'c', name: 'With Hero', kind: 'datasheet', text: '', onlyWithAttached: ['Hero', 'Other Hero'] }
    const withAny: Ability = { id: 'd', name: 'With Any', kind: 'datasheet', text: '', onlyWithAttached: [] }

    it('is not judged when the caller cannot say who is attached', () => {
      expect(abilitiesInArmy([withHero, withAny], [])).toEqual([withHero, withAny])
    })

    it('drops the rule when nobody is attached', () => {
      expect(abilitiesInArmy([plain, withHero, withAny], [], [])).toEqual([plain])
    })

    it('keeps it for the named character, or for anyone when none is named', () => {
      expect(abilitiesInArmy([withHero, withAny], [], ['Hero'])).toEqual([withHero, withAny])
      expect(abilitiesInArmy([withHero, withAny], [], ['Somebody'])).toEqual([withAny])
    })
  })
})
