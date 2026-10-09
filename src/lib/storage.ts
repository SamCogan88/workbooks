import type { StoredSession, WorksheetResponse } from './types'

const STORAGE_PREFIX = 'worksheet-app' 

export function buildStorageKey(worksheetId: string, worksheetVersion: number, responseId: string) {
  return `${STORAGE_PREFIX}:${worksheetId}:${worksheetVersion}:${responseId}`
}

export function saveSession(session: StoredSession, worksheetId: string, worksheetVersion: number, responseId: string) {
  try {
    localStorage.setItem(buildStorageKey(worksheetId, worksheetVersion, responseId), JSON.stringify(session))
  } catch (error) {
    console.error('Autosave failed', error)
  }
}

export function loadSession(worksheetId: string, worksheetVersion: number, responseId: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(buildStorageKey(worksheetId, worksheetVersion, responseId))
    if (!raw) return null
    return JSON.parse(raw) as StoredSession
  } catch (error) {
    console.error('Could not restore session', error)
    return null
  }
}

export function exportResponseJson(response: WorksheetResponse) {
  const json = JSON.stringify(response, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${(response.subject || 'worksheet').trim().toLowerCase().replace(/\s+/g, '-') || 'worksheet'}-${(response.group || 'group').trim().toLowerCase().replace(/\s+/g, '-') || 'response'}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function getDefaultResponseId() {
  return `response-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}
