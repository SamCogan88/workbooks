const DEFAULT_RANDOMIZER_ANIMATION_DURATION_MS = 1800
const MIN_RANDOMIZER_ANIMATION_DURATION_MS = 300

export function normalizeRandomizerAnimationDuration(value: unknown): number {
  const duration = Number(value ?? DEFAULT_RANDOMIZER_ANIMATION_DURATION_MS)
  return Number.isFinite(duration) ? Math.max(MIN_RANDOMIZER_ANIMATION_DURATION_MS, duration) : DEFAULT_RANDOMIZER_ANIMATION_DURATION_MS
}

export function selectRandomItem<T>(items: readonly T[], random: () => number = Math.random): T | undefined {
  if (!items.length) return undefined
  const index = Math.min(items.length - 1, Math.floor(random() * items.length))
  return items[index]
}

export function shuffleRandomizerItems<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const shuffled = [...items]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(random() * (index + 1)))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }

  return shuffled
}
