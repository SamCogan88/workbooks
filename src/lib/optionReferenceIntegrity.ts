import type { WorksheetCondition, WorksheetDefinition } from './types'

type OptionRemap = Map<string, string | undefined>

function getStringOptions(options: unknown) {
  return Array.isArray(options) && options.every((option) => typeof option === 'string') ? options : []
}

function buildOptionRemap(previousOptions: string[], nextOptions: string[]) {
  const remap: OptionRemap = new Map()
  if (previousOptions.length !== nextOptions.length) {
    previousOptions.forEach((option) => {
      if (!nextOptions.includes(option)) remap.set(option, undefined)
    })
    return remap
  }

  previousOptions.forEach((option, index) => {
    const nextOption = nextOptions[index]
    if (nextOption === option) return
    remap.set(option, nextOption)
  })
  return remap
}

function remapStringValue(value: unknown, remap: OptionRemap) {
  if (typeof value !== 'string' || !remap.has(value)) return value
  return remap.get(value)
}

function remapCorrectAnswer(answer: unknown, remap: OptionRemap) {
  if (Array.isArray(answer)) {
    return answer
      .map((value) => remapStringValue(value, remap))
      .filter((value) => value !== undefined)
  }
  return remapStringValue(answer, remap) ?? ''
}

function normalizeMultipleAnswerShape(config: Record<string, any>) {
  if (config.multipleAnswers) {
    return {
      ...config,
      correctAnswer: Array.isArray(config.correctAnswer)
        ? config.correctAnswer
        : [config.correctAnswer].filter((value) => value !== undefined && value !== ''),
    }
  }
  if (Array.isArray(config.correctAnswer)) {
    return { ...config, correctAnswer: config.correctAnswer[0] ?? '' }
  }
  return config
}

function remapPairs(pairs: unknown, remap: OptionRemap) {
  if (!Array.isArray(pairs)) return pairs
  return pairs.map((pair) => {
    if (!pair || typeof pair !== 'object') return pair
    return { ...pair, answer: remapStringValue((pair as { answer?: unknown }).answer, remap) ?? '' }
  })
}

function remapCondition(condition: WorksheetCondition | undefined, sourceBlockId: string, remap: OptionRemap) {
  if (!condition || condition.blockId !== sourceBlockId) return condition
  const value = remapStringValue(condition.value, remap)
  return value === undefined ? undefined : { ...condition, value: value as WorksheetCondition['value'] }
}

export function updateBlockConfigWithOptionReferences(
  definition: WorksheetDefinition,
  blockId: string,
  partialConfig: Record<string, any>,
) {
  const sourceBlock = definition.pages.flatMap((page) => page.blocks).find((block) => block.id === blockId)
  if (!sourceBlock) return definition

  const previousConfig = sourceBlock.config || {}
  const previousOptions = getStringOptions(previousConfig.options)
  const nextConfigBase = { ...previousConfig, ...partialConfig }
  const nextOptions = getStringOptions(nextConfigBase.options)
  const optionRemap = buildOptionRemap(previousOptions, nextOptions)
  const shouldRemapOptions = optionRemap.size > 0

  return {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      condition: shouldRemapOptions ? remapCondition(page.condition, blockId, optionRemap) : page.condition,
      blocks: page.blocks.map((block) => {
        const isSourceBlock = block.id === blockId
        const config = isSourceBlock ? { ...nextConfigBase } : block.config
        const sourceConfig: Record<string, any> = isSourceBlock ? config as Record<string, any> : {}

        return {
          ...block,
          condition: shouldRemapOptions ? remapCondition(block.condition, blockId, optionRemap) : block.condition,
          config: isSourceBlock
            ? normalizeMultipleAnswerShape({
                ...sourceConfig,
                ...(shouldRemapOptions ? {
                  correctAnswer: remapCorrectAnswer(sourceConfig.correctAnswer, optionRemap),
                  pairs: remapPairs(sourceConfig.pairs, optionRemap),
                } : {}),
              })
            : config,
        }
      }),
    })),
  }
}
