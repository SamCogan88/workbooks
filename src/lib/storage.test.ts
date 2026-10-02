import { describe, expect, it } from 'vitest'
import { buildStorageKey, loadSession, saveSession } from './storage'

describe('session autosave', () => {
  const store = new Map<string, string>()

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
    configurable: true,
  })

  it('writes and restores saved session data', () => {
    const key = buildStorageKey('ai-tool-lab', 1, 'response-123')
    const session = {
      responseId: 'response-123',
      pageIndex: 3,
      responses: { 'group-name': 'Group 3', 'tool-name': 'Diffit' },
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    saveSession(session, 'ai-tool-lab', 1, 'response-123')
    expect(loadSession('ai-tool-lab', 1, 'response-123')).toEqual(session)
    expect(localStorage.getItem(key)).toContain('Group 3')
  })
})
