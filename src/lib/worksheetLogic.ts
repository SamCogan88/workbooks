import type { WorksheetBlock, WorksheetCondition, WorksheetDefinition, WorksheetPage, WorksheetResponse, WorksheetSettings } from './types'

const NON_RESPONSE_BLOCK_TYPES = new Set(['content', 'section', 'url'])
const ID_PREFIX_BY_BLOCK_TYPE: Record<string, Record<string, string>> = {
  singleSelect: { options: 'option' },
  multipleChoice: { options: 'option' },
  quiz: { options: 'option' },
  checklist: { options: 'option' },
  ranking: { options: 'option' },
  confidence: { options: 'option' },
  verdict: { options: 'option' },
  categorize: { items: 'item' },
  matrix: { rows: 'row' },
  radar: { dimensions: 'dimension' },
  decisionMatrix: { options: 'option', criteria: 'criterion' },
}

export type LabeledConfigItem = { id: string; label: string }
export type ConditionOption = { label: string; value: string | number | boolean }

export function isResponseProducingBlock(block: WorksheetBlock) {
  if (NON_RESPONSE_BLOCK_TYPES.has(block.type)) return false
  return !(block.type === 'richText' && block.config?.mode === 'information')
}

export function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function hasMeaningfulRichTextValue(value: string) {
  return stripHtml(value).length > 0
}

export function normalizeRichTextResponse(value: string) {
  return hasMeaningfulRichTextValue(value) ? value : ''
}

export function hasMeaningfulResponseValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.some(hasMeaningfulResponseValue)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(hasMeaningfulResponseValue)
  return false
}

function comparableValue(value: string | number | boolean) {
  return String(value).trim().toLocaleLowerCase()
}

function conditionPrimitives(value: unknown): Array<string | number | boolean> {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [value]
  if (Array.isArray(value)) return value.flatMap(conditionPrimitives)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(conditionPrimitives)
  return []
}

export function getMatchingPairKey(pair: { id?: unknown; prompt?: unknown }, index: number) {
  return String(pair.id ?? `${pair.prompt}-${index}`)
}

function fallbackItemId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`
}

export function getLabeledConfigItems(items: unknown, prefix: string): LabeledConfigItem[] {
  if (!Array.isArray(items)) return []
  const used = new Set<string>()
  return items.map((item, index) => {
    const candidate = item && typeof item === 'object' ? item as { id?: unknown; label?: unknown } : undefined
    const label = candidate ? String(candidate.label ?? '') : String(item ?? '')
    let id = candidate?.id === undefined || candidate.id === null || String(candidate.id).trim() === ''
      ? fallbackItemId(prefix, index)
      : String(candidate.id)
    if (used.has(id)) id = fallbackItemId(prefix, index)
    let suffix = 2
    const base = id
    while (used.has(id)) id = `${base}-${suffix++}`
    used.add(id)
    return { id, label }
  }).filter((item) => item.label.trim().length > 0)
}

function numericConditionOptions(min: unknown, max: unknown, fallbackMin: number, fallbackMax: number): ConditionOption[] {
  const start = Number(min ?? fallbackMin)
  const end = Number(max ?? fallbackMax)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end - start > 100) return []
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const value = start + index
    return { label: String(value), value }
  })
}

export function getConditionOptions(block: WorksheetBlock): ConditionOption[] {
  if (block.type === 'trueFalse') return [{ label: 'True', value: true }, { label: 'False', value: false }]
  if (block.type === 'rating') return numericConditionOptions(block.config?.min, block.config?.max, 0, 10)
  if (block.type === 'matrix' || block.type === 'decisionMatrix') return numericConditionOptions(block.config?.min, block.config?.max, 1, 5)
  if (block.type === 'radar') return numericConditionOptions(block.config?.min, block.config?.max, 1, 10)
  if (block.type === 'continuum') return numericConditionOptions(0, 100, 0, 100)
  if (block.type === 'categorize') return getLabeledConfigItems(block.config?.categories, 'category').map((item) => ({ label: item.label, value: item.label }))
  if (block.type === 'matching') {
    const configured = Array.isArray(block.config?.options) ? block.config.options : []
    return configured.map((option: unknown) => ({ label: String(option), value: String(option) }))
  }
  const configured = getLabeledConfigItems(block.config?.options, 'option')
  return configured.map((option) => ({ label: option.label, value: option.id }))
}

export function isConditionSourceBlock(block: WorksheetBlock) {
  if (!isResponseProducingBlock(block)) return false
  return block.type !== 'hotspot'
}

function getConditionExpectedValues(condition: WorksheetCondition, sourceBlock?: WorksheetBlock) {
  const expected = conditionPrimitives(condition.value)
  if (!sourceBlock) return expected
  const normalizedConditionValue = comparableValue(condition.value)
  getConditionOptions(sourceBlock).forEach((option) => {
    if (comparableValue(option.value) === normalizedConditionValue || comparableValue(option.label) === normalizedConditionValue) {
      expected.push(option.value, option.label)
    }
  })
  return expected
}

export function reconcileRankingResponse(options: unknown, value: unknown): LabeledConfigItem[] {
  const configured = getLabeledConfigItems(options, 'option')
  if (!configured.length) return []
  const remaining = new Map(configured.map((item) => [item.id, item]))
  const ordered: LabeledConfigItem[] = []
  const storedValues = Array.isArray(value) ? value : []

  storedValues.forEach((entry) => {
    const item = configured.find((option) => remaining.has(option.id) && (entry === option.id || entry === option.label))
    if (!item) return
    ordered.push(item)
    remaining.delete(item.id)
  })

  return [...ordered, ...remaining.values()]
}

export function reconcileCategorizeResponse(block: WorksheetBlock, value: unknown) {
  const assignments = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const categories = new Set((Array.isArray(block.config?.categories) ? block.config.categories : [])
    .map((category: unknown) => typeof category === 'object' && category !== null ? String((category as { label?: unknown }).label ?? '') : String(category ?? ''))
    .filter((category) => category.trim().length > 0))

  return Object.fromEntries(getLabeledConfigItems(block.config?.items, 'item').map((item) => {
    const assigned = assignments[item.id] ?? assignments[item.label] ?? ''
    const category = String(assigned)
    return [item.id, categories.has(category) ? category : '']
  }))
}

export function reconcileWorksheetResponses(definition: WorksheetDefinition, responses: Record<string, unknown>) {
  const next = { ...responses }
  definition.pages.flatMap((page) => page.blocks).forEach((block) => {
    if (!(block.id in next)) return
    if (block.type === 'ranking') {
      next[block.id] = reconcileRankingResponse(block.config?.options, next[block.id]).map((item) => item.id)
    } else if (block.type === 'categorize') {
      next[block.id] = reconcileCategorizeResponse(block, next[block.id])
    }
  })
  return next
}

export function normalizeWorksheetDefinitionStableIds(definition: WorksheetDefinition): WorksheetDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => {
        const config = block.config || {}
        const prefixes = ID_PREFIX_BY_BLOCK_TYPE[block.type]
        if (!prefixes) return block
        const nextConfig = { ...config }
        Object.entries(prefixes).forEach(([field, prefix]) => {
          if (Array.isArray(nextConfig[field])) nextConfig[field] = getLabeledConfigItems(nextConfig[field], prefix)
        })
        return { ...block, config: nextConfig }
      }),
    })),
  }
}

export function isConditionMet(condition: WorksheetCondition | undefined, responses: Record<string, unknown>, sourceBlock?: WorksheetBlock) {
  if (!condition) return true
  const response = responses[condition.blockId]
  if (!hasMeaningfulResponseValue(response)) return false
  const expectedValues = getConditionExpectedValues(condition, sourceBlock)
  const values = conditionPrimitives(response)
  const equals = values.some((value) => expectedValues.some((expected) => comparableValue(value) === comparableValue(expected)))
  const contains = values.some((value) => expectedValues.some((expected) => {
    if (comparableValue(value) === comparableValue(expected)) return true
    return typeof value === 'string' && typeof expected === 'string' && comparableValue(value).includes(comparableValue(expected))
  }))

  switch (condition.operator) {
    case 'equals': return equals
    case 'notEquals': return !equals
    case 'contains': return contains
    case 'notContains': return !contains
    default: return false
  }
}

function findConditionSourceBlock(definition: WorksheetDefinition | undefined, condition: WorksheetCondition | undefined) {
  if (!definition || !condition) return undefined
  return definition.pages.flatMap((page) => page.blocks).find((block) => block.id === condition.blockId)
}

export function getVisibleBlocks(page: WorksheetPage, responses: Record<string, unknown>, definition?: WorksheetDefinition) {
  return page.blocks.filter((block) => isConditionMet(block.condition, responses, findConditionSourceBlock(definition, block.condition)))
}

export function getVisiblePages(definition: WorksheetDefinition, responses: Record<string, unknown>) {
  return definition.pages.filter((page) => isConditionMet(page.condition, responses, findConditionSourceBlock(definition, page.condition)))
}

export function getVisiblePagesWithBlocks(definition: WorksheetDefinition, responses: Record<string, unknown>) {
  return getVisiblePages(definition, responses).map((page) => ({
    page,
    blocks: getVisibleBlocks(page, responses, definition),
  }))
}

export function getAdjacentVisiblePageIndex(definition: WorksheetDefinition, responses: Record<string, unknown>, currentIndex: number, direction: 1 | -1) {
  const visibleIndexes = getVisiblePages(definition, responses).map((page) => definition.pages.indexOf(page))
  const position = visibleIndexes.indexOf(currentIndex)
  return position < 0 ? undefined : visibleIndexes[position + direction]
}

export function canNavigateToVisiblePage(settings: Pick<WorksheetSettings, 'navigation' | 'allowPageJumping'>, currentVisibleIndex: number, targetVisibleIndex: number) {
  if (targetVisibleIndex < 0 || currentVisibleIndex < 0) return false
  if (targetVisibleIndex <= currentVisibleIndex + 1) return true
  return settings.navigation === 'free' && Boolean(settings.allowPageJumping)
}

export function getImageDisplayConfig(block: WorksheetBlock) {
  return {
    imageFit: block.config?.imageFit === 'cover' ? 'cover' as const : 'contain' as const,
    imageSize: ['small', 'medium', 'large', 'full'].includes(block.config?.imageSize)
      ? block.config?.imageSize as 'small' | 'medium' | 'large' | 'full'
      : 'large' as const,
  }
}

export function getMatrixRows(block: WorksheetBlock) {
  return getLabeledConfigItems(block.config?.rows, 'row')
}

const WORD_CLOUD_MAX_ENTRIES = 10

function boundedNumber(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  if (value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function unsettableNumber(value: unknown) {
  if (value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function sanitizeIntegerRange(config: Record<string, any>, fallbackMin: number, fallbackMax: number) {
  const min = Math.round(boundedNumber(config.min, fallbackMin))
  const max = Math.max(min, Math.round(boundedNumber(config.max, fallbackMax)))
  return { min, max }
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value
    .filter((item) => item !== undefined && item !== null)
    .map((item) => String(item).trim())
    .filter(Boolean) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isWorksheetBlock(value: unknown): value is WorksheetBlock {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || typeof value.type !== 'string') return false
  return value.config === undefined || isRecord(value.config)
}

function isWorksheetPage(value: unknown): value is WorksheetPage {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.blocks)
    && value.blocks.every(isWorksheetBlock)
}

export function isWorksheetDefinition(value: unknown): value is WorksheetDefinition {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.version === 'number'
    && typeof value.title === 'string'
    && Array.isArray(value.pages)
    && value.pages.every(isWorksheetPage)
}

const STRING_OPTION_BLOCK_TYPES = new Set(['singleSelect', 'multipleChoice', 'quiz', 'checklist', 'ranking', 'matching', 'verdict', 'confidence'])

export function sanitizeBlockConfig(block: WorksheetBlock): WorksheetBlock {
  const config = isRecord(block.config) ? { ...block.config } : {}

  if (STRING_OPTION_BLOCK_TYPES.has(block.type)) {
    config.options = Array.isArray(config.options) ? getLabeledConfigItems(config.options, 'option') : []
  }

  if ('points' in config) {
    config.points = boundedNumber(config.points, 1, 0)
  }

  switch (block.type) {
    case 'trueFalse':
      if (typeof config.correctAnswer === 'string') {
        const normalized = config.correctAnswer.trim().toLowerCase()
        if (normalized === 'true' || normalized === 'false') {
          config.correctAnswer = normalized === 'true'
        }
      }
      break
    case 'multipleChoice':
    case 'quiz': {
      const options = getLabeledConfigItems(config.options, 'option')
      const optionValues = new Set(options.flatMap((option) => [option.id, option.label]))
      if (config.multipleAnswers) {
        config.correctAnswer = stringList(config.correctAnswer).filter((answer) => optionValues.has(answer))
      } else if (Array.isArray(config.correctAnswer)) {
        const answer = stringList(config.correctAnswer)[0] || ''
        config.correctAnswer = optionValues.has(answer) ? answer : ''
      } else if (typeof config.correctAnswer === 'string' && !optionValues.has(config.correctAnswer)) {
        config.correctAnswer = ''
      }
      break
    }
    case 'matching': {
      const options = getLabeledConfigItems(config.options, 'option')
      const optionValues = new Set(options.flatMap((option) => [option.id, option.label]))
      config.pairs = Array.isArray(config.pairs)
        ? config.pairs.filter(isRecord).map((pair, index) => ({
          ...pair,
          id: String(pair.id || `pair-${index + 1}`),
          prompt: String(pair.prompt || ''),
          answer: optionValues.has(String(pair.answer || '')) ? String(pair.answer || '') : '',
        }))
        : []
      break
    }
    case 'numeric': {
      const correctAnswer = unsettableNumber(config.correctAnswer)
      if (correctAnswer === undefined) {
        delete config.correctAnswer
      } else {
        config.correctAnswer = correctAnswer
      }
      config.tolerance = boundedNumber(config.tolerance, 0, 0)
      break
    }
    case 'wordCloud':
      config.maxEntries = Math.round(boundedNumber(config.maxEntries, 3, 1, WORD_CLOUD_MAX_ENTRIES))
      break
    case 'rating': {
      const { min, max } = sanitizeIntegerRange(config, 0, 10)
      config.min = min
      config.max = max
      config.defaultValue = Math.round(boundedNumber(config.defaultValue, Math.round((min + max) / 2), min, max))
      break
    }
    case 'matrix': {
      const { min, max } = sanitizeIntegerRange(config, 1, 5)
      config.min = min
      config.max = max
      config.defaultValue = Math.round(boundedNumber(config.defaultValue, min, min, max))
      break
    }
    case 'decisionMatrix': {
      const { min, max } = sanitizeIntegerRange(config, 1, 5)
      config.min = min
      config.max = max
      break
    }
    default:
      break
  }

  return { ...block, config }
}

export function sanitizeWorksheetDefinition(definition: WorksheetDefinition): WorksheetDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, pageIndex) => ({
      ...page,
      id: page.id || `page-${pageIndex + 1}`,
      title: page.title || `Page ${pageIndex + 1}`,
      blocks: page.blocks.map((block, blockIndex) => sanitizeBlockConfig({
        ...block,
        id: block.id || `block-${pageIndex + 1}-${blockIndex + 1}`,
        type: block.type || 'content',
      })),
    })),
  }
}

export function getRadarDimensions(block: WorksheetBlock) {
  return getLabeledConfigItems(block.config?.dimensions, 'dimension')
}

export function getNumericRange(config: Record<string, any> | undefined, fallbackMin: number, fallbackMax: number) {
  const min = Number(config?.min ?? fallbackMin)
  const max = Number(config?.max ?? fallbackMax)
  return {
    min: Number.isFinite(min) ? min : fallbackMin,
    max: Number.isFinite(max) ? max : fallbackMax,
  }
}

export function numberInRange(value: unknown, min: number, max: number) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= min && numericValue <= max ? numericValue : undefined
}

export function getWorksheetResponseImportError(definition: WorksheetDefinition, response: Partial<WorksheetResponse>) {
  if (response.worksheetId !== definition.id) return `worksheet ID must match ${definition.id}.`
  if (response.worksheetVersion !== definition.version) return `worksheet version must match ${definition.version}.`
  if (response.responseSchema !== 'interactive-worksheet-response') return 'invalid response schema.'
  return ''
}

export function getStructuredDefaultResponse(block: WorksheetBlock) {
  switch (block.type) {
    case 'rating': {
      const fallback = Math.round((Number(block.config?.min ?? 0) + Number(block.config?.max ?? 10)) / 2)
      const value = Number(block.config?.defaultValue ?? fallback)
      return Number.isFinite(value) ? value : undefined
    }
    case 'matrix': {
      const rows = getMatrixRows(block)
      if (!rows.length) return undefined
      const value = Number(block.config?.defaultValue ?? block.config?.min ?? 1)
      return Number.isFinite(value) ? Object.fromEntries(rows.map((row) => [row.id, value])) : undefined
    }
    case 'radar': {
      const dimensions = getRadarDimensions(block)
      return dimensions.length ? Object.fromEntries(dimensions.map((dimension) => [dimension.id, 5])) : undefined
    }
    default:
      return undefined
  }
}

export function isRequiredBlockSatisfied(block: WorksheetBlock, responses: Record<string, unknown>) {
  if (!block.required) return true
  const value = responses[block.id]

  switch (block.type) {
    case 'shortText':
    case 'longText':
    case 'imagePrompt':
    case 'video':
    case 'youtube':
    case 'randomizer':
    case 'shortAnswer':
    case 'fillBlank':
      return typeof value === 'string' && value.trim().length > 0
    case 'richText':
      return typeof value === 'string' && hasMeaningfulRichTextValue(value)
    case 'singleSelect':
    case 'verdict':
      return typeof value === 'string' && value.trim().length > 0
    case 'checklist':
      return Array.isArray(value) && value.some((item) => typeof item === 'string' ? item.trim().length > 0 : hasMeaningfulResponseValue(item))
    case 'ranking': {
      const options = getLabeledConfigItems(block.config?.options, 'option')
      return options.length > 0 && Array.isArray(value) && reconcileRankingResponse(options, value).length === options.length
    }
    case 'wordCloud':
    case 'hotspot':
      return Array.isArray(value) && value.some(hasMeaningfulResponseValue)
    case 'numeric':
      return value !== '' && Number.isFinite(Number(value))
    case 'confidence':
      return typeof value === 'string' && value.trim().length > 0
    case 'categorize': {
      if (!value || typeof value !== 'object') return false
      const items = getLabeledConfigItems(block.config?.items, 'item')
      const reconciled = reconcileCategorizeResponse(block, value)
      return items.length > 0 && items.every((item) => String(reconciled[item.id] ?? '').trim().length > 0)
    }
    case 'rating': {
      const { min, max } = getNumericRange(block.config, 0, 10)
      return numberInRange(value, min, max) !== undefined
    }
    case 'matrix': {
      if (!value || typeof value !== 'object') return false
      const rows = getMatrixRows(block)
      const { min, max } = getNumericRange(block.config, 1, 5)
      return rows.length > 0 && rows.every((row) => numberInRange((value as Record<string, unknown>)[row.id] ?? (value as Record<string, unknown>)[row.label], min, max) !== undefined)
    }
    case 'radar': {
      if (!value || typeof value !== 'object') return false
      const dimensions = getRadarDimensions(block)
      const { min, max } = getNumericRange(block.config, 1, 10)
      return dimensions.length > 0 && dimensions.every((dimension) => numberInRange((value as Record<string, unknown>)[dimension.id] ?? (value as Record<string, unknown>)[dimension.label], min, max) !== undefined)
    }
    case 'quadrant': {
      if (!value || typeof value !== 'object') return false
      const point = value as Record<string, unknown>
      if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return false
      return !block.config?.rationaleRequired || typeof point.rationale === 'string' && point.rationale.trim().length > 0
    }
    case 'continuum': {
      if (!value || typeof value !== 'object') return false
      const response = value as Record<string, unknown>
      const position = Number(response.position)
      if (!Number.isFinite(position) || position < 0 || position > 100) return false
      return !block.config?.rationaleRequired || typeof response.rationale === 'string' && response.rationale.trim().length > 0
    }
    case 'decisionMatrix': {
      if (!value || typeof value !== 'object') return false
      const options = getLabeledConfigItems(block.config?.options, 'option')
      const criteria = getLabeledConfigItems(block.config?.criteria, 'criterion')
      const { min, max } = getNumericRange(block.config, 1, 5)
      return options.length > 0 && criteria.length > 0 && options.every((option: { id?: unknown }) =>
        criteria.every((criterion: { id?: unknown; label?: unknown }) => {
          const optionValues = (value as Record<string, any>)[String(option.id)] ?? (value as Record<string, any>)[String((option as { label?: unknown }).label)]
          return numberInRange(optionValues?.[String(criterion.id)] ?? optionValues?.[String(criterion.label)], min, max) !== undefined
        }))
    }
    case 'board':
      return Boolean(value && typeof value === 'object' && Object.values(value as Record<string, unknown>).some((entries) => Array.isArray(entries)
        && entries.some((entry) => hasMeaningfulResponseValue((entry as Record<string, unknown>)?.text))))
    case 'swot':
      return Boolean(value && typeof value === 'object' && Object.values(value as Record<string, unknown>).some((entries) => Array.isArray(entries)
        && entries.some((entry) => hasMeaningfulResponseValue((entry as Record<string, unknown>)?.text))))
    case 'multipleChoice':
    case 'quiz':
      return Array.isArray(value)
        ? value.some((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '')
        : value !== undefined && value !== null && String(value).trim() !== ''
    case 'trueFalse':
      return typeof value === 'boolean' || value === 'True' || value === 'False'
    case 'matching': {
      if (!value || typeof value !== 'object') return false
      const pairs = Array.isArray(block.config?.pairs) ? block.config.pairs : []
      return pairs.length > 0 && pairs.every((pair: { id?: unknown; prompt?: unknown }, index: number) => {
        const pairKey = getMatchingPairKey(pair, index)
        const selected = (value as Record<string, unknown>)[pairKey]
        return typeof selected === 'string' && selected.trim().length > 0
      })
    }
    default:
      return hasMeaningfulResponseValue(value)
  }
}

export function getMissingRequiredBlocks(page: WorksheetPage, responses: Record<string, unknown>, definition?: WorksheetDefinition) {
  return getVisibleBlocks(page, responses, definition).filter((block) => isResponseProducingBlock(block) && block.required && !isRequiredBlockSatisfied(block, responses))
}

export function getMissingRequiredBlockLocations(definition: WorksheetDefinition, responses: Record<string, unknown>) {
  return getVisiblePages(definition, responses).flatMap((page) => {
    const pageIndex = definition.pages.indexOf(page)
    return getMissingRequiredBlocks(page, responses).map((block) => ({ page, pageIndex, block }))
  })
}

export function getFillBlankCorrectAnswerPatch(correctAnswer: string) {
  return { correctAnswer, answers: undefined }
}

function matchingPairs(value: unknown) {
  return Array.isArray(value)
    ? value.filter((pair): pair is { answer?: unknown } => Boolean(pair && typeof pair === 'object'))
    : []
}

export function isRequiredBlockAnswerable(block: WorksheetBlock) {
  if (!block.required || !isResponseProducingBlock(block)) return true

  const config = block.config || {}
  switch (block.type) {
    case 'singleSelect':
    case 'checklist':
    case 'ranking':
    case 'confidence':
    case 'verdict':
      return getLabeledConfigItems(config.options, 'option').length > 0
    case 'multipleChoice':
    case 'quiz': {
      const options = getLabeledConfigItems(config.options, 'option')
      const optionValues = new Set(options.flatMap((option) => [option.id, option.label]))
      const answers = Array.isArray(config.correctAnswer) ? stringList(config.correctAnswer) : stringList([config.correctAnswer])
      return options.length > 0 && answers.length > 0 && answers.every((answer) => optionValues.has(answer))
    }
    case 'matching': {
      const options = getLabeledConfigItems(config.options, 'option')
      const optionValues = new Set(options.flatMap((option) => [option.id, option.label]))
      const pairs = matchingPairs(config.pairs)
      return options.length > 0 && pairs.length > 0 && pairs.every((pair) => {
        const answer = String(pair.answer || '').trim()
        return answer.length > 0 && optionValues.has(answer)
      })
    }
    case 'radar':
      return getRadarDimensions(block).length >= 3
    case 'board':
      return Array.isArray(config.columns) && config.columns.length > 0
    case 'swot':
      return Array.isArray(config.categories) && config.categories.length > 0
    default:
      return true
  }
}

export function getUnanswerableRequiredBlocks(definition: WorksheetDefinition) {
  return definition.pages.flatMap((page) => page.blocks.filter((block) => !isRequiredBlockAnswerable(block)))
}

export function addMatchingPairConfig(config: Record<string, any>, timestamp = Date.now()) {
  const pairs = Array.isArray(config.pairs) ? config.pairs : []
  const rawOptions = Array.isArray(config.options) ? config.options : []
  const stableOptions = getLabeledConfigItems(rawOptions, 'option')
  const answerLabel = `Match ${pairs.length + 1}`
  const answerId = `option-${timestamp}`
  const usesStableOptions = rawOptions.some((option) => isRecord(option))
  return {
    ...config,
    pairs: [...pairs, { id: `pair-${timestamp}`, prompt: 'New prompt', answer: usesStableOptions ? answerId : answerLabel }],
    options: stableOptions.some((option) => option.label === answerLabel)
      ? rawOptions
      : [...rawOptions, usesStableOptions ? { id: answerId, label: answerLabel } : answerLabel],
  }
}

export function getQuizSummary(definition: WorksheetDefinition, responses: Record<string, unknown>) {
  const quizTypes = new Set(['quiz', 'multipleChoice', 'trueFalse', 'shortAnswer', 'matching', 'fillBlank', 'numeric'])
  const items = definition.pages.flatMap((page) => page.blocks)
    .filter((block) => quizTypes.has(block.type))
    .map((block) => {
      const answer = responses[block.id]
      const points = boundedNumber(block.config?.points, 1, 0)
      let isCorrect = false

      if (block.type === 'numeric') {
        const actual = Number(answer)
        const expected = Number(block.config?.correctAnswer)
        const tolerance = Math.max(0, Number(block.config?.tolerance || 0))
        isCorrect = answer !== '' && Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance
      } else if (block.type === 'trueFalse') {
        isCorrect = answer !== undefined && String(answer) === String(block.config?.correctAnswer)
      } else if (block.type === 'shortAnswer') {
        const expected = typeof block.config?.correctAnswer === 'string' ? block.config.correctAnswer.trim().toLowerCase() : ''
        const actual = typeof answer === 'string' ? answer.trim().toLowerCase() : ''
        isCorrect = actual !== '' && actual === expected
      } else if (block.type === 'matching') {
        const pairs = Array.isArray(block.config?.pairs) ? block.config.pairs : []
        const selections = answer && typeof answer === 'object' ? answer as Record<string, unknown> : {}
        isCorrect = pairs.length > 0 && pairs.every((pair: { id?: unknown; prompt?: unknown; answer?: unknown }, index: number) =>
          String(selections[getMatchingPairKey(pair, index)] ?? '').trim().toLowerCase() === String(pair.answer ?? '').trim().toLowerCase())
      } else if (block.type === 'fillBlank') {
        const acceptedAnswers = Array.isArray(block.config?.answers)
          ? block.config.answers
          : [block.config?.correctAnswer ?? block.config?.answer].filter((candidate) => typeof candidate === 'string' && candidate.trim())
        const actual = typeof answer === 'string' ? answer.trim().toLowerCase() : ''
        isCorrect = actual !== '' && acceptedAnswers.some((option: string) => String(option).trim().toLowerCase() === actual)
      } else if (block.config?.multipleAnswers) {
        const selected = Array.isArray(answer) ? answer : [answer].filter((candidate) => candidate !== undefined)
        const expected = Array.isArray(block.config?.correctAnswer) ? block.config.correctAnswer : [block.config?.correctAnswer].filter((candidate) => candidate !== undefined)
        const options = getLabeledConfigItems(block.config?.options, 'option')
        const selectedIds = selected.map((value) => options.find((option) => option.id === value || option.label === value)?.id ?? value)
        const expectedIds = expected.map((value) => options.find((option) => option.id === value || option.label === value)?.id ?? value)
        isCorrect = JSON.stringify([...selectedIds].sort()) === JSON.stringify([...expectedIds].sort())
      } else {
        const options = getLabeledConfigItems(block.config?.options, 'option')
        const selectedId = options.find((option) => option.id === answer || option.label === answer)?.id ?? answer
        const expectedId = options.find((option) => option.id === block.config?.correctAnswer || option.label === block.config?.correctAnswer)?.id ?? block.config?.correctAnswer
        isCorrect = answer !== undefined && selectedId === expectedId
      }

      return {
        blockId: block.id,
        label: block.label || block.config?.question || 'Quiz question',
        answer,
        correctAnswer: block.config?.correctAnswer,
        points,
        achievedPoints: isCorrect ? points : 0,
        isCorrect,
      }
    })

  const totalMax = items.reduce((total, item) => total + Number(item.points || 0), 0)
  const totalScore = items.reduce((total, item) => total + Number(item.achievedPoints || 0), 0)
  return { totalQuestions: items.length, totalScore, totalMax, percent: totalMax === 0 ? 0 : totalScore / totalMax * 100, items }
}

export function formatQuizPercent(percent: number) {
  return Number.isFinite(percent) ? Math.floor(percent).toFixed(0) : '0'
}

export function getDefaultPageTimer() {
  return { enabled: false, durationSeconds: 300, behaviour: 'advisory' as const }
}

export function getDefaultBlockConfig(type: string, timestamp: number): Record<string, unknown> {
  switch (type) {
    case 'singleSelect': return { options: ['Option 1', 'Option 2'] }
    case 'richText': return { placeholder: 'Write and format your response here.', mode: 'response', contentHtml: '<p>Add rich text information for students here.</p>' }
    case 'url': return { url: 'https://example.com', buttonText: 'Open link', audience: 'student' }
    case 'randomizer': return { prompt: 'Generate a random item from this list.', items: ['Item 1', 'Item 2', 'Item 3'], shuffle: true, requireFirstGeneration: false, displayStyle: 'word-flicker', animationDurationMs: 1800 }
    case 'multipleChoice': return { question: 'Which answer is correct?', options: ['Option A', 'Option B', 'Option C'], correctAnswer: 'Option A', multipleAnswers: false, showFeedback: true, points: 1, explanation: 'Explain why the correct answer is right.' }
    case 'trueFalse': return { question: 'Is this statement true?', correctAnswer: true, showFeedback: true, points: 1, explanation: 'Explain the reasoning behind the correct answer.' }
    case 'shortAnswer': return { question: 'Provide the correct term or phrase.', correctAnswer: 'answer', showFeedback: true, points: 1, explanation: 'Explain the correct answer briefly.' }
    case 'matching': return { pairs: [{ id: 'pair-1', prompt: 'Photosynthesis', answer: 'Light energy' }, { id: 'pair-2', prompt: 'Mitochondria', answer: 'Cellular respiration' }], options: ['Light energy', 'Cellular respiration', 'DNA replication'], showFeedback: true, points: 1 }
    case 'fillBlank': return { question: 'The capital of France is ______.', correctAnswer: 'Paris', showFeedback: true, points: 1, explanation: 'Paris is the capital city of France.' }
    case 'checklist': return { options: ['Option 1', 'Option 2'] }
    case 'ranking': return { options: ['Option 1', 'Option 2', 'Option 3'] }
    case 'categorize': return { items: ['Item 1', 'Item 2', 'Item 3'], categories: ['Category A', 'Category B'] }
    case 'hotspot': return { imageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80', altText: 'Image hotspot activity', allowMultiple: false }
    case 'numeric': return { correctAnswer: 10, tolerance: 0, unit: '', placeholder: 'Enter a number', showFeedback: true, points: 1 }
    case 'wordCloud': return { maxEntries: 3, placeholder: 'Add a word or short phrase' }
    case 'confidence': return { options: ['Not sure yet', 'Somewhat confident', 'Very confident'] }
    case 'verdict': return { options: ['Recommend', 'Use with caution', 'Do not recommend'] }
    case 'matrix': return { rows: ['Criteria 1', 'Criteria 2', 'Criteria 3'], min: 1, max: 5, defaultValue: 3 }
    case 'imagePrompt': return { imageUrl: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80', altText: 'Worksheet image prompt', imageFit: 'contain', imageSize: 'large' }
    case 'video':
    case 'youtube': return { videoUrl: type === 'youtube' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', altText: type === 'youtube' ? 'YouTube video prompt' : 'Video prompt' }
    case 'quiz': return { question: 'Which answer is correct?', options: ['Option A', 'Option B', 'Option C'], correctAnswer: 'Option A', showFeedback: true, points: 1, explanation: 'Explain why the correct answer is right.' }
    case 'section': return { title: 'Section heading' }
    case 'radar': return { dimensions: [{ id: `radar-dimension-${timestamp}`, label: 'Dimension 1' }, { id: `radar-dimension-${timestamp + 1}`, label: 'Dimension 2' }, { id: `radar-dimension-${timestamp + 2}`, label: 'Dimension 3' }] }
    case 'quadrant': return { xLeft: 'Left', xRight: 'Right', yBottom: 'Bottom', yTop: 'Top', rationaleRequired: true }
    case 'swot': return { categories: [{ id: 'strengths', label: 'Strengths' }, { id: 'weaknesses', label: 'Weaknesses' }, { id: 'opportunities', label: 'Opportunities' }, { id: 'threats', label: 'Threats' }] }
    case 'continuum': return { leftLabel: 'Low', rightLabel: 'High', instructions: 'Place your response on the spectrum.', rationaleRequired: false, defaultValue: 50 }
    case 'decisionMatrix': return {
      options: [{ id: `option-${timestamp}`, label: 'Option 1' }, { id: `option-${timestamp + 1}`, label: 'Option 2' }],
      criteria: [{ id: `criterion-${timestamp}`, label: 'Criterion 1' }, { id: `criterion-${timestamp + 1}`, label: 'Criterion 2' }],
      min: 1,
      max: 5,
      showTotals: true,
    }
    case 'board': return { columns: getBoardPresetColumns('blank', timestamp), allowMultipleEntries: true, maxEntriesPerColumn: 0, placeholder: 'Add an idea' }
    default: return {}
  }
}

export type BoardPreset = 'blank' | 'pmi' | 'kwl' | 'start-stop-continue' | 'pros-cons' | 'rose-bud-thorn' | 'what-so-what-now-what'

export function getBoardPresetColumns(preset: BoardPreset, timestamp = Date.now()) {
  const labels: Record<BoardPreset, string[]> = {
    blank: ['Column 1', 'Column 2', 'Column 3'],
    pmi: ['Plus', 'Minus', 'Interesting'],
    kwl: ['Know', 'Want to know', 'Learned'],
    'start-stop-continue': ['Start', 'Stop', 'Continue'],
    'pros-cons': ['Pros', 'Cons'],
    'rose-bud-thorn': ['Rose', 'Bud', 'Thorn'],
    'what-so-what-now-what': ['What?', 'So What?', 'Now What?'],
  }
  return labels[preset].map((label, index) => ({ id: `board-column-${timestamp}-${index + 1}`, label }))
}
