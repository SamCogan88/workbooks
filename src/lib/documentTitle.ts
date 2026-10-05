const APP_TITLE = 'Workbooks'

function normalizeTitlePart(value?: string) {
  const normalized = value?.trim()
  return normalized || undefined
}

export function formatDocumentTitle(pageTitle?: string) {
  const title = normalizeTitlePart(pageTitle)
  return title ? `${title} – ${APP_TITLE}` : APP_TITLE
}

export function getRouteDocumentTitle(pathname: string, worksheetTitle?: string) {
  if (pathname === '/') return formatDocumentTitle()
  if (pathname === '/builder') return formatDocumentTitle('Worksheet Builder')
  if (pathname === '/system-guide') return formatDocumentTitle('System Guide')
  if (pathname === '/account') return formatDocumentTitle('Teacher Account')
  if (pathname === '/teacher') return formatDocumentTitle('My Workbooks')
  if (pathname === '/preview') return formatDocumentTitle(`Preview ${normalizeTitlePart(worksheetTitle) || 'Worksheet'}`)
  if (pathname === '/worksheet' || pathname === '/worksheet/ai-tool-lab') return formatDocumentTitle(worksheetTitle || 'Worksheet')
  if (pathname === '/synthesis' || pathname === '/synthesis/ai-tool-lab') return formatDocumentTitle(`Synthesis for ${normalizeTitlePart(worksheetTitle) || 'Worksheet'}`)
  if (pathname === '/report' || pathname === '/report/ai-tool-lab') return formatDocumentTitle(`Report for ${normalizeTitlePart(worksheetTitle) || 'Worksheet'}`)
  if (pathname === '/join' || pathname.startsWith('/join/')) return formatDocumentTitle('Join Workbook')
  if (/^\/teacher\/workbooks\/[^/]+\/report$/.test(pathname)) return formatDocumentTitle('Workbook Responses')

  return formatDocumentTitle()
}
