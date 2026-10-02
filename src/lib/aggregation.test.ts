import { describe, expect, it } from 'vitest'
import {
  aggregateQuadrantMean,
  aggregateRadarValues,
  groupResponsesByTool,
  mapCanvasPointToQuadrant,
  normaliseToolName,
} from './aggregation'
import { aiToolLabDefinition } from './worksheetData'

describe('worksheet engine core logic', () => {
  it('validates the default worksheet structure', () => {
    expect(aiToolLabDefinition.id).toBe('ai-tool-lab')
    expect(aiToolLabDefinition.version).toBe(1)
    expect(aiToolLabDefinition.pages).toHaveLength(9)
  })

  it('normalises tool names for synthesis grouping', () => {
    expect(normaliseToolName(' Diffit ')).toBe('diffit')
    expect(normaliseToolName('DiFFit')).toBe('diffit')
  })

  it('groups responses by tool and calculates average radar values', () => {
    const responses = [
      {
        group: 'Group 1',
        subject: 'Diffit',
        responses: { 'radar-eval': { 'Ease of use': 8, 'Pedagogical value': 9, 'Reliability': 7, 'Creativity': 6, 'Accessibility': 8, 'Time saving': 9, 'Learner usefulness': 8, 'Educator control': 7 } },
      },
      {
        group: 'Group 2',
        subject: 'diffit',
        responses: { 'radar-eval': { 'Ease of use': 6, 'Pedagogical value': 8, 'Reliability': 8, 'Creativity': 7, 'Accessibility': 7, 'Time saving': 8, 'Learner usefulness': 7, 'Educator control': 6 } },
      },
    ] as any

    const grouped = groupResponsesByTool(responses)
    expect(grouped).toHaveLength(1)
    expect(grouped[0].tool).toBe('Diffit')

    const averages = aggregateRadarValues(responses, ['Ease of use', 'Pedagogical value', 'Reliability', 'Creativity', 'Accessibility', 'Time saving', 'Learner usefulness', 'Educator control'])
    expect(averages['Ease of use']).toBe(7)
    expect(averages['Pedagogical value']).toBe(8.5)
  })

  it('computes mean quadrant coordinates', () => {
    const responses = [
      { responses: { 'quadrant-map': { x: 80, y: 20 } } },
      { responses: { 'quadrant-map': { x: 60, y: 40 } } },
    ] as any

    const aggregate = aggregateQuadrantMean(responses)
    expect(aggregate.x).toBe(70)
    expect(aggregate.y).toBe(30)
  })

  it('maps a top-click to a high-risk y coordinate instead of inverting it', () => {
    expect(mapCanvasPointToQuadrant(0.5, 0.1)).toEqual({ x: 50, y: 90 })
    expect(mapCanvasPointToQuadrant(0.2, 0.9)).toEqual({ x: 20, y: 10 })
  })
})
