import { describe, expect, it } from 'vitest'
import { getResponseLabel } from './aggregation'
import { isLoadableWorksheetResponse, sanitiseWorksheetResponses } from './responseValidation'
import type { WorksheetDefinition } from './types'

const definition: WorksheetDefinition = {
  id: 'class-report',
  version: 1,
  title: 'Class report',
  description: '',
  settings: { navigation: 'sequential', allowPageJumping: false, autosave: true, showProgress: true, exports: { json: true, pdf: true } },
  pages: [
    {
      id: 'page',
      title: 'Page',
      blocks: [
        { id: 'cloud', type: 'wordCloud' },
        { id: 'hotspot', type: 'hotspot' },
        { id: 'board', type: 'board', config: { columns: [{ id: 'plus', label: 'Plus' }] } },
        { id: 'swot', type: 'swot' },
        { id: 'name', type: 'shortText' },
      ],
    },
  ],
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    responseSchema: 'interactive-worksheet-response',
    schemaVersion: 1,
    worksheetId: definition.id,
    worksheetVersion: 1,
    responseId: 'response-123456',
    createdAt: '',
    updatedAt: '',
    responses: {},
    ...overrides,
  }
}

describe('response validation', () => {
  it('rejects malformed response envelopes before reports use them', () => {
    expect(isLoadableWorksheetResponse(null, definition.id)).toBe(false)
    expect(isLoadableWorksheetResponse(response({ responseId: undefined }), definition.id)).toBe(false)
    expect(isLoadableWorksheetResponse(response({ responses: null }), definition.id)).toBe(false)
  })

  it('drops malformed block values without dropping the whole response', () => {
    const result = sanitiseWorksheetResponses(definition, [response({
      responses: {
        cloud: { bad: 'shape' },
        hotspot: { x: 1, y: 2 },
        board: { plus: { text: 'not an array' } },
        swot: { strengths: 'not an array' },
        name: 'Group A',
      },
    })])

    expect(result.rejectedResponses).toBe(0)
    expect(result.rejectedValues).toBe(4)
    expect(result.responses[0].responses).toEqual({ name: 'Group A' })
  })

  it('falls back when a legacy response has no string response id', () => {
    expect(getResponseLabel({ responses: {}, responseId: undefined } as any, definition)).toBe('Anonymous response')
  })
})
