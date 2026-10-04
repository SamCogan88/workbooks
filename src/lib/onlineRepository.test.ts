import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAnonymousLearnerSession, loadPublishedWorksheet, saveOnlineResponse } from './onlineRepository'
import { requireSupabase } from './supabase'
import type { WorksheetResponse } from './types'

vi.mock('./supabase', () => ({
  requireSupabase: vi.fn(),
}))

const mockClient = {
  auth: {
    getSession: vi.fn(),
    signOut: vi.fn(),
    signInAnonymously: vi.fn(),
  },
  from: vi.fn(),
}

function createSelectBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  }
  return builder
}

function createUpsertBuilder(data: unknown) {
  const builder = {
    upsert: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(async () => ({ data, error: null })),
  }
  return builder
}

const responseDocument: WorksheetResponse = {
  responseSchema: 'interactive-worksheet-response',
  schemaVersion: 1,
  worksheetId: 'worksheet-definition',
  worksheetVersion: 1,
  responseId: 'local-response',
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  responses: { answer: 'Learner answer' },
}

describe('online worksheet repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads published worksheets through the code-gated RPC', async () => {
    const workbook = {
      id: 'worksheet-id',
      owner_id: 'teacher-id',
      public_code: 'ABC12345',
      title: 'Shared workbook',
      definition: { id: 'worksheet', version: 1, title: 'Shared workbook', pages: [] },
      status: 'published',
      created_at: '2026-10-03T00:00:00.000Z',
      updated_at: '2026-10-03T00:00:00.000Z',
    }
    const single = vi.fn().mockResolvedValue({ data: workbook, error: null })
    const rpc = vi.fn().mockReturnValue({ single })
    const from = vi.fn()

    vi.mocked(requireSupabase).mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'learner-id', is_anonymous: true } } } }),
      },
      rpc,
      from,
    } as any)

    await expect(loadPublishedWorksheet(' abc12345 ')).resolves.toBe(workbook)

    expect(rpc).toHaveBeenCalledWith('get_published_worksheet_by_code', { lookup_public_code: 'ABC12345' })
    expect(single).toHaveBeenCalledTimes(1)
    expect(from).not.toHaveBeenCalled()
  })
})

describe('online response persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireSupabase).mockReturnValue(mockClient as any)
    mockClient.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'learner-1', is_anonymous: true } } },
    })
    mockClient.auth.signOut.mockResolvedValue({ error: null })
  })

  it('does not upsert over an already-submitted response', async () => {
    const submittedRow = {
      id: 'response-1',
      worksheet_id: 'online-worksheet',
      participant_id: 'learner-1',
      answers: responseDocument,
      status: 'submitted',
    }
    const selectBuilder = createSelectBuilder(submittedRow)
    mockClient.from.mockReturnValue(selectBuilder)

    await expect(saveOnlineResponse('online-worksheet', responseDocument)).resolves.toBe(submittedRow)

    expect(mockClient.from).toHaveBeenCalledTimes(1)
    expect(selectBuilder.eq).toHaveBeenCalledWith('participant_id', 'learner-1')
  })

  it('keeps draft saves as draft upserts', async () => {
    const savedDraftRow = {
      id: 'response-1',
      worksheet_id: 'online-worksheet',
      participant_id: 'learner-1',
      answers: responseDocument,
      status: 'draft',
    }
    const selectBuilder = createSelectBuilder(savedDraftRow)
    const upsertBuilder = createUpsertBuilder(savedDraftRow)
    mockClient.from.mockReturnValueOnce(selectBuilder).mockReturnValueOnce(upsertBuilder)

    await expect(saveOnlineResponse('online-worksheet', responseDocument, ' Group 1 ')).resolves.toBe(savedDraftRow)

    expect(upsertBuilder.upsert).toHaveBeenCalledWith(expect.objectContaining({
      participant_id: 'learner-1',
      participant_label: 'Group 1',
      status: 'draft',
    }), { onConflict: 'worksheet_id,participant_id' })
  })
})

describe('anonymous learner sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireSupabase).mockReturnValue(mockClient as any)
    mockClient.auth.signOut.mockResolvedValue({ error: null })
  })

  it('reuses an existing anonymous learner session', async () => {
    const session = { user: { id: 'learner-1', is_anonymous: true } }
    mockClient.auth.getSession.mockResolvedValue({ data: { session } })

    await expect(ensureAnonymousLearnerSession()).resolves.toBe(session)
    expect(mockClient.auth.signOut).not.toHaveBeenCalled()
    expect(mockClient.auth.signInAnonymously).not.toHaveBeenCalled()
  })

  it('replaces a signed-in teacher session before joining as a learner', async () => {
    const learnerSession = { user: { id: 'learner-2', is_anonymous: true } }
    mockClient.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'teacher-1', is_anonymous: false } } },
    })
    mockClient.auth.signInAnonymously.mockResolvedValue({ data: { session: learnerSession }, error: null })

    await expect(ensureAnonymousLearnerSession()).resolves.toBe(learnerSession)
    expect(mockClient.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(mockClient.auth.signInAnonymously).toHaveBeenCalledOnce()
  })
})
