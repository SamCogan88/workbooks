import { beforeEach, describe, expect, it } from 'vitest'
import { buildResponseIdStorageKey, buildStorageKey, loadSession, saveSession } from './storage'

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

  beforeEach(() => {
    store.clear()
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

  it('keys online sessions by the published workbook row', () => {
    const firstSession = {
      responseId: 'response-123',
      pageIndex: 1,
      responses: { notes: 'First live link' },
      updatedAt: '2026-10-01T00:00:00.000Z',
    }
    const secondSession = {
      responseId: 'response-123',
      pageIndex: 2,
      responses: { notes: 'Second live link' },
      updatedAt: '2026-10-01T00:00:00.000Z',
    }

    saveSession(firstSession, 'shared-definition', 1, 'response-123', 'published-row-a')
    saveSession(secondSession, 'shared-definition', 1, 'response-123', 'published-row-b')

    expect(buildResponseIdStorageKey('shared-definition', 1, 'published-row-a')).toBe('worksheet-session-id:online:published-row-a')
    expect(buildStorageKey('shared-definition', 1, 'response-123', 'published-row-a')).toBe('worksheet-app:online:published-row-a:response-123')
    expect(loadSession('shared-definition', 1, 'response-123', 'published-row-a')).toEqual(firstSession)
    expect(loadSession('shared-definition', 1, 'response-123', 'published-row-b')).toEqual(secondSession)
  })
})
