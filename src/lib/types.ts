export type WorksheetNavigation = 'sequential' | 'free'
export type TimerBehavior = 'advisory' | 'auto-advance'

export interface RadarDimension {
  id: string
  label: string
  description?: string
}

export interface WorksheetBlock {
  id: string
  type: string
  title?: string
  label?: string
  description?: string
  required?: boolean
  config?: Record<string, any>
}

export interface WorksheetPage {
  id: string
  title: string
  timer?: {
    enabled: boolean
    durationSeconds: number
    behaviour: TimerBehavior
  }
  blocks: WorksheetBlock[]
}

export interface WorksheetSettings {
  navigation: WorksheetNavigation
  allowPageJumping: boolean
  autosave: boolean
  showProgress: boolean
  exports: {
    json: boolean
    pdf: boolean
  }
}

export interface WorksheetDefinition {
  id: string
  version: number
  title: string
  description: string
  settings: WorksheetSettings
  pages: WorksheetPage[]
}

export interface WorksheetResponse {
  responseSchema: 'interactive-worksheet-response'
  schemaVersion: number
  worksheetId: string
  worksheetVersion: number
  responseId: string
  createdAt: string
  updatedAt: string
  group?: string
  subject?: string
  responses: Record<string, any>
}

export interface StoredSession {
  responseId: string
  pageIndex: number
  responses: Record<string, any>
  updatedAt: string
}

export interface GroupedToolResponse {
  tool: string
  groups: WorksheetResponse[]
}
