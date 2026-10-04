import { describe, expect, it } from 'vitest'
import {
  aggregateQuadrantMean,
  aggregateRadarValues,
  getResponseLabel,
  groupResponsesByKey,
  mapCanvasPointToQuadrant,
  normaliseGroupingValue,
  resolveSynthesisConfig,
} from './aggregation'
import type { WorksheetResponse } from './types'
import { aiToolLabDefinition } from './worksheetData'

const synthesisDefinition = {
  id: 'generic-worksheet',
  version: 1,
  title: 'Generic worksheet',
  description: 'Test worksheet',
  settings: {
    navigation: 'sequential',
    allowPageJumping: false,
    autosave: true,
    showProgress: true,
    exports: { json: true, pdf: true },
  },
  synthesis: {
    groupByBlockId: 'tool-name',
    groupLabel: 'AI Tool',
    responseLabelBlockId: 'group-name',
  },
  pages: [
    {
      id: 'page-1',
      title: 'Page 1',
      blocks: [
        { id: 'group-name', type: 'shortText', label: 'Group name' },
        { id: 'tool-name', type: 'randomizer', label: 'Tool' },
        { id: 'features', type: 'checklist', label: 'Features', config: { options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }] } },
        { id: 'radar-eval', type: 'radar', label: 'Radar' },
        { id: 'quadrant-map', type: 'quadrant', label: 'Quadrant' },
      ],
    },
  ],
} as const

function createResponse(responseId: string, values: Record<string, any>, overrides: Partial<WorksheetResponse> = {}): WorksheetResponse {
  return {
    responseSchema: 'interactive-worksheet-response' as const,
    schemaVersion: 1,
    worksheetId: synthesisDefinition.id,
    worksheetVersion: 1,
    responseId,
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    responses: values,
    ...overrides,
  }
}

describe('worksheet engine core logic', () => {
  it('validates the default worksheet structure', () => {
    expect(aiToolLabDefinition.id).toBe('ai-tool-lab')
    expect(aiToolLabDefinition.version).toBe(1)
    expect(aiToolLabDefinition.pages).toHaveLength(9)
  })

  it('normalises grouping values for synthesis grouping', () => {
    expect(normaliseGroupingValue(' Diffit ')).toBe('diffit')
    expect(normaliseGroupingValue('DiFFit')).toBe('diffit')
    expect(normaliseGroupingValue('Notebook   LM')).toBe('notebook lm')
  })

  it('groups responses by synthesis key and calculates average radar values', () => {
    const responses = [
      createResponse('response-1', {
        'group-name': 'Group 1',
        'tool-name': 'Diffit',
        'radar-eval': { 'Ease of use': 8, 'Pedagogical value': 9, 'Reliability': 7, 'Creativity': 6, 'Accessibility': 8, 'Time saving': 9, 'Learner usefulness': 8, 'Educator control': 7 },
      }),
      createResponse('response-2', {
        'group-name': 'Group 2',
        'tool-name': ' diffit ',
        'radar-eval': { 'Ease of use': 6, 'Pedagogical value': 8, 'Reliability': 8, 'Creativity': 7, 'Accessibility': 7, 'Time saving': 8, 'Learner usefulness': 7, 'Educator control': 6 },
      }),
    ]

    const grouped = groupResponsesByKey(synthesisDefinition as any, responses).groups
    expect(grouped).toHaveLength(1)
    expect(grouped[0].label).toBe('Diffit')
    expect(grouped[0].responses).toHaveLength(2)

    const averages = aggregateRadarValues(responses, ['Ease of use', 'Pedagogical value', 'Reliability', 'Creativity', 'Accessibility', 'Time saving', 'Learner usefulness', 'Educator control'])
    expect(averages['Ease of use']).toBe(7)
    expect(averages['Pedagogical value']).toBe(8.5)
  })

  it('ignores non-finite and out-of-range radar values', () => {
    const responses = [
      createResponse('response-1', { 'radar-eval': { Ease: 8 } }),
      createResponse('response-2', { 'radar-eval': { Ease: 999 } }),
      createResponse('response-3', { 'radar-eval': { Ease: Number.POSITIVE_INFINITY } }),
    ]

    expect(aggregateRadarValues(responses, ['Ease'])).toEqual({ Ease: 8 })
  })

  it('excludes missing radar values from averages', () => {
    const responses = [
      createResponse('response-1', { 'radar-eval': { Ease: 8 } }),
      createResponse('response-2', {}),
      createResponse('response-3', { 'radar-eval': {} }),
    ]

    expect(aggregateRadarValues(responses, ['Ease'])).toEqual({ Ease: 8 })
  })

  it('creates separate groups for different grouping values', () => {
    const responses = [
      createResponse('response-1', { 'tool-name': 'Diffit', 'group-name': 'Group 1' }),
      createResponse('response-2', { 'tool-name': 'NotebookLM', 'group-name': 'Group 2' }),
    ]

    const grouped = groupResponsesByKey(synthesisDefinition as any, responses).groups

    expect(grouped).toHaveLength(2)
    expect(grouped.map((group) => group.label)).toEqual(['Diffit', 'NotebookLM'])
  })

  it('can regroup the same responses using another response block', () => {
    const responses = [
      createResponse('response-1', { 'tool-name': 'Aurora Crater', 'group-name': 'Team Ares' }),
      createResponse('response-2', { 'tool-name': 'Aurora Crater', 'group-name': 'Team Phobos' }),
    ]
    const byColony = groupResponsesByKey(synthesisDefinition as any, responses).groups
    const byTeamDefinition = { ...synthesisDefinition, synthesis: { ...synthesisDefinition.synthesis, groupByBlockId: 'group-name', groupLabel: 'Review team' } }
    const byTeam = groupResponsesByKey(byTeamDefinition as any, responses).groups

    expect(byColony.map((group) => group.label)).toEqual(['Aurora Crater'])
    expect(byTeam.map((group) => group.label)).toEqual(['Team Ares', 'Team Phobos'])
  })

  it('uses randomizer output as a grouping value', () => {
    const response = createResponse('response-1', { 'tool-name': 'Gamma', 'group-name': 'Group 4' })

    const grouped = groupResponsesByKey(synthesisDefinition as any, [response]).groups

    expect(grouped[0].label).toBe('Gamma')
  })

  it('places missing grouping values under Unspecified', () => {
    const response = createResponse('response-1', { 'group-name': 'Group 4' })

    const grouped = groupResponsesByKey(synthesisDefinition as any, [response]).groups

    expect(grouped[0]).toMatchObject({ label: 'Unspecified', isMissingValue: true })
  })

  it('keeps real Unspecified answers separate from missing grouping values', () => {
    const responses = [
      createResponse('response-1', { 'tool-name': 'Unspecified' }),
      createResponse('response-2', {}),
    ]

    const grouped = groupResponsesByKey(synthesisDefinition as any, responses).groups

    expect(grouped).toHaveLength(2)
    expect(grouped.filter((group) => group.label === 'Unspecified')).toHaveLength(2)
    expect(grouped.map((group) => group.isMissingValue)).toEqual([false, true])
  })

  it('groups checklist values by configured option order', () => {
    const definition = {
      ...synthesisDefinition,
      synthesis: { ...synthesisDefinition.synthesis, groupByBlockId: 'features', groupLabel: 'Features' },
    }
    const responses = [
      createResponse('response-1', { features: ['b', 'a'] }),
      createResponse('response-2', { features: ['a', 'b'] }),
    ]

    const grouped = groupResponsesByKey(definition as any, responses).groups

    expect(grouped).toHaveLength(1)
    expect(grouped[0].label).toBe('Alpha, Beta')
    expect(grouped[0].responses).toHaveLength(2)
  })

  it('falls back to a neutral group when no grouping is configured', () => {
    const definition = {
      ...synthesisDefinition,
      id: 'ungrouped-worksheet',
      synthesis: undefined,
    }

    const grouped = groupResponsesByKey(definition as any, [createResponse('response-1', { 'tool-name': 'Diffit' })]).groups

    expect(grouped).toHaveLength(1)
    expect(grouped[0].label).toBe('All responses')
  })

  it('falls back gracefully when the grouping block is invalid', () => {
    const definition = {
      ...synthesisDefinition,
      synthesis: {
        groupByBlockId: 'missing-block',
        groupLabel: 'Programme',
        responseLabelBlockId: 'group-name',
      },
    }

    const result = groupResponsesByKey(definition as any, [createResponse('response-1', { 'tool-name': 'Diffit', 'group-name': 'Group 1' })])

    expect(result.config.warning).toContain('missing-block')
    expect(result.groups[0].label).toBe('All responses')
  })

  it('uses configured response labels and does not require uniqueness', () => {
    const responseA = createResponse('response-1', { 'tool-name': 'Diffit', 'group-name': 'Group 1' })
    const responseB = createResponse('response-2', { 'tool-name': 'Diffit', 'group-name': 'Group 1' }, { group: 'Fallback group' })

    expect(getResponseLabel(responseA as any, synthesisDefinition as any)).toBe('Group 1')
    expect(getResponseLabel(responseB as any, synthesisDefinition as any)).toBe('Group 1')
    expect(responseA.responseId).toBe('response-1')
    expect(responseB.responseId).toBe('response-2')
  })

  it('falls back to useful built-in response labels when no label block is configured', () => {
    const definition = {
      ...synthesisDefinition,
      id: 'ungrouped-worksheet',
      synthesis: undefined,
    }

    expect(getResponseLabel(createResponse('response-1', {}, { group: 'Team Mars' }) as any, definition as any)).toBe('Team Mars')
    expect(getResponseLabel(createResponse('response-2', {}, { subject: 'Ada Lovelace' }) as any, definition as any)).toBe('Ada Lovelace')
  })

  it('uses the unique suffix of generated response ids for anonymous labels', () => {
    const definition = {
      ...synthesisDefinition,
      id: 'ungrouped-worksheet',
      synthesis: undefined,
    }

    expect(getResponseLabel(createResponse('response-1790990000000-a1b2c3', {}) as any, definition as any)).toBe('Response a1b2c3')
    expect(getResponseLabel(createResponse('custom-response-id', {}) as any, definition as any)).toBe('Response custom-r')
  })

  it('keeps AI Tool Lab compatibility when synthesis settings are absent', () => {
    const definition = {
      ...aiToolLabDefinition,
      synthesis: undefined,
    }
    const responses = [
      createResponse('response-1', { 'tool-name': 'Diffit' }, { worksheetId: definition.id, subject: 'Diffit' }),
      createResponse('response-2', { 'tool-name': 'diffit' }, { worksheetId: definition.id, subject: 'diffit' }),
    ]

    const result = groupResponsesByKey(definition as any, responses as any)

    expect(resolveSynthesisConfig(definition as any).groupLabel).toBe('AI Tool')
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].label).toBe('Diffit')
  })

  it('computes mean quadrant coordinates', () => {
    const responses = [
      { responses: { 'quadrant-map': { x: 80, y: 20 } } },
      { responses: { 'quadrant-map': { x: 60, y: 40 } } },
      { responses: { 'quadrant-map': { x: 999, y: Number.NaN } } },
    ] as any

    const aggregate = aggregateQuadrantMean(responses)
    expect(aggregate.x).toBe(70)
    expect(aggregate.y).toBe(30)
  })

  it('excludes missing quadrant coordinates from means', () => {
    const responses = [
      { responses: { 'quadrant-map': { x: 80, y: 20 } } },
      { responses: {} },
      { responses: { 'quadrant-map': { x: '', y: undefined } } },
    ] as any

    expect(aggregateQuadrantMean(responses)).toEqual({ x: 80, y: 20 })
  })

  it('maps a top-click to a high-risk y coordinate instead of inverting it', () => {
    expect(mapCanvasPointToQuadrant(0.5, 0.1)).toEqual({ x: 50, y: 90 })
    expect(mapCanvasPointToQuadrant(0.2, 0.9)).toEqual({ x: 20, y: 10 })
  })
})
