import { isResponseProducingBlock } from './worksheetLogic'
import type { WorksheetBlock, WorksheetCondition, WorksheetDefinition } from './types'

export function clearConditionsReferencingBlocks(definition: WorksheetDefinition, removedBlockIds: string[]) {
  const removed = new Set(removedBlockIds)
  if (removed.size === 0) return definition

  return {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      condition: clearCondition(page.condition, removed),
      blocks: page.blocks.map((block) => ({
        ...block,
        condition: clearCondition(block.condition, removed),
      })),
    })),
  }
}

export function remapBlockConditions(blocks: WorksheetBlock[], blockIdMap: Record<string, string>) {
  return blocks.map((block) => {
    const nextBlockId = block.condition ? blockIdMap[block.condition.blockId] : undefined
    return nextBlockId
      ? { ...block, condition: { ...block.condition as WorksheetCondition, blockId: nextBlockId } }
      : block
  })
}

export function getFirstConditionOrderViolation(definition: WorksheetDefinition) {
  const previousResponseBlocks: string[] = []

  for (const page of definition.pages) {
    if (page.condition && !previousResponseBlocks.includes(page.condition.blockId)) {
      return {
        kind: 'page' as const,
        ownerId: page.id,
        sourceBlockId: page.condition.blockId,
      }
    }

    const pagePreviousResponseBlocks = [...previousResponseBlocks]
    for (const block of page.blocks) {
      if (block.condition && !pagePreviousResponseBlocks.includes(block.condition.blockId)) {
        return {
          kind: 'block' as const,
          ownerId: block.id,
          sourceBlockId: block.condition.blockId,
        }
      }
      if (isResponseProducingBlock(block)) pagePreviousResponseBlocks.push(block.id)
    }

    previousResponseBlocks.push(...page.blocks.filter(isResponseProducingBlock).map((block) => block.id))
  }

  return undefined
}

function clearCondition(condition: WorksheetCondition | undefined, removed: Set<string>) {
  return condition && removed.has(condition.blockId) ? undefined : condition
}
