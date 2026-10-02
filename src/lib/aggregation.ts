import type { WorksheetResponse } from './types'

export function normaliseToolName(value: string = '') {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function groupResponsesByTool(responses: WorksheetResponse[]) {
  const groups = new Map<string, WorksheetResponse[]>()

  for (const response of responses) {
    const toolName = response.subject || 'Unknown'
    const key = normaliseToolName(toolName)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)?.push(response)
  }

  return Array.from(groups.entries()).map(([toolKey, items]) => ({
    tool: items[0]?.subject || toolKey,
    groups: items,
  }))
}

export function averageArray(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function aggregateRadarValues(
  responses: WorksheetResponse[],
  dimensions: string[],
  radarBlockId = 'radar-eval',
) {
  const grouped: Record<string, number[]> = {}

  dimensions.forEach((dimension) => {
    grouped[dimension] = []
  })

  responses.forEach((response) => {
    const radar = response.responses?.[radarBlockId] || {}
    dimensions.forEach((dimension) => {
      const value = Number(radar[dimension]) || 0
      grouped[dimension].push(value)
    })
  })

  return Object.fromEntries(
    Object.entries(grouped).map(([dimension, values]) => [dimension, averageArray(values)]),
  )
}

export function mapCanvasPointToQuadrant(xRatio: number, yRatio: number) {
  const x = Math.min(100, Math.max(0, Math.round(xRatio * 100)))
  const y = Math.min(100, Math.max(0, Math.round((1 - yRatio) * 100)))

  return { x, y }
}

export function aggregateQuadrantMean(responses: WorksheetResponse[], quadrantBlockId = 'quadrant-map') {
  const xValues: number[] = []
  const yValues: number[] = []

  responses.forEach((response) => {
    const point = response.responses?.[quadrantBlockId] || {}
    xValues.push(Number(point.x) || 0)
    yValues.push(Number(point.y) || 0)
  })

  return {
    x: averageArray(xValues),
    y: averageArray(yValues),
  }
}
