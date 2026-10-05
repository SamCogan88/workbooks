import type { WorksheetDefinition } from './types'

export function isResponseJsonExportEnabled(definition: WorksheetDefinition) {
  return definition.settings.exports?.json !== false
}

export function isResponsePdfExportEnabled(definition: WorksheetDefinition) {
  return definition.settings.exports?.pdf !== false
}

export function shouldAutosaveOnlineResponse(definition: WorksheetDefinition) {
  return definition.settings.autosave !== false
}
