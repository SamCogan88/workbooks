import migrationSql from '../../supabase/migrations/20261004026000_secure_response_updates.sql?raw'
import { describe, expect, it } from 'vitest'

describe('response security migration', () => {
  it('keeps response ownership and worksheet placement immutable', () => {
    expect(migrationSql).toContain('new.worksheet_id is distinct from old.worksheet_id')
    expect(migrationSql).toContain("raise exception 'responses.worksheet_id cannot be changed'")
    expect(migrationSql).toContain('new.participant_id is distinct from old.participant_id')
  })

  it('sets response timestamps in the database instead of trusting clients', () => {
    expect(migrationSql).toContain('new.created_at := now()')
    expect(migrationSql).toContain('new.updated_at := now()')
    expect(migrationSql).toContain('new.submitted_at := now()')
    expect(migrationSql).toContain('new.created_at is distinct from old.created_at')
  })

  it('requires draft updates to remain on a published worksheet', () => {
    expect(migrationSql).toContain('drop policy if exists "Participants can update draft responses"')
    expect(migrationSql).toContain('public.is_published_worksheet(worksheet_id)')
  })
})
