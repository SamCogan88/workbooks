import type { WorksheetBlock, WorksheetDefinition, WorksheetResponse } from './types'

export interface ResponseSanitiseResult {
  responses: WorksheetResponse[]
  rejectedResponses: number
  rejectedValues: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getResponseBlocks(definition: WorksheetDefinition) {
  return definition.pages.flatMap((page) => page.blocks)
}

function isWorksheetResponseEnvelope(value: unknown, worksheetId?: string): value is WorksheetResponse {
  if (!isRecord(value)) return false
  if (value.responseSchema !== 'interactive-worksheet-response') return false
  if (typeof value.responseId !== 'string' || !value.responseId.trim()) return false
  if (typeof value.worksheetId !== 'string' || (worksheetId && value.worksheetId !== worksheetId)) return false
  return isRecord(value.responses)
}

function hasArrayEntriesById(value: unknown, ids: string[]) {
  if (!isRecord(value)) return false
  return ids.every((id) => value[id] === undefined || Array.isArray(value[id]))
}

function isBlockValueSafe(block: WorksheetBlock, value: unknown) {
  if (value === undefined || value === null || value === '') return true

  switch (block.type) {
    case 'wordCloud':
    case 'hotspot':
    case 'checklist':
    case 'ranking':
    case 'multipleChoice':
      return Array.isArray(value)
    case 'categorize':
    case 'radar':
    case 'quadrant':
    case 'continuum':
    case 'decisionMatrix':
      return isRecord(value)
    case 'board': {
      const columns = Array.isArray(block.config?.columns) ? block.config.columns : []
      return hasArrayEntriesById(value, columns.map((column: any) => String(column.id)))
    }
    case 'swot': {
      const categories = Array.isArray(block.config?.categories)
        ? block.config.categories
        : [
            { id: 'strengths' },
            { id: 'weaknesses' },
            { id: 'opportunities' },
            { id: 'threats' },
          ]
      return hasArrayEntriesById(value, categories.map((category: any) => String(category.id)))
    }
    default:
      return true
  }
}

export function isLoadableWorksheetResponse(value: unknown, worksheetId?: string): value is WorksheetResponse {
  return isWorksheetResponseEnvelope(value, worksheetId)
}

export function sanitiseWorksheetResponses(definition: WorksheetDefinition, values: unknown[]): ResponseSanitiseResult {
  const blocksById = new Map(getResponseBlocks(definition).map((block) => [block.id, block]))
  const uniqueByResponseId = new Map<string, WorksheetResponse>()
  let rejectedResponses = 0
  let rejectedValues = 0

  for (const value of values) {
    if (!isWorksheetResponseEnvelope(value, definition.id)) {
      rejectedResponses += 1
      continue
    }

    const safeResponses: Record<string, unknown> = {}
    for (const [blockId, blockValue] of Object.entries(value.responses)) {
      const block = blocksById.get(blockId)
      if (!block || isBlockValueSafe(block, blockValue)) {
        safeResponses[blockId] = blockValue
      } else {
        rejectedValues += 1
      }
    }

    uniqueByResponseId.set(value.responseId, {
      ...value,
      responseId: value.responseId.trim(),
      responses: safeResponses,
    })
  }

  return {
    responses: Array.from(uniqueByResponseId.values()),
    rejectedResponses,
    rejectedValues,
  }
}
