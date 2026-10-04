import type { OnlineWorksheetRow } from './onlineRepository'

export type PublishCardState = 'hidden' | 'published' | 'unpublished' | 'error'

export function getPublishCardState(
  publishError: string,
  publishedWorkbook: OnlineWorksheetRow | null,
  publishedDefinitionJson: string | null,
  currentDefinitionJson: string,
): PublishCardState {
  if (publishedWorkbook) {
    return publishedDefinitionJson && publishedDefinitionJson !== currentDefinitionJson ? 'unpublished' : 'published'
  }
  return publishError ? 'error' : 'hidden'
}
