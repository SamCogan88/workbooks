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
  return typeof response.responseId === 'string' && response.responseId.trim() ? response.responseId.slice(0, 8) : 'Anonymous response'
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

export function buildStudentSynthesis(groupings: GroupedResponseSet[], radarBlockId = 'radar-eval', groupLabel = 'Response group', definition?: WorksheetDefinition) {
  if (!groupings.length) {
    return {
      headline: 'No responses are available yet',
      summary: 'Import or collect submitted responses to create a class overview.',
      highlights: [],
      recommendations: [],
      topGroup: '',
    }
  }

  const allResponses = groupings.flatMap((group) => group.responses)
  const totalResponses = allResponses.length
  const highlights: string[] = []

  if (groupings.length > 1) {
    const largest = [...groupings].sort((left, right) => right.responses.length - left.responses.length)[0]
    highlights.push(`${largest.label} contains the most responses: ${largest.responses.length} of ${totalResponses}.`)
  }

  const radarValues = new Map<string, number[]>()
  allResponses.forEach((response) => {
    const radar = response.responses?.[radarBlockId]
    if (!radar || typeof radar !== 'object') return
    Object.entries(radar).forEach(([dimension, rawValue]) => {
      const value = Number(rawValue)
      if (!Number.isFinite(value)) return
      radarValues.set(dimension, [...(radarValues.get(dimension) || []), value])
    })
  })
  const strongestRadar = Array.from(radarValues.entries())
    .map(([dimension, values]) => ({ dimension, count: values.length, average: averageArray(values) }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.average - left.average)[0]
  if (strongestRadar) highlights.push(`${strongestRadar.dimension} has the highest recorded radar average: ${strongestRadar.average.toFixed(1)} across ${strongestRadar.count} response${strongestRadar.count === 1 ? '' : 's'}.`)

  const choiceBlock = definition?.pages.flatMap((page) => page.blocks).find((block) => ['verdict', 'singleSelect', 'multipleChoice', 'trueFalse', 'confidence'].includes(block.type))
  if (choiceBlock) {
    const counts = new Map<string, number>()
    allResponses.forEach((response) => {
      const rawValue = response.responses?.[choiceBlock.id]
      const values = Array.isArray(rawValue) ? rawValue : [rawValue]
      values.filter((value) => value !== undefined && value !== null && String(value).trim()).forEach((value) => {
        const label = String(value)
        counts.set(label, (counts.get(label) || 0) + 1)
      })
    })
    const mostCommon = Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]
    if (mostCommon && mostCommon[1] > 1) {
      highlights.push(`For “${choiceBlock.label || choiceBlock.config?.question || 'the choice question'}”, the most common response is “${mostCommon[0]}” (${mostCommon[1]} selections).`)
    }
  }

  const groupSummary = groupings.length === 1
    ? `This view contains ${totalResponses} submitted response${totalResponses === 1 ? '' : 's'}.`
    : `This view contains ${totalResponses} submitted responses across ${groupings.length} ${groupLabel.toLowerCase()}s.`
  return {
    headline: 'Class response overview',
    summary: `${groupSummary} Expand the worksheet sections below to examine response distributions, written contributions, and aggregate scores.`,
    highlights,
    recommendations: [],
    topGroup: '',
  }
}
