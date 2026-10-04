import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireSupabase } from './supabase'
import { loadPublishedWorksheet } from './onlineRepository'

vi.mock('./supabase', () => ({
  requireSupabase: vi.fn(),
}))

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
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'learner-id' } } } }),
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
