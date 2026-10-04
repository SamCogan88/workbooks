import type { WorksheetDefinition, WorksheetResponse } from './types'
import { requireSupabase } from './supabase'

export type OnlineWorksheetStatus = 'draft' | 'published' | 'archived'
export type OnlineResponseStatus = 'draft' | 'submitted'

export interface OnlineWorksheetRow {
  id: string
  owner_id: string
  public_code: string
  title: string
  definition: WorksheetDefinition
  status: OnlineWorksheetStatus
  created_at: string
  updated_at: string
}

export interface OnlineResponseRow {
  id: string
  worksheet_id: string
  participant_id: string
  participant_label: string | null
  answers: WorksheetResponse
  status: OnlineResponseStatus
  created_at: string
  updated_at: string
  submitted_at: string | null
}

const SUBMITTED_RESPONSES_PAGE_SIZE = 1000

function createPublicCode(length = 8) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('')
}

export async function ensureAnonymousLearnerSession() {
  const client = requireSupabase()
  const { data: sessionData } = await client.auth.getSession()
  if (sessionData.session?.user.is_anonymous) return sessionData.session

  if (sessionData.session) {
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw error
  }

  const { data, error } = await client.auth.signInAnonymously()
  if (error) throw error
  if (!data.session) throw new Error('Supabase did not create an anonymous learner session.')
  return data.session
}

export async function publishWorksheet(definition: WorksheetDefinition) {
  const client = requireSupabase()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) throw userError
  if (!userData.user || userData.user.is_anonymous) throw new Error('A permanent teacher account is required to publish worksheets.')

  const now = new Date().toISOString()
  const { data, error } = await client
    .from('worksheets')
    .insert({
      owner_id: userData.user.id,
      public_code: createPublicCode(),
      title: definition.title,
      definition,
      status: 'published',
      updated_at: now,
    })
    .select()
    .single<OnlineWorksheetRow>()

  if (error) throw error
  return data
}

export async function listOwnedWorksheets() {
  const client = requireSupabase()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) throw userError
  if (!userData.user || userData.user.is_anonymous) throw new Error('A permanent teacher account is required.')
  const { data, error } = await client
    .from('worksheets')
    .select('*')
    .eq('owner_id', userData.user.id)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data as OnlineWorksheetRow[]
}

export async function loadOwnedWorksheet(worksheetId: string) {
  const client = requireSupabase()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) throw userError
  if (!userData.user || userData.user.is_anonymous) throw new Error('A permanent teacher account is required.')
  const { data, error } = await client
    .from('worksheets')
    .select('*')
    .eq('id', worksheetId)
    .eq('owner_id', userData.user.id)
    .single<OnlineWorksheetRow>()

  if (error) throw error
  return data
}

export async function listSubmittedResponseRows(worksheetId: string) {
  const client = requireSupabase()
  const rows: OnlineResponseRow[] = []

  for (let offset = 0; ; offset += SUBMITTED_RESPONSES_PAGE_SIZE) {
    const { data, error } = await client
      .from('responses')
      .select('*')
      .eq('worksheet_id', worksheetId)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false })
      .range(offset, offset + SUBMITTED_RESPONSES_PAGE_SIZE - 1)

    if (error) throw error

    const page = (data || []) as OnlineResponseRow[]
    rows.push(...page)

    if (page.length < SUBMITTED_RESPONSES_PAGE_SIZE) break
  }

  return uniqueSubmittedResponseRows(rows)
}

export function uniqueSubmittedResponseRows(rows: OnlineResponseRow[]) {
  const rowsByResponseId = new Map<string, OnlineResponseRow>()
  rows.forEach((row) => {
    const responseId = row.answers.responseId || row.id
    if (!rowsByResponseId.has(responseId)) {
      rowsByResponseId.set(responseId, row)
    }
  })
  return Array.from(rowsByResponseId.values())
}

export async function loadPublishedWorksheet(publicCode: string) {
  const client = requireSupabase()
  await ensureAnonymousLearnerSession()
  const { data, error } = await client
    .rpc('get_published_worksheet_by_code', { lookup_public_code: publicCode.trim().toUpperCase() })
    .single<OnlineWorksheetRow>()

  if (error) throw error
  return data
}

async function loadParticipantResponseForSession(worksheetId: string, participantId: string) {
  const client = requireSupabase()
  const { data, error } = await client
    .from('responses')
    .select('*')
    .eq('worksheet_id', worksheetId)
    .eq('participant_id', participantId)
    .maybeSingle<OnlineResponseRow>()

  if (error) throw error
  return data
}

export async function loadParticipantResponse(worksheetId: string) {
  const session = await ensureAnonymousLearnerSession()
  return loadParticipantResponseForSession(worksheetId, session.user.id)
}

export async function saveOnlineResponse(worksheetId: string, response: WorksheetResponse, participantLabel?: string) {
  const client = requireSupabase()
  const session = await ensureAnonymousLearnerSession()
  const existingResponse = await loadParticipantResponseForSession(worksheetId, session.user.id)
  if (existingResponse?.status === 'submitted') return existingResponse

  const { data, error } = await client
    .from('responses')
    .upsert({
      worksheet_id: worksheetId,
      participant_id: session.user.id,
      participant_label: participantLabel?.trim() || null,
      answers: response,
      status: 'draft',
    }, { onConflict: 'worksheet_id,participant_id' })
    .select()
    .single<OnlineResponseRow>()

  if (error) throw error
  return data
}

export async function submitOnlineResponse(responseId: string) {
  const client = requireSupabase()
  const { data, error } = await client
    .from('responses')
    .update({ status: 'submitted' })
    .eq('id', responseId)
    .select()
    .single<OnlineResponseRow>()

  if (error) throw error
  return data
}

export async function listSubmittedResponses(worksheetId: string): Promise<unknown[]> {
  const rows = await listSubmittedResponseRows(worksheetId)
  return rows.slice().reverse().map((row) => row.answers)
}
