export type BuilderIdPrefix = 'page' | 'block'

export function createBuilderId(prefix: BuilderIdPrefix) {
  return `${prefix}-${crypto.randomUUID()}`
}
