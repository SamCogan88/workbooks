export type WorksheetNavigation = 'sequential' | 'free'
export type TimerBehavior = 'advisory' | 'auto-advance'
export type ConditionOperator = 'equals' | 'notEquals' | 'contains' | 'notContains'

export interface WorksheetCondition {
  blockId: string
  operator: ConditionOperator
  value: string | number | boolean
}

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
  condition?: WorksheetCondition
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
  condition?: WorksheetCondition
}

export interface WorksheetSettings {
  navigation: WorksheetNavigation
  allowPageJumping: boolean
  autosave: boolean
  showProgress: boolean
  completionMessage?: string
  exports: {
    json: boolean
    pdf: boolean
  }
}

export interface WorksheetSynthesisSettings {
  groupByBlockId?: string
  groupLabel?: string
  responseLabelBlockId?: string
}

export interface WorksheetDefinition {
  id: string
  version: number
  title: string
  description: string
  settings: WorksheetSettings
  synthesis?: WorksheetSynthesisSettings
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
  createdAt?: string
  pageIndex: number
  responses: Record<string, any>
  updatedAt: string
}

export interface GroupedResponseSet {
  key: string
  label: string
  responses: WorksheetResponse[]
  isMissingValue?: boolean
}
