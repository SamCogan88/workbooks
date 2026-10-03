import type { GroupedResponseSet, WorksheetDefinition, WorksheetResponse, WorksheetSynthesisSettings } from './types'

export interface ResolvedSynthesisConfig {
  groupByBlockId?: string
  groupLabel: string
  responseLabelBlockId?: string
  warning?: string
  usesFallbackGrouping: boolean
}

const DEFAULT_GROUP_LABEL = 'Response group'
const DEFAULT_UNGROUPED_LABEL = 'All responses'
const UNSPECIFIED_GROUP_LABEL = 'Unspecified'

export function normaliseGroupingValue(value: string = '') {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function getWorksheetBlocks(definition: WorksheetDefinition) {
  return definition.pages.flatMap((page) => page.blocks)
}

function hasBlock(definition: WorksheetDefinition, blockId?: string) {
  return Boolean(blockId) && getWorksheetBlocks(definition).some((block) => block.id === blockId)
}

function getConfiguredGroupLabel(settings?: WorksheetSynthesisSettings) {
  const configured = typeof settings?.groupLabel === 'string' ? settings.groupLabel.trim() : ''
  return configured || DEFAULT_GROUP_LABEL
}

function getCompatibilityGroupByBlockId(definition: WorksheetDefinition) {
  if (definition.id !== 'ai-tool-lab') return undefined
  return hasBlock(definition, 'tool-name') ? 'tool-name' : undefined
}

function getCompatibilityResponseLabelBlockId(definition: WorksheetDefinition) {
  if (definition.id !== 'ai-tool-lab') return undefined
  return hasBlock(definition, 'group-name') ? 'group-name' : undefined
}

function toDisplayGroupingValue(value: unknown): string {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => toDisplayGroupingValue(item)).filter(Boolean).join(', ')
  return ''
}

function getConfiguredGroupingValue(response: WorksheetResponse, groupByBlockId?: string) {
  if (!groupByBlockId) return ''
  return toDisplayGroupingValue(response.responses?.[groupByBlockId])
}

function getCompatibilityGroupingValue(response: WorksheetResponse, definition: WorksheetDefinition) {
  const fromResponse = getConfiguredGroupingValue(response, getCompatibilityGroupByBlockId(definition))
  if (fromResponse) return fromResponse
  return toDisplayGroupingValue(response.subject)
}

export function resolveSynthesisConfig(definition: WorksheetDefinition): ResolvedSynthesisConfig {
  const settings = definition.synthesis
  const configuredGroupByBlockId = settings?.groupByBlockId?.trim()
  const configuredResponseLabelBlockId = settings?.responseLabelBlockId?.trim()

  if (configuredGroupByBlockId) {
    if (hasBlock(definition, configuredGroupByBlockId)) {
      return {
        groupByBlockId: configuredGroupByBlockId,
        groupLabel: getConfiguredGroupLabel(settings),
        responseLabelBlockId: hasBlock(definition, configuredResponseLabelBlockId) ? configuredResponseLabelBlockId : undefined,
        warning: configuredResponseLabelBlockId && !hasBlock(definition, configuredResponseLabelBlockId)
          ? `This worksheet is configured to label responses using \`${configuredResponseLabelBlockId}\`, but that block could not be found.`
          : undefined,
        usesFallbackGrouping: false,
      }
    }

    return {
      groupLabel: getConfiguredGroupLabel(settings),
      responseLabelBlockId: hasBlock(definition, configuredResponseLabelBlockId) ? configuredResponseLabelBlockId : undefined,
      warning: `This worksheet is configured to group synthesis by \`${configuredGroupByBlockId}\`, but that block could not be found.`,
      usesFallbackGrouping: true,
    }
  }

  const compatibilityGroupByBlockId = getCompatibilityGroupByBlockId(definition)
  if (compatibilityGroupByBlockId || definition.id === 'ai-tool-lab') {
    return {
      groupByBlockId: compatibilityGroupByBlockId,
      groupLabel: 'AI Tool',
      responseLabelBlockId: getCompatibilityResponseLabelBlockId(definition),
      usesFallbackGrouping: true,
    }
  }

  return {
    groupLabel: getConfiguredGroupLabel(settings),
    responseLabelBlockId: hasBlock(definition, configuredResponseLabelBlockId) ? configuredResponseLabelBlockId : undefined,
    warning: configuredResponseLabelBlockId && !hasBlock(definition, configuredResponseLabelBlockId)
      ? `This worksheet is configured to label responses using \`${configuredResponseLabelBlockId}\`, but that block could not be found.`
      : undefined,
    usesFallbackGrouping: true,
  }
}

export function getResponseLabel(response: WorksheetResponse, definition: WorksheetDefinition) {
  const config = resolveSynthesisConfig(definition)
  const configuredLabel = getConfiguredGroupingValue(response, config.responseLabelBlockId)
  if (configuredLabel) return configuredLabel
  if (typeof response.group === 'string' && response.group.trim()) return response.group.trim()
  return response.responseId.slice(0, 8)
}

export function groupResponsesByKey(definition: WorksheetDefinition, responses: WorksheetResponse[]) {
  const config = resolveSynthesisConfig(definition)

  if (!config.groupByBlockId && definition.id !== 'ai-tool-lab') {
    return {
      config,
      groups: responses.length
        ? [{ key: 'all-responses', label: DEFAULT_UNGROUPED_LABEL, responses: [...responses] } satisfies GroupedResponseSet]
        : [],
    }
  }

  const groups = new Map<string, GroupedResponseSet>()

  for (const response of responses) {
    const rawValue = config.groupByBlockId
      ? getConfiguredGroupingValue(response, config.groupByBlockId)
      : getCompatibilityGroupingValue(response, definition)

    const displayLabel = rawValue || UNSPECIFIED_GROUP_LABEL
    const key = rawValue ? normaliseGroupingValue(rawValue) : 'unspecified'

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: displayLabel,
        responses: [],
        isMissingValue: !rawValue,
      })
    }

    groups.get(key)?.responses.push(response)
  }

  return {
    config,
    groups: Array.from(groups.values()),
  }
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

export function aggregateContinuum(responses: WorksheetResponse[], blockId: string) {
  const positions = responses
    .map((response) => Number(response.responses?.[blockId]?.position))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100)
    .sort((left, right) => left - right)
  const middle = Math.floor(positions.length / 2)
  const median = positions.length === 0 ? 0 : positions.length % 2 ? positions[middle] : (positions[middle - 1] + positions[middle]) / 2
  return { count: positions.length, mean: averageArray(positions), median, positions }
}

export function aggregateDecisionMatrix(
  responses: WorksheetResponse[],
  blockId: string,
  options: Array<{ id: string; label: string }>,
  criteria: Array<{ id: string; label: string }>,
) {
  return options.map((option) => {
    const criterionResults = criteria.map((criterion) => {
      const values = responses.map((response) => Number(response.responses?.[blockId]?.[option.id]?.[criterion.id])).filter(Number.isFinite)
      return { ...criterion, count: values.length, average: averageArray(values) }
    })
    const populated = criterionResults.filter((criterion) => criterion.count > 0)
    return { ...option, criteria: criterionResults, count: Math.max(0, ...criterionResults.map((criterion) => criterion.count)), overallMean: populated.length ? averageArray(populated.map((criterion) => criterion.average)) : 0 }
  })
}

export function buildStudentSynthesis(groupings: GroupedResponseSet[], radarBlockId = 'radar-eval', groupLabel = 'Response group') {
  if (!groupings.length) {
    return {
      headline: 'The class is ready to begin synthesising their responses.',
      summary: 'Upload a set of response files to generate a student-friendly summary of the class findings.',
      highlights: ['No responses are available yet.', 'Once students submit results, this synthesis will show the strongest patterns.'],
      recommendations: ['Review the prompts with students.', 'Discuss the most common strengths and areas for improvement.'],
      topGroup: `No ${groupLabel.toLowerCase()} yet`,
    }
  }

  const rankedGroups = groupings.map((group) => {
    const total = group.responses.reduce((sum, response) => {
      const radar = response.responses?.[radarBlockId] || {}
      const scores = Object.values(radar).filter((value) => typeof value === 'number') as number[]
      return sum + (scores.length ? scores.reduce((innerSum, score) => innerSum + Number(score), 0) / scores.length : 0)
    }, 0)
    return { label: group.label, score: group.responses.length ? total / group.responses.length : 0 }
  }).sort((left, right) => right.score - left.score)

  const topGroup = rankedGroups[0]
  return {
    headline: `${topGroup?.label || 'This response set'} stands out as the strongest overall result for the class.`,
    summary: `Across the current responses, students most often highlight the strongest patterns associated with ${topGroup?.label || 'the current grouping'}, while also identifying a few areas to improve.`,
    highlights: [
      `${topGroup?.label || 'The leading group'} has the strongest average response pattern in the class.`,
      'The class is showing a clear set of shared strengths and practical opportunities.',
      'Patterns suggest the most successful responses are the ones that are clear, evidence-based, and reflective.',
    ],
    recommendations: [
      'Ask students to compare what worked well across the strongest examples.',
      'Use the class patterns to identify one next step for improvement.',
      'Turn the strongest responses into a shared class resource or exemplar.',
    ],
    topGroup: topGroup?.label || `No ${groupLabel.toLowerCase()} yet`,
  }
}
