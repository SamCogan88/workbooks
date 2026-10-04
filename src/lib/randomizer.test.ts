import { describe, expect, it } from 'vitest'
import { normalizeRandomizerAnimationDuration, selectRandomItem, shuffleRandomizerItems } from './randomizer'

describe('randomizer helpers', () => {
  it('falls back to the default animation duration when config is not finite', () => {
    expect(normalizeRandomizerAnimationDuration('slow')).toBe(1800)
    expect(normalizeRandomizerAnimationDuration(Number.NaN)).toBe(1800)
    expect(normalizeRandomizerAnimationDuration('250')).toBe(300)
    expect(normalizeRandomizerAnimationDuration('900')).toBe(900)
  })

  it('selects by random index without sorting the list', () => {
    const items = ['A', 'B', 'C', 'D']

    expect(selectRandomItem(items, () => 0)).toBe('A')
    expect(selectRandomItem(items, () => 0.49)).toBe('B')
    expect(selectRandomItem(items, () => 0.99)).toBe('D')
    expect(items).toEqual(['A', 'B', 'C', 'D'])
  })

  it('uses Fisher-Yates shuffling without mutating the original list', () => {
    const items = ['A', 'B', 'C', 'D']
    const randomValues = [0.5, 0.1, 0.9]
    const shuffled = shuffleRandomizerItems(items, () => randomValues.shift() ?? 0)

    expect(shuffled).toEqual(['D', 'B', 'A', 'C'])
    expect(items).toEqual(['A', 'B', 'C', 'D'])
  })
})
