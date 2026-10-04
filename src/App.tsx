import { HashRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type PointerEvent, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExtension from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { Wheel as CanvasWheel } from 'spin-wheel'
import {
  AlignLeft,
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  CheckSquare,
  ChevronRight,
  CircleDot,
  Clock3,
  CloudUpload,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileUp,
  FileText,
  GraduationCap,
  Grid2X2,
  Heading,
  Image,
  Link as LinkIcon,
  ListChecks,
  ListOrdered,
  LogOut,
  BarChart3,
  MoreVertical,
  Plus,
  Play,
  Scale,
  Search,
  RefreshCw,
  Shuffle,
  SlidersHorizontal,
  Table2,
  TextCursorInput,
  TextQuote,
  ToggleLeft,
  Upload,
  UserPlus,
  Video,
  Wrench,
} from 'lucide-react'
import { GlobalBreadcrumb, HomeScreen } from './components/AppChrome'
import { TeacherAccountPage, TeacherAuthProvider, useTeacherAuth } from './components/TeacherAuth'
import type { ConditionOperator, GroupedResponseSet, WorksheetBlock, WorksheetCondition, WorksheetDefinition, WorksheetPage, WorksheetResponse, WorksheetSettings, WorksheetSynthesisSettings } from './lib/types'
import {
  aggregateQuadrantMean,
  aggregateRadarValues,
  aggregateContinuum,
  aggregateDecisionMatrix,
  buildStudentSynthesis,
  getResponseLabel,
  groupResponsesByKey,
  mapCanvasPointToQuadrant,
} from './lib/aggregation'
import { createBuilderId } from './lib/builderIds'
import { getPublishCardState } from './lib/builderPublishState'
import { clearConditionsReferencingBlocks, getFirstConditionOrderViolation, remapBlockConditions } from './lib/conditionIntegrity'
import { updateBlockConfigWithOptionReferences } from './lib/optionReferenceIntegrity'
import { isResponseJsonExportEnabled, isResponsePdfExportEnabled, shouldAutosaveOnlineResponse } from './lib/worksheetSettings'
import { buildResponseIdStorageKey, exportResponseJson, getDefaultResponseId, getStoredSessionCreatedAt, loadSession, saveSession } from './lib/storage'
import { listOwnedWorksheets, listSubmittedResponseRows, listSubmittedResponses, loadOwnedWorksheet, loadParticipantResponse, loadPublishedWorksheet, publishWorksheet, saveOnlineResponse, submitOnlineResponse, type OnlineResponseRow, type OnlineWorksheetRow } from './lib/onlineRepository'
import { normalizeRandomizerAnimationDuration, selectRandomItem, shuffleRandomizerItems } from './lib/randomizer'
import { sanitizeRichTextHtml } from './lib/richTextSanitizer'
import {
  addMatchingPairConfig,
  getDefaultBlockConfig,
  getDefaultPageTimer,
  getFillBlankCorrectAnswerPatch,
  formatQuizPercent,
  getBoardPresetColumns,
  canNavigateToVisiblePage,
  getConditionOptions,
  getImageDisplayConfig,
  getLabeledConfigItems,
  getMatchingPairKey,
  getMissingRequiredBlockLocations,
  getMissingRequiredBlocks,
  getNumericRange,
  getQuizSummary,
  getWorksheetResponseImportError,
  numberInRange,
  reconcileCategorizeResponse,
  reconcileRankingResponse,
  reconcileWorksheetResponses,
  getUnanswerableRequiredBlocks,
  getVisibleBlocks,
  getVisiblePages,
  getVisiblePagesWithBlocks,
  hasMeaningfulResponseValue,
  isConditionSourceBlock,
  isWorksheetDefinition,
  isResponseProducingBlock,
  normalizeRichTextResponse,
  normalizeWorksheetDefinitionStableIds,
  reorderBlocks,
  sanitizeWorksheetDefinition,
  stripHtml,
} from './lib/worksheetLogic'
import { sanitiseWorksheetResponses } from './lib/responseValidation'
import { getPdfLineCapacity } from './lib/pdfLayout'

const ACTIVE_DEFINITION_KEY = 'worksheet-active-definition'
const WHEEL_SEGMENT_COLORS = ['#0ea5e9', '#ec4899', '#8b5cf6', '#f59e0b', '#ef4444', '#d946ef', '#22c55e', '#facc15']
const RESPONSE_SUMMARY_BLOCK_TYPES = new Set(['shortText', 'longText', 'richText', 'singleSelect', 'randomizer', 'multipleChoice', 'trueFalse', 'shortAnswer', 'checklist', 'ranking', 'verdict', 'rating', 'categorize', 'hotspot', 'numeric', 'wordCloud', 'confidence'])
const REPORT_EXCLUDED_BLOCK_TYPES = new Set(['randomizer'])
const SYNTHESIS_GROUPABLE_BLOCK_TYPES = new Set(['shortText', 'singleSelect', 'multipleChoice', 'trueFalse', 'verdict', 'confidence', 'checklist', 'randomizer', 'numeric'])

interface ReportPageSection {
  page: WorksheetPage
  responseBlocks: WorksheetBlock[]
  contextText?: string
}

const BLOCK_TYPE_ICONS: Record<string, typeof FileText> = {
  content: TextQuote,
  richText: AlignLeft,
  richTextInfo: TextQuote,
  richTextResponse: AlignLeft,
  shortText: TextCursorInput,
  longText: AlignLeft,
  section: Heading,
  multipleChoice: CircleDot,
  trueFalse: ToggleLeft,
  shortAnswer: TextCursorInput,
  matching: Grid2X2,
  fillBlank: TextCursorInput,
  singleSelect: CircleDot,
  randomizer: Shuffle,
  checklist: CheckSquare,
  ranking: ListOrdered,
  verdict: BadgeCheck,
  rating: Scale,
  matrix: Table2,
  radar: SlidersHorizontal,
  quadrant: Grid2X2,
  swot: ListChecks,
  imagePrompt: Image,
  video: Video,
  youtube: Play,
  url: LinkIcon,
  categorize: Grid2X2,
  hotspot: Image,
  numeric: Scale,
  wordCloud: TextQuote,
  confidence: SlidersHorizontal,
  continuum: SlidersHorizontal,
  decisionMatrix: Table2,
  board: Grid2X2,
}

function BlockTypeIcon({ type, className = 'h-4 w-4' }: { type: string; className?: string }) {
  const Icon = BLOCK_TYPE_ICONS[type] || FileText
  return <Icon aria-hidden="true" className={className} />
}

function getBlockDisplayLabel(block: WorksheetBlock) {
  return block.label || block.title || block.id
}

function pluralizeLabel(label: string, count: number) {
  if (count === 1) return label
  return label.endsWith('s') ? label : `${label}s`
}

function formatCountLabel(count: number, singularLabel: string) {
  return `${count} ${count === 1 ? singularLabel : `${singularLabel}s`}`
}

function getResponseProducingBlocks(definition: WorksheetDefinition) {
  return definition.pages.flatMap((page) => page.blocks).filter(isResponseProducingBlock)
}

function trimSynthesisValue(value?: string) {
  return typeof value === 'string' ? value.trim() : ''
}

function isSynthesisSettingsEmpty(settings?: WorksheetSynthesisSettings) {
  return !settings || !trimSynthesisValue(settings.groupByBlockId) && !trimSynthesisValue(settings.groupLabel) && !trimSynthesisValue(settings.responseLabelBlockId)
}

function clearRemovedBlockReferences(
  synthesis: WorksheetSynthesisSettings | undefined,
  deletedBlockIds: string[],
) {
  if (!synthesis) return undefined

  const next: WorksheetSynthesisSettings = { ...synthesis }
  if (next.groupByBlockId && deletedBlockIds.includes(next.groupByBlockId)) {
    delete next.groupByBlockId
  }
  if (next.responseLabelBlockId && deletedBlockIds.includes(next.responseLabelBlockId)) {
    delete next.responseLabelBlockId
  }

  return isSynthesisSettingsEmpty(next) ? undefined : next
}

function getConditionReferenceCount(definition: WorksheetDefinition, blockIds: string[]) {
  const targets = new Set(blockIds)
  return definition.pages.reduce((count, page) => {
    const pageConditionCount = page.condition && targets.has(page.condition.blockId) ? 1 : 0
    const blockConditionCount = page.blocks.filter((block) => block.condition && targets.has(block.condition.blockId)).length
    return count + pageConditionCount + blockConditionCount
  }, 0)
}

function buildResponseSearchText(response: WorksheetResponse) {
  const values = Object.values(response.responses || {})
  const flattened = values.map((value) => {
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  }).join(' ')

  return `${response.responseId} ${response.group || ''} ${response.subject || ''} ${flattened}`.toLowerCase()
}

const EMPTY_WORKSHEET_DEFINITION: WorksheetDefinition = {
  id: 'custom-worksheet',
  version: 1,
  title: 'Untitled Worksheet',
  description: 'Load a worksheet JSON or build one from scratch.',
  settings: {
    navigation: 'sequential',
    allowPageJumping: false,
    autosave: true,
    showProgress: true,
    completionMessage: '',
    exports: {
      json: true,
      pdf: true,
    },
  },
  pages: [],
}

type WorksheetBuilderSetter = (value: WorksheetDefinition | ((previous: WorksheetDefinition) => WorksheetDefinition)) => void

function getWorksheetStructure(definition: WorksheetDefinition) {
  const blocks = definition.pages.flatMap((page) => page.blocks)
  const radarBlock = blocks.find((block) => block.type === 'radar')
  const swotBlock = blocks.find((block) => block.type === 'swot')
  const quadrantBlock = blocks.find((block) => block.type === 'quadrant')

  const radarDimensions = (radarBlock?.config?.dimensions || [])
    .map((dimension: any) => (typeof dimension === 'string' ? dimension : String(dimension?.label || '')))
    .filter(Boolean)

  return {
    blocks,
    blockById: Object.fromEntries(blocks.map((block) => [block.id, block])) as Record<string, WorksheetBlock>,
    responseBlocks: blocks.filter(isResponseProducingBlock),
    radarBlockId: radarBlock?.id || 'radar-eval',
    radarDimensions,
    swotBlockId: swotBlock?.id || 'swot-board',
    quadrantBlockId: quadrantBlock?.id || 'quadrant-map',
  }
}

function truncateText(value: string, maxLength = 180) {
  if (value.length <= maxLength) return value
  const snippet = value.slice(0, maxLength).trimEnd()
  const breakPoint = snippet.lastIndexOf(' ')
  return `${(breakPoint > 80 ? snippet.slice(0, breakPoint) : snippet).trimEnd()}...`
}

function getPageContextText(page: WorksheetPage) {
  const contextualBlock = page.blocks.find((block) => block.type === 'content'
    || block.type === 'section'
    || (block.type === 'richText' && block.config?.mode === 'information'))

  if (!contextualBlock) return undefined

  const candidates = [
    contextualBlock.description,
    contextualBlock.type === 'richText' && typeof contextualBlock.config?.contentHtml === 'string'
      ? stripHtml(contextualBlock.config.contentHtml)
      : '',
    contextualBlock.title,
    contextualBlock.label,
  ]
  const text = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())
  return text ? truncateText(String(text).trim()) : undefined
}

function getRequiredLabel(block: WorksheetBlock) {
  return block.required ? 'Required' : ''
}

function getBlockErrorId(blockId: string) {
  return `worksheet-block-error-${blockId}`
}

function getBlockWrapperId(blockId: string) {
  return `worksheet-block-${blockId}`
}

const MODAL_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getModalFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
}

function useModalBehavior(isOpen: boolean, dialogRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const previousActiveElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const dialog = dialogRef.current
    if (!dialog) return undefined

    previousActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const siblingStates = Array.from(dialog.parentElement?.children || [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog)
      .map((element) => ({
        element,
        inert: element.getAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
      }))

    siblingStates.forEach(({ element }) => {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    })

    const focusTarget = dialog.querySelector<HTMLElement>('[data-modal-initial-focus]') ?? getModalFocusableElements(dialog)[0] ?? dialog
    focusTarget.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusableElements = getModalFocusableElements(dialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      siblingStates.forEach(({ element, inert, ariaHidden }) => {
        if (inert === null) element.removeAttribute('inert')
        else element.setAttribute('inert', inert)
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      })
      previousActiveElementRef.current?.focus()
    }
  }, [dialogRef, isOpen, onClose])
}

export function ModalOverlay({ isOpen, onClose, labelledBy, className, children }: { isOpen: boolean; onClose: () => void; labelledBy: string; className?: string; children?: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalBehavior(isOpen, dialogRef, onClose)

  if (!isOpen) return null

  return (
    <div ref={dialogRef} tabIndex={-1} className={className || 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4'} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      {children}
    </div>
  )
}

function BlockFieldLabel({ block }: { block: WorksheetBlock }) {
  const requiredLabel = getRequiredLabel(block)

  return (
    <span className="inline-flex items-center gap-2">
      <span>{block.label}</span>
      {requiredLabel && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">{requiredLabel}</span>}
    </span>
  )
}

function getSelectedOptionValues(value: unknown) {
  return Array.isArray(value) ? value : [value].filter((entry) => entry !== undefined && entry !== null && entry !== '')
}

function matchesOptionValue(value: unknown, option: { id: string; label: string }) {
  return value === option.id || value === option.label
}

function App() {
  const [activeDefinition, setActiveDefinition] = useState<WorksheetDefinition>(() => {
    const raw = localStorage.getItem(ACTIVE_DEFINITION_KEY)
    if (!raw) return EMPTY_WORKSHEET_DEFINITION

    try {
      const parsed = JSON.parse(raw) as unknown
      return isWorksheetDefinition(parsed)
        ? sanitizeWorksheetDefinition(normalizeWorksheetDefinitionStableIds(parsed))
        : EMPTY_WORKSHEET_DEFINITION
    } catch {
      return EMPTY_WORKSHEET_DEFINITION
    }
  })
  const setSanitizedActiveDefinition: WorksheetBuilderSetter = useCallback((value) => {
    setActiveDefinition((previous) => sanitizeWorksheetDefinition(normalizeWorksheetDefinitionStableIds(
      typeof value === 'function' ? value(previous) : value,
    )))
  }, [])
  const [, setDefinitionStatus] = useState('Import a worksheet JSON to replace the current active definition.')

  useEffect(() => {
    localStorage.setItem(ACTIVE_DEFINITION_KEY, JSON.stringify(activeDefinition))
  }, [activeDefinition])

  const importWorksheetDefinition = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return null

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (!isWorksheetDefinition(parsed)) {
        const error = 'Import failed: every page needs id, title, and blocks; every block needs id and type.'
        setDefinitionStatus(error)
        return error
      }
      const sanitized = sanitizeWorksheetDefinition(normalizeWorksheetDefinitionStableIds(parsed))
      setActiveDefinition(sanitized)
      setDefinitionStatus(`Loaded ${sanitized.title} (${sanitized.id} v${sanitized.version}) from ${file.name}.`)
      return null
    } catch {
      const error = 'Import failed: malformed JSON file.'
      setDefinitionStatus(error)
      return error
    } finally {
      event.target.value = ''
    }
  }

  return (
    <HashRouter>
      <TeacherAuthProvider>
        <div className="min-h-screen bg-slate-100 text-slate-900">
          <GlobalBreadcrumb />
          <Routes>
          <Route
            path="/"
            element={(
              <HomeScreen
                definition={activeDefinition}
              />
            )}
          />
          <Route path="/worksheet" element={<WorksheetPlayer definition={activeDefinition} />} />
          <Route path="/worksheet/ai-tool-lab" element={<WorksheetPlayer definition={activeDefinition} />} />
          <Route path="/synthesis" element={<SynthesisViewer definition={activeDefinition} initialMode="student" />} />
          <Route path="/synthesis/ai-tool-lab" element={<SynthesisViewer definition={activeDefinition} initialMode="student" />} />
          <Route path="/report" element={<SynthesisViewer definition={activeDefinition} initialMode="teacher" />} />
          <Route path="/report/ai-tool-lab" element={<SynthesisViewer definition={activeDefinition} initialMode="teacher" />} />
          <Route path="/system-guide" element={<SystemGuidePage />} />
          <Route path="/account" element={<TeacherAccountPage />} />
          <Route path="/teacher" element={<TeacherDashboard onOpenWorkbook={setSanitizedActiveDefinition} />} />
          <Route path="/teacher/workbooks/:workbookId/report" element={<OnlineTeacherReportPage />} />
          <Route path="/join" element={<OnlineJoinPageRoute />} />
          <Route path="/join/:publicCode" element={<OnlineJoinPageRoute />} />
          <Route
            path="/builder"
            element={(
              <BuilderPage
                definition={activeDefinition}
                setDefinition={setSanitizedActiveDefinition}
                importWorksheetDefinition={importWorksheetDefinition}
              />
            )}
          />
          <Route path="/preview" element={<WorksheetPlayer definition={activeDefinition} previewMode />} />
          </Routes>
        </div>
      </TeacherAuthProvider>
    </HashRouter>
  )
}

export function OnlineJoinPageRoute() {
  const { publicCode = '' } = useParams()
  return <OnlineJoinPage key={publicCode} />
}

function OnlineJoinPage() {
  const { publicCode = '' } = useParams()
  const navigate = useNavigate()
  const [code, setCode] = useState(publicCode.toUpperCase())
  const [workbook, setWorkbook] = useState<OnlineWorksheetRow | null>(null)
  const [loading, setLoading] = useState(Boolean(publicCode))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!publicCode) return
    let active = true
    setLoading(true)
    setError('')

    void loadPublishedWorksheet(publicCode).then((loadedWorkbook) => {
      if (!active) return
      setWorkbook(loadedWorkbook)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setError('We could not find a published workbook with that code. Check the code and try again.')
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [publicCode])

  if (workbook) {
    return <WorksheetPlayer definition={sanitizeWorksheetDefinition(normalizeWorksheetDefinitionStableIds(workbook.definition))} onlineWorksheetId={workbook.id} publicCode={workbook.public_code} />
  }

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!normalized) return
    navigate(`/join/${normalized}`)
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-45px)] max-w-3xl items-center px-5 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><UserPlus className="h-6 w-6" /></span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Learner access</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Join a workbook</h1>
        <p className="mt-3 text-slate-600">Enter the code your teacher shared. You do not need to create an account.</p>

        <form onSubmit={handleJoin} className="mt-7 flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="sr-only">Workbook code</span>
            <input autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={8} placeholder="e.g. 4K7MPQ2R" className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-lg font-semibold uppercase tracking-[0.16em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>
          <button type="submit" disabled={loading || !code.trim()} className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">{loading ? 'Opening…' : 'Open workbook'}</button>
        </form>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {loading && <p role="status" className="mt-4 text-sm text-slate-600">Loading the workbook securely…</p>}
      </section>
    </main>
  )
}

function TeacherDashboard({ onOpenWorkbook }: { onOpenWorkbook: (definition: WorksheetDefinition) => void }) {
  const { user, loading: authLoading, signOut } = useTeacherAuth()
  const navigate = useNavigate()
  const [workbooks, setWorkbooks] = useState<OnlineWorksheetRow[]>([])
  const [responsesByWorkbook, setResponsesByWorkbook] = useState<Record<string, OnlineResponseRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [copiedCode, setCopiedCode] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError('')
    void listOwnedWorksheets().then(async (ownedWorkbooks) => {
      const responseEntries = await Promise.all(ownedWorkbooks.map(async (workbook) => (
        [workbook.id, await listSubmittedResponseRows(workbook.id)] as const
      )))
      if (!active) return
      setWorkbooks(ownedWorkbooks)
      setResponsesByWorkbook(Object.fromEntries(responseEntries))
      setLoading(false)
    }).catch((loadError) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : 'Your workbooks could not be loaded.')
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [authLoading, refreshKey, user])

  const copyInvite = async (workbook: OnlineWorksheetRow) => {
    const link = `${window.location.origin}${window.location.pathname}#/join/${workbook.public_code}`
    try {
      await navigator.clipboard.writeText(link)
      setCopiedCode(workbook.public_code)
      window.setTimeout(() => setCopiedCode(''), 1800)
    } catch {
      setError('Copying was blocked by the browser. Open the workbook and copy its address instead.')
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  if (authLoading || loading) {
    return <main className="mx-auto flex min-h-[calc(100vh-45px)] max-w-6xl items-center justify-center px-5 py-10 text-sm text-slate-600"><RefreshCw className="mr-2 h-5 w-5 animate-spin" />Loading your workbooks…</main>
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-45px)] max-w-3xl items-center px-5 py-10">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <GraduationCap className="mx-auto h-10 w-10 text-emerald-700" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Teacher sign-in required</h1>
          <p className="mt-2 text-sm text-slate-600">Sign in to see your published workbooks and returned activities.</p>
          <Link to="/account" className="mt-6 inline-flex rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Teacher sign in</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Teacher workspace</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">My workbooks</h1>
            <p className="mt-2 text-sm text-slate-600">Create activities, invite learners, and review returned work.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/builder" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"><Plus className="h-4 w-4" />Create workbook</Link>
            <button type="button" onClick={() => setRefreshKey((value) => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"><RefreshCw className="h-4 w-4" />Refresh</button>
            <button type="button" onClick={() => void handleSignOut()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        </div>
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">Signed in as {user.email}</p>
      </header>

      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      {workbooks.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-slate-400" />
          <h2 className="mt-4 text-xl font-bold text-slate-900">No published workbooks yet</h2>
          <p className="mt-2 text-sm text-slate-600">Build your first activity, then use Publish &amp; invite.</p>
          <Link to="/builder" className="mt-6 inline-flex rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">Create workbook</Link>
        </section>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {workbooks.map((workbook) => {
            const responses = responsesByWorkbook[workbook.id] || []
            return (
              <article key={workbook.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">{workbook.status}</p>
                    <h2 className="mt-1 text-xl font-bold text-slate-900">{workbook.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">Published {new Date(workbook.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm font-bold tracking-[0.14em] text-slate-800">{workbook.public_code}</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-emerald-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Submitted</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-900">{responses.length}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pages</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{workbook.definition.pages.length}</p>
                  </div>
                </div>

                {responses.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {responses.slice(0, 3).map((response) => (
                      <div key={response.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-700">{response.participant_label || response.answers?.group || response.answers?.subject || 'Anonymous learner'}</span>
                        <span className="text-xs text-slate-500">{response.submitted_at ? new Date(response.submitted_at).toLocaleString() : 'Submitted'}</span>
                      </div>
                    ))}
                    {responses.length > 3 && <p className="text-xs text-slate-500">And {responses.length - 3} more…</p>}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <Link to={`/teacher/workbooks/${workbook.id}/report`} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"><BarChart3 className="h-4 w-4" />View responses</Link>
                  <button type="button" onClick={() => void copyInvite(workbook)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"><Copy className="h-4 w-4" />{copiedCode === workbook.public_code ? 'Link copied' : 'Copy invite'}</button>
                  <button type="button" onClick={() => { onOpenWorkbook(workbook.definition); navigate('/builder') }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">Open in builder</button>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </main>
  )
}

function OnlineTeacherReportPage() {
  const { workbookId = '' } = useParams()
  const { user, loading: authLoading } = useTeacherAuth()
  const [workbook, setWorkbook] = useState<OnlineWorksheetRow | null>(null)
  const [responses, setResponses] = useState<WorksheetResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reportNotice, setReportNotice] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user || !workbookId) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError('')
    setReportNotice('')
    void Promise.all([loadOwnedWorksheet(workbookId), listSubmittedResponses(workbookId)]).then(([loadedWorkbook, loadedResponses]) => {
      if (!active) return
      const sanitised = sanitiseWorksheetResponses(loadedWorkbook.definition, loadedResponses)
      setWorkbook(loadedWorkbook)
      setResponses(sanitised.responses)
      if (sanitised.rejectedResponses || sanitised.rejectedValues) {
        setReportNotice(`Loaded ${sanitised.responses.length} response(s). Skipped ${sanitised.rejectedResponses} malformed response(s) and ${sanitised.rejectedValues} malformed answer value(s).`)
      }
      setLoading(false)
    }).catch((loadError) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : 'The workbook report could not be loaded.')
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [authLoading, user, workbookId])

  if (authLoading || loading) return <main className="mx-auto flex min-h-[calc(100vh-45px)] items-center justify-center text-sm text-slate-600"><RefreshCw className="mr-2 h-5 w-5 animate-spin" />Loading returned work…</main>
  if (!user) return <main className="mx-auto max-w-3xl px-5 py-12 text-center"><h1 className="text-2xl font-bold">Teacher sign-in required</h1><Link to="/account" className="mt-5 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Teacher sign in</Link></main>
  if (error || !workbook) return <main className="mx-auto max-w-3xl px-5 py-12"><p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error || 'Workbook not found.'}</p><Link to="/teacher" className="mt-4 inline-flex text-sm font-semibold text-blue-700">Back to my workbooks</Link></main>

  return <SynthesisViewer definition={workbook.definition} initialMode="teacher" initialResponses={responses} initialNotice={reportNotice} backTo="/teacher" />
}

function SystemGuidePage() {
  const blockCatalog = [
    { type: 'content', summary: 'Static text, headings, and instructional panels.' },
    { type: 'shortText', summary: 'Single-line answer for names, subjects, or short-form input.' },
    { type: 'longText', summary: 'Larger text response for reflection, notes, or explanation.' },
    { type: 'singleSelect', summary: 'Non-graded single answer from a list of options.' },
    { type: 'randomizer', summary: 'Teacher-defined generator that chooses one random value from a list for the student to use or respond to.' },
    { type: 'multipleChoice', summary: 'Graded multiple-choice question with optional multi-answer mode.' },
    { type: 'trueFalse', summary: 'Quick true/false quiz question with a correct answer.' },
    { type: 'shortAnswer', summary: 'Short-answer quiz question that checks the exact answer text.' },
    { type: 'matching', summary: 'Match prompts to the correct answer from a set of options.' },
    { type: 'fillBlank', summary: 'Fill in the blank using a correct phrase or value.' },
    { type: 'checklist', summary: 'Multi-select checklist with multiple valid values.' },
    { type: 'ranking', summary: 'Order items from most to least important.' },
    { type: 'categorize', summary: 'Assign every item to one of the teacher-defined categories.' },
    { type: 'wordCloud', summary: 'Capture several short words or phrases for response aggregation.' },
    { type: 'confidence', summary: 'Quick confidence pulse using teacher-defined response levels.' },
    { type: 'matrix', summary: 'Rate multiple rows against a shared numeric rubric.' },
    { type: 'imagePrompt', summary: 'Display an image and capture a written response beneath it.' },
    { type: 'hotspot', summary: 'Place one or more percentage-based markers directly on an image.' },
    { type: 'video', summary: 'Direct media URL rendered with a native video player.' },
    { type: 'youtube', summary: 'YouTube embed derived from a share or watch URL.' },
    { type: 'section', summary: 'Divider or heading to visually group worksheet content.' },
    { type: 'rating', summary: 'Slider-based numeric scale with min, max, and step values.' },
    { type: 'radar', summary: 'Multi-dimension chart for scoring and comparison.' },
    { type: 'quadrant', summary: 'Two-axis placement activity for value/risk or similar dimensions.' },
    { type: 'swot', summary: 'Board for strengths, weaknesses, opportunities, and threats.' },
    { type: 'verdict', summary: 'Single pick among recommendation or decision choices.' },
    { type: 'numeric', summary: 'Graded numeric response with optional tolerance, units, and points.' },
    { type: 'continuum', summary: 'Place a judgement on a labelled 0–100 spectrum with an optional rationale.' },
    { type: 'decisionMatrix', summary: 'Compare stable-ID options against stable-ID criteria using a shared rating scale.' },
    { type: 'board', summary: 'Collect editable ideas in teacher-configured columns, with reusable authoring presets.' },
  ]

  const capabilityManifest = {
    platform: {
      name: 'Worksheet platform',
      purpose: 'Create, share, and evaluate interactive learning worksheets from JSON-first definitions.',
      entryPoints: ['student worksheet runner', 'teacher worksheet builder', 'student synthesis', 'teacher report', 'system guide'],
      supportedFeatures: [
        'Structured worksheet definitions with page-based authoring',
        'JSON import/export for teacher and student workflow',
        'Autosave and resume continuation for active worksheets',
        'Optional learner completion popup after automatic JSON export on Finish',
        'Multi-file response import and aggregated synthesis',
        'Configurable synthesis grouping and response labels',
        'Shared filtering across student synthesis and teacher report',
        'Page-based report sections derived from worksheet structure',
        'Teacher reporting with radar, quadrant, and SWOT analysis',
        'Student-facing summaries and recommendations',
        'Optional page timers and progress tracking',
        'Conditional page and block display based on earlier responses',
      ],
    },
    schema: {
      worksheetDefinition: {
        required: ['id', 'version', 'title', 'description', 'settings', 'pages'],
        shape: {
          id: 'string',
          version: 'number',
          title: 'string',
          description: 'string',
          settings: 'WorksheetSettings',
          synthesis: 'optional WorksheetSynthesisSettings',
          pages: 'WorksheetPage[]',
        },
        settings: {
          navigation: ['sequential', 'free'],
          allowPageJumping: 'boolean',
          autosave: 'boolean',
          showProgress: 'boolean',
          completionMessage: 'optional learner-facing popup text shown after Finish exports the response JSON',
          exports: { json: 'boolean', pdf: 'boolean' },
        },
        synthesis: {
          groupByBlockId: 'optional string block id used as the synthesis grouping key',
          groupLabel: 'optional human-readable label for synthesis groups',
          responseLabelBlockId: 'optional string block id used to label individual responses',
        },
        page: {
          required: ['id', 'title', 'blocks'],
          shape: {
            id: 'string',
            title: 'string',
            timer: 'optional PageTimer',
            condition: 'optional WorksheetCondition',
            blocks: 'WorksheetBlock[]',
          },
        },
        pageTimer: {
          enabled: 'boolean',
          durationSeconds: 'number',
          behaviour: ['advisory', 'auto-advance'],
        },
        block: {
          required: ['id', 'type'],
          shape: {
            id: 'string',
            type: 'supported block type',
            label: 'optional string',
            title: 'optional string',
            description: 'optional string',
            required: 'optional boolean',
            condition: 'optional WorksheetCondition',
            config: 'optional object',
          },
        },
        condition: {
          blockId: 'id of an earlier response-producing block',
          operator: ['equals', 'notEquals', 'contains', 'notContains'],
          value: 'string | number | boolean',
          behavior: 'The page or block is visible only while this rule matches. Hidden responses are retained and hidden required blocks are not validated.',
        },
      },
      response: {
        required: ['responseSchema', 'schemaVersion', 'worksheetId', 'worksheetVersion', 'responseId', 'createdAt', 'updatedAt', 'responses'],
        shape: {
          responseSchema: 'interactive-worksheet-response',
          schemaVersion: 'number',
          worksheetId: 'string',
          worksheetVersion: 'number',
          responseId: 'string',
          createdAt: 'ISO datetime string',
          updatedAt: 'ISO datetime string',
          group: 'optional string',
          subject: 'optional string',
          responses: 'Record<blockId, any>',
        },
      },
    },
    blocks: {
      categories: {
        textAndPrompting: ['content', 'richText', 'shortText', 'longText', 'section'],
        quiz: ['multipleChoice', 'trueFalse', 'shortAnswer', 'matching', 'fillBlank', 'numeric'],
        choiceAndSelection: ['singleSelect', 'randomizer', 'checklist', 'ranking', 'categorize', 'confidence', 'verdict'],
        analysisAndAssessment: ['rating', 'continuum', 'matrix', 'decisionMatrix', 'radar', 'quadrant', 'swot', 'board', 'wordCloud'],
        mediaAndEvidence: ['imagePrompt', 'hotspot', 'video', 'youtube', 'url'],
      },
      definitions: {
        content: {
          purpose: 'Read-only instructional copy or briefing text.',
          fields: ['title', 'description'],
          config: {},
        },
        section: {
          purpose: 'Visual section divider or heading.',
          fields: ['title'],
          config: {},
        },
        shortText: {
          purpose: 'Single-line learner response.',
          fields: ['label', 'description', 'required'],
          config: { placeholder: 'string' },
          responseShape: 'string',
        },
        longText: {
          purpose: 'Multi-line learner response.',
          fields: ['label', 'description', 'required'],
          config: { placeholder: 'string' },
          responseShape: 'string',
        },
        richText: {
          purpose: 'Formatted information block or formatted learner response block.',
          fields: ['label', 'description'],
          config: {
            mode: ['information', 'response'],
            placeholder: 'string',
            contentHtml: 'HTML string for information mode',
          },
          responseShape: 'string (HTML)',
        },
        url: {
          purpose: 'Open an external resource in a new tab.',
          fields: ['label', 'description'],
          config: {
            url: 'string',
            buttonText: 'string',
            audience: ['student', 'staff'],
          },
        },
        singleSelect: {
          purpose: 'Non-graded single selection from teacher-defined options.',
          fields: ['label', 'description', 'required'],
          config: { options: 'string[]' },
          responseShape: 'string',
        },
        randomizer: {
          purpose: 'Generate one random item from a list using one of several visual display styles.',
          fields: ['label', 'description'],
          config: {
            prompt: 'string',
            items: 'string[]',
            shuffle: 'boolean',
            requireFirstGeneration: 'boolean',
            displayStyle: ['word-flicker', 'wheel', 'card-shuffle'],
            animationDurationMs: 'number >= 300',
          },
          responseShape: 'string',
        },
        multipleChoice: {
          purpose: 'Graded multiple-choice question.',
          fields: ['label', 'description', 'required'],
          config: {
            question: 'string',
            options: 'string[]',
            correctAnswer: 'string | string[]',
            multipleAnswers: 'boolean',
            showFeedback: 'boolean',
            points: 'number',
            explanation: 'string',
          },
          responseShape: 'string | string[]',
        },
        trueFalse: {
          purpose: 'Binary graded question.',
          fields: ['label', 'description', 'required'],
          config: {
            question: 'string',
            correctAnswer: 'boolean',
            showFeedback: 'boolean',
            points: 'number',
            explanation: 'string',
          },
          responseShape: 'boolean | string',
        },
        shortAnswer: {
          purpose: 'Exact-match graded short answer.',
          fields: ['label', 'description', 'required'],
          config: {
            question: 'string',
            correctAnswer: 'string',
            showFeedback: 'boolean',
            points: 'number',
            explanation: 'string',
          },
          responseShape: 'string',
        },
        matching: {
          purpose: 'Match prompts to answers.',
          fields: ['label', 'description', 'required'],
          config: {
            question: 'string',
            options: 'string[]',
            pairs: '{ id, prompt, answer }[]',
            showFeedback: 'boolean',
            points: 'number',
          },
          responseShape: 'Record<pairId, selectedOption>',
        },
        fillBlank: {
          purpose: 'Fill-in-the-blank graded response.',
          fields: ['label', 'description', 'required'],
          config: {
            question: 'string',
            correctAnswer: 'string',
            answers: 'optional string[]',
            showFeedback: 'boolean',
            points: 'number',
            explanation: 'string',
          },
          responseShape: 'string',
        },
        checklist: {
          purpose: 'Multi-select, non-graded option list.',
          fields: ['label', 'description', 'required'],
          config: { options: 'string[]' },
          responseShape: 'string[]',
        },
        ranking: {
          purpose: 'Re-order or prioritise listed items.',
          fields: ['label', 'description'],
          config: { options: 'string[]' },
          responseShape: 'string[]',
        },
        categorize: {
          purpose: 'Assign each teacher-defined item to a category.',
          fields: ['label', 'description', 'required'],
          config: { items: 'string[]', categories: 'string[]' },
          responseShape: 'Record<itemLabel, categoryLabel>',
          requiredRule: 'Every configured item must have a non-empty category assignment.',
        },
        wordCloud: {
          purpose: 'Collect a bounded set of short learner words or phrases.',
          fields: ['label', 'description', 'required'],
          config: { maxEntries: 'number from 1 to 10', placeholder: 'string' },
          responseShape: 'string[]',
          requiredRule: 'At least one non-empty entry is required.',
        },
        confidence: {
          purpose: 'Capture a quick self-assessment of learner confidence.',
          fields: ['label', 'description', 'required'],
          config: { options: 'string[]' },
          responseShape: 'string',
        },
        verdict: {
          purpose: 'Final recommendation or decision pick.',
          fields: ['label', 'description'],
          config: { options: 'string[]' },
          responseShape: 'string',
        },
        rating: {
          purpose: 'Numeric scale slider.',
          fields: ['label', 'description', 'required'],
          config: {
            min: 'number',
            max: 'number',
            step: 'number',
            minLabel: 'string',
            maxLabel: 'string',
            defaultValue: 'number',
          },
          responseShape: 'number',
        },
        continuum: {
          purpose: 'Place an idea or judgement on a labelled horizontal spectrum.',
          fields: ['label', 'description', 'required'],
          config: { leftLabel: 'string', rightLabel: 'string', instructions: 'optional string', rationaleRequired: 'boolean', defaultValue: 'visual starting position from 0 to 100; does not count as a response' },
          responseShape: '{ position: number from 0 to 100, rationale?: string }',
          requiredRule: 'The learner must intentionally change the position. A required rationale must also contain meaningful text.',
          synthesis: 'Plots submitted positions together and reports count, mean, median, and rationales.',
        },
        matrix: {
          purpose: 'Rate multiple rows on a common scale.',
          fields: ['label', 'description'],
          config: {
            rows: 'string[]',
            min: 'number',
            max: 'number',
            defaultValue: 'number',
          },
          responseShape: 'Record<rowLabel, number>',
        },
        decisionMatrix: {
          purpose: 'Compare several options against shared criteria.',
          fields: ['label', 'description', 'required'],
          config: { options: '{ id, label }[]', criteria: '{ id, label }[]', min: 'number', max: 'number', showTotals: 'boolean' },
          responseShape: 'Record<optionId, Record<criterionId, number>>',
          requiredRule: 'Every configured option and criterion cell must have a numeric rating.',
          synthesis: 'Shows averages and valid response counts for every option/criterion cell plus each option overall mean.',
        },
        radar: {
          purpose: 'Score several dimensions for charting and synthesis.',
          fields: ['label', 'description'],
          config: {
            dimensions: '{ id, label }[]',
          },
          responseShape: 'Record<dimensionLabel, number>',
        },
        quadrant: {
          purpose: 'Place a point on a two-axis model and optionally justify it.',
          fields: ['label', 'description'],
          config: {
            xLeft: 'string',
            xRight: 'string',
            yBottom: 'string',
            yTop: 'string',
            rationaleRequired: 'boolean',
            instructions: 'string',
          },
          responseShape: '{ x: number, y: number, rationale?: string }',
        },
        swot: {
          purpose: 'Categorise text responses into board columns.',
          fields: ['label', 'description'],
          config: {
            categories: '{ id, label }[]',
          },
          responseShape: 'Record<categoryId, { text: string }[]>',
        },
        board: {
          purpose: 'Collect ideas in configurable columns; presets are builder conveniences rather than separate block types.',
          fields: ['label', 'description', 'required'],
          config: { columns: '{ id, label, description? }[]', allowMultipleEntries: 'boolean', maxEntriesPerColumn: '0 for unlimited or a positive number', placeholder: 'string' },
          builderPresets: {
            blank: ['Column 1', 'Column 2', 'Column 3'],
            PMI: ['Plus', 'Minus', 'Interesting'],
            KWL: ['Know', 'Want to know', 'Learned'],
            startStopContinue: ['Start', 'Stop', 'Continue'],
            prosCons: ['Pros', 'Cons'],
            roseBudThorn: ['Rose', 'Bud', 'Thorn'],
            whatSoWhatNowWhat: ['What?', 'So What?', 'Now What?'],
          },
          presetNote: 'Presets only create an editable starting set of columns. They do not create separate block types, and teachers can rename, reorder, add, or remove columns afterwards.',
          responseShape: 'Record<columnId, { id: string, text: string }[]>',
          requiredRule: 'At least one meaningful entry must exist in any configured column.',
          synthesis: 'Groups entries by configured column and retains their source response labels.',
        },
        imagePrompt: {
          purpose: 'Display an image prompt with optional response placeholder.',
          fields: ['label', 'description'],
          config: {
            imageUrl: 'string',
            altText: 'string',
            placeholder: 'string',
            imageFit: ['contain', 'cover'],
            imageSize: ['small', 'medium', 'large', 'full'],
          },
          responseShape: 'string',
        },
        hotspot: {
          purpose: 'Place one or more markers on a teacher-supplied image.',
          fields: ['label', 'description', 'required'],
          config: {
            imageUrl: 'string',
            altText: 'string',
            allowMultiple: 'boolean',
          },
          responseShape: '{ x: number, y: number }[] where x and y are image percentages from 0 to 100',
          requiredRule: 'At least one marker must be placed.',
        },
        numeric: {
          purpose: 'Grade a numeric answer using an optional absolute tolerance.',
          fields: ['label', 'description', 'required'],
          config: {
            correctAnswer: 'number',
            tolerance: 'non-negative number',
            unit: 'string',
            placeholder: 'string',
            showFeedback: 'boolean',
            points: 'number',
          },
          responseShape: 'number',
          scoringRule: 'Correct when abs(response - correctAnswer) <= tolerance.',
        },
        video: {
          purpose: 'Embed a direct video URL with an optional response prompt.',
          fields: ['label', 'description'],
          config: {
            videoUrl: 'string',
            altText: 'string',
            placeholder: 'string',
          },
          responseShape: 'string',
        },
        youtube: {
          purpose: 'Embed a YouTube video via watch/share URL with an optional response prompt.',
          fields: ['label', 'description'],
          config: {
            videoUrl: 'string',
            altText: 'string',
            placeholder: 'string',
          },
          responseShape: 'string',
        },
      },
    },
    analytics: {
      supportedOutputs: ['student synthesis', 'teacher report', 'class PDF export'],
      synthesisTerminology: {
        responseId: 'Unique identifier for a submission.',
        synthesisGroupingKey: 'The learner response field used to group related submissions.',
        responseLabel: 'The human-readable name shown for an individual submission inside a synthesis group.',
      },
      groupingBehavior: {
        normalization: ['trim whitespace', 'collapse repeated whitespace', 'compare case-insensitively'],
        missingGroupingValue: 'Falls back to Unspecified without discarding the response.',
        missingGroupingConfig: 'Falls back to a neutral All responses group.',
        invalidGroupingConfig: 'Shows a warning and falls back gracefully to ungrouped synthesis.',
        compatibility: 'AI Tool Lab can still fall back to subject/tool-name grouping when explicit synthesis settings are absent.',
      },
      chartTypes: ['radar', 'quadrant', 'summary badges', 'verdict distribution', 'matrix averages', 'word cloud terms', 'image hotspot coordinates'],
      sharedFilters: ['grouping key', 'response label', 'verdict', 'free-text search'],
      reportHierarchy: ['synthesis group', 'worksheet page section', 'response block card'],
      finishBehavior: ['checks required items before allowing completion', 'exports the learner response JSON', 'shows a completion popup using settings.completionMessage when configured'],
      sectionBehavior: {
        source: 'Report sections are derived from definition.pages.',
        inclusion: 'Only pages with reportable response data are rendered.',
        context: 'Short contextual copy may be pulled from existing content, section, or informational rich text blocks.',
        exclusions: ['content blocks are not rendered as response cards', 'section blocks are not rendered as response cards', 'URL blocks are not rendered as response cards', 'randomizer controls are excluded from report cards'],
      },
      teacherSignals: ['strengths', 'weaknesses', 'mean scores', 'group trends', 'verdict distributions', 'individual written responses'],
      sampleResponses: 'Use public/sample-responses/tool-comparison/*.json with public/worksheets/ai-tool-lab.json for grouped synthesis testing.',
    },
    timers: {
      model: 'Page-scoped timer with enabled, durationSeconds, and behaviour.',
      default: 'Off by default unless a worksheet explicitly enables one.',
    },
  }

  const exampleWorksheet = {
    id: 'example-worksheet',
    version: 1,
    title: 'AI prompt example',
    description: 'A template for authoring a worksheet JSON file.',
    settings: {
      navigation: 'sequential',
      allowPageJumping: false,
      autosave: true,
      showProgress: true,
      completionMessage: 'Your response JSON has been downloaded. Upload it wherever your teacher asked you to submit your work.',
      exports: { json: true, pdf: true },
    },
    synthesis: {
      groupByBlockId: 'block-1',
      groupLabel: 'AI Tool',
      responseLabelBlockId: 'block-team',
    },
    pages: [
      {
        id: 'page-1',
        title: 'Intro',
        blocks: [
          {
            id: 'block-intro',
            type: 'content',
            title: 'Worksheet briefing',
            description: 'Explain the task before students respond.',
          },
          {
            id: 'block-team',
            type: 'shortText',
            label: 'Group name or number',
            required: true,
            config: { placeholder: 'Enter the team label' },
          },
          {
            id: 'block-1',
            type: 'shortText',
            label: 'Tool or subject name',
            required: true,
            config: { placeholder: 'Enter the tool name' },
          },
          {
            id: 'block-2',
            type: 'singleSelect',
            label: 'What are you reviewing?',
            config: {
              options: ['Diffit', 'NotebookLM', 'ChatGPT'],
            },
          },
          {
            id: 'block-video',
            type: 'youtube',
            label: 'Watch the short demo',
            config: {
              videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            },
          },
        ],
      },
    ],
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 [&_ul]:list-disc [&_ul]:pl-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">System guide</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">Worksheet system reference</h1>
        <p className="mt-4 max-w-3xl text-slate-600">
          This page acts as the live reference for the platform as it grows. It is designed so an AI can read the supported capabilities and generate valid worksheet JSON quickly and consistently.
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">What the system does</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li>Builds interactive worksheets from structured JSON.</li>
            <li>Supports sequential or free navigation through pages.</li>
            <li>Captures student responses and persists autosave sessions.</li>
            <li>Lets teachers sign in, publish a workbook, and share an eight-character join code or direct link.</li>
            <li>Lets learners join without an account, autosave online, and submit directly to the workbook owner.</li>
            <li>Exports worksheet definitions and response JSON.</li>
            <li>Can export the learner JSON automatically on Finish and show a teacher-authored completion popup.</li>
            <li>Generates synthesis views for class aggregation with configurable grouping and response labels.</li>
            <li>Applies the same group, response label, verdict, and keyword filters in student synthesis and teacher report views.</li>
            <li>Organises synthesis and report output into page-based sections using the worksheet's existing page structure.</li>
            <li>Supports radar, quadrant, SWOT, and media-based prompts.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">AI authoring guidance</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li>Keep each page in a clear learning sequence.</li>
            <li>Use descriptive IDs like block-intro or block-matrix-1.</li>
            <li>Prefer stable labels and simple option arrays for choice blocks.</li>
            <li>Put media URLs in config.videoUrl or config.imageUrl.</li>
            <li>Configure `synthesis.groupByBlockId` and `synthesis.responseLabelBlockId` when you want grouped synthesis output.</li>
            <li>Configure `settings.completionMessage` when learners need a custom hand-in or next-step popup after finishing.</li>
            <li>For synthesis, use radar, quadrant, matrix, SWOT, or verdict blocks where possible.</li>
            <li>Keep definitions versioned for future schema updates.</li>
          </ul>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Learner completion</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Learner flow</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Online workbooks autosave responses to Supabase and submit them directly on Finish.</li>
              <li>Locally loaded workbooks continue to export response JSON as a portable fallback.</li>
              <li>After submission or export, the learner sees a completion popup.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Worksheet setting</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Store custom popup copy in `settings.completionMessage`.</li>
              <li>Leave it blank to use the default completion text.</li>
              <li>This is a worksheet-level setup option, not a page-level option.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Synthesis configuration</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Builder settings</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Group responses by: selects the response-producing block used as the synthesis grouping key.</li>
              <li>Group label: sets the human-readable name used across synthesis and report views.</li>
              <li>Label individual responses by: chooses the block used to name each submission inside a synthesis group.</li>
              <li>If a referenced block is deleted, the builder warns first and clears the broken synthesis setting if deletion proceeds.</li>
              <li>Report hierarchy stays schema-light: grouped responses render first by synthesis key, then by worksheet page, then by block.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Import behavior</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Multiple responses with the same grouping value stay separate and also generate an aggregate view.</li>
              <li>Grouping values are normalized by trimming and collapsing whitespace and comparing case-insensitively.</li>
              <li>Missing grouping values are placed under Unspecified.</li>
              <li>If no grouping is configured, synthesis falls back to a neutral All responses group.</li>
              <li>Student synthesis and teacher report share the same filter controls for group, response label, verdict, and keyword search.</li>
              <li>Group report by can regroup the current response set using another simple response block without editing or republishing the worksheet.</li>
              <li>Response-label chips are interactive filters; selecting a chip focuses the report on that response label and selecting it again clears the filter.</li>
              <li>Only worksheet pages with meaningful response data become report sections; procedural-only pages remain hidden unless they contain evidence worth showing.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Report section hierarchy</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Hierarchy</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Level 1: synthesis group, such as an AI tool or other configured grouping value.</li>
              <li>Level 2: worksheet page heading pulled from `page.title`.</li>
              <li>Level 3: response block cards shown inside the owning page section.</li>
              <li>This preserves conceptual grouping without adding new report schema.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Rendering rules</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Content, section, and URL blocks are used only as optional context, not as response cards.</li>
              <li>Related matrix blocks stay together inside the same worksheet page section.</li>
              <li>SWOT stays grouped as one conceptual block rather than four unrelated cards.</li>
              <li>The class PDF export follows the same group → page section → block hierarchy.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Complete capability manifest</h2>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
          <code>{JSON.stringify(capabilityManifest, null, 2)}</code>
        </pre>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Supported block types</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {blockCatalog.map((entry) => (
            <div key={entry.type} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-700">{entry.type}</p>
              <p className="mt-2 text-sm text-slate-600">{entry.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Worksheet JSON blueprint</h2>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
          <code>{JSON.stringify(exampleWorksheet, null, 2)}</code>
        </pre>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Sample synthesis test set</h2>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          <p>Load the AI Tool Lab worksheet JSON first, then import the sample student response files from the grouped comparison folder.</p>
          <ul className="space-y-2">
            <li>Worksheet: public/worksheets/ai-tool-lab.json</li>
            <li>Responses: public/sample-responses/tool-comparison/ai-tool-lab-diffit-group-1.json</li>
            <li>Responses: public/sample-responses/tool-comparison/ai-tool-lab-diffit-group-4.json</li>
            <li>Responses: public/sample-responses/tool-comparison/ai-tool-lab-notebooklm-group-2.json</li>
            <li>Responses: public/sample-responses/tool-comparison/ai-tool-lab-notebooklm-group-5.json</li>
          </ul>
          <p>This set creates two synthesis groups, Diffit and NotebookLM, each with two individual evaluations and one aggregate view.</p>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Minimal worksheet contract</h2>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
          <code>{`{
  id: 'worksheet-id',
  version: 1,
  title: 'Worksheet title',
  description: 'Human-readable description',
  settings: {
    navigation: 'sequential',
    allowPageJumping: false,
    autosave: true,
    showProgress: true,
    completionMessage: 'Your response JSON has been downloaded. Upload it wherever your teacher asked you to submit your work.',
    exports: { json: true, pdf: true }
  },
          synthesis: {
            groupByBlockId: 'block-1',
            groupLabel: 'AI Tool',
            responseLabelBlockId: 'block-team'
          },
  pages: [
    {
      id: 'page-1',
      title: 'Page title',
      blocks: [
        {
          id: 'block-1',
          type: 'shortText',
          label: 'Question',
          required: true,
          config: { placeholder: 'Answer here' }
        }
      ]
    }
  ]
}`}</code>
        </pre>
      </section>
    </main>
  )
}

function formatTimerValue(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function WorksheetPlayer({ definition, previewMode = false, onlineWorksheetId, publicCode }: { definition: WorksheetDefinition; previewMode?: boolean; onlineWorksheetId?: string; publicCode?: string }) {
  const navigate = useNavigate()
  const responseIdStorageKey = buildResponseIdStorageKey(definition.id, definition.version, onlineWorksheetId)
  const [pageIndex, setPageIndex] = useState(0)
  const [responseId, setResponseId] = useState(() => {
    const saved = localStorage.getItem(responseIdStorageKey)
    return saved || getDefaultResponseId()
  })
  const [responses, setResponses] = useState<Record<string, any>>({})
  const [status, setStatus] = useState('In progress')
  const [isSessionHydrated, setIsSessionHydrated] = useState(false)
  const [navigationWarning, setNavigationWarning] = useState('')
  const [showCompletionDialog, setShowCompletionDialog] = useState(false)
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [exportError, setExportError] = useState('')
  const [submittedOnlineResponse, setSubmittedOnlineResponse] = useState<OnlineResponseRow | null>(null)
  const [responseCreatedAt, setResponseCreatedAt] = useState(() => new Date().toISOString())
  const hasSubmittedOnlineResponse = Boolean(onlineWorksheetId && submittedOnlineResponse)

  useEffect(() => {
    setIsSessionHydrated(false)
    const saved = localStorage.getItem(responseIdStorageKey)
    if (saved) {
      setResponseId(saved)
      return
    }
    const next = getDefaultResponseId()
    localStorage.setItem(responseIdStorageKey, next)
    setResponseId(next)
  }, [responseIdStorageKey])

  useEffect(() => {
    if (!responseId) return
    localStorage.setItem(responseIdStorageKey, responseId)
    const saved = loadSession(definition.id, definition.version, responseId, onlineWorksheetId)
    if (saved) {
      setResponses(saved.responses || {})
      setPageIndex(saved.pageIndex || 0)
      setResponseCreatedAt(getStoredSessionCreatedAt(saved))
      setStatus('In progress')
    } else {
      setResponses({})
      setPageIndex(0)
      setResponseCreatedAt(new Date().toISOString())
      setStatus('In progress')
    }
    setSubmittedOnlineResponse(null)
    setIsSessionHydrated(true)
  }, [definition.id, definition.version, onlineWorksheetId, responseId, responseIdStorageKey])

  useEffect(() => {
    if (!onlineWorksheetId || !isSessionHydrated) return
    let active = true

    void loadParticipantResponse(onlineWorksheetId).then((savedResponse) => {
      if (!active || savedResponse?.status !== 'submitted') return
      setSubmittedOnlineResponse(savedResponse)
      setResponses(savedResponse.answers.responses || {})
      setStatus('Submitted')
      setExportError('')
    }).catch(() => {
      // Autosave will surface any connectivity problem if the learner continues editing.
    })

    return () => {
      active = false
    }
  }, [isSessionHydrated, onlineWorksheetId])

  useEffect(() => {
    if (definition.settings.autosave && responseId && isSessionHydrated) {
      saveSession(
        { responseId, createdAt: responseCreatedAt, pageIndex, responses, updatedAt: new Date().toISOString() },
        definition.id,
        definition.version,
        responseId,
        onlineWorksheetId,
      )
    }
  }, [definition, isSessionHydrated, onlineWorksheetId, pageIndex, responseCreatedAt, responseId, responses])

  const visiblePages = useMemo(() => getVisiblePages(definition, responses), [definition, responses])
  const visiblePageIndexes = useMemo(() => visiblePages.map((page) => definition.pages.indexOf(page)), [definition.pages, visiblePages])
  const totalPages = visiblePages.length
  const currentPage = definition.pages[pageIndex]
  const currentVisiblePageIndex = visiblePageIndexes.indexOf(pageIndex)
  const isRestrictedNavigation = definition.settings.navigation === 'sequential' || !definition.settings.allowPageJumping
  const visibleBlocks = currentPage
    ? getVisibleBlocks(currentPage, responses, definition).filter((block) => previewMode || getBlockAudience(block) === 'student')
    : []
  const currentTimer = currentPage?.timer ?? null
  const [pageRemainingSeconds, setPageRemainingSeconds] = useState<number | null>(null)
  const quizSummary = useMemo(() => getQuizSummary(definition, responses), [definition, responses])
  const completionMessage = useMemo(() => {
    const configured = trimSynthesisValue(definition.settings.completionMessage)
    if (onlineWorksheetId) {
      return configured && !/download|export|upload/i.test(configured)
        ? configured
        : 'Your response has been sent to your teacher. You can now close this page.'
    }
    if (configured) return configured
    return isResponseJsonExportEnabled(definition)
      ? 'Your response JSON has been downloaded. Upload it wherever your teacher asked you to submit your work.'
      : 'Your response is complete. You can now close this page.'
  }, [definition, onlineWorksheetId])
  const missingRequiredBlocks = useMemo(
    () => (currentPage ? getMissingRequiredBlocks(currentPage, responses, definition) : []),
    [currentPage, definition, responses],
  )
  const missingRequiredBlockLocations = useMemo(
    () => getMissingRequiredBlockLocations(definition, responses),
    [definition, responses],
  )
  const canLeaveCurrentPage = missingRequiredBlocks.length === 0
  const missingRequiredBlockIds = useMemo(() => new Set(missingRequiredBlocks.map((block) => block.id)), [missingRequiredBlocks])

  const buildRequiredBlocksWarning = useCallback((blocks: WorksheetBlock[]) => {
    if (blocks.length === 0) return ''
    const labels = blocks.slice(0, 3).map((block) => getBlockDisplayLabel(block))
    const remainingCount = Math.max(0, blocks.length - labels.length)
    return `Please complete the required items before continuing:
${labels.map((label) => `��� ${label}`).join('\n')}${remainingCount > 0 ? `\nand ${remainingCount} more required item${remainingCount === 1 ? '' : 's'}.` : ''}`
  }, [])

  const buildNavigationWarning = useCallback(() => {
    if (!currentPage || missingRequiredBlocks.length === 0) return ''
    return buildRequiredBlocksWarning(missingRequiredBlocks)
  }, [buildRequiredBlocksWarning, currentPage, missingRequiredBlocks])

  const buildPageJumpingWarning = useCallback(() => {
    if (definition.settings.navigation === 'sequential' && !definition.settings.allowPageJumping) {
      return 'This worksheet is set to sequential navigation with page jumping turned off. Use Next to move through one page at a time.'
    }
    if (definition.settings.navigation === 'sequential') {
      return 'This worksheet is set to sequential navigation. Use Next to move through one page at a time.'
    }
    return 'Page jumping is turned off for this worksheet. Use Next to move through one page at a time.'
  }, [definition.settings.allowPageJumping, definition.settings.navigation])

  useEffect(() => {
    if (!isSessionHydrated || visiblePageIndexes.length === 0 || visiblePageIndexes.includes(pageIndex)) return
    const nearest = visiblePageIndexes.find((index) => index > pageIndex) ?? visiblePageIndexes[visiblePageIndexes.length - 1]
    setPageIndex(nearest)
    setNavigationWarning('')
    setValidationAttempted(false)
  }, [isSessionHydrated, pageIndex, visiblePageIndexes])

  useEffect(() => {
    if (!currentTimer?.enabled) {
      setPageRemainingSeconds(null)
      return
    }

    setPageRemainingSeconds(Math.max(0, Number(currentTimer.durationSeconds) || 0))
  }, [currentPage?.id, currentTimer?.enabled, currentTimer?.durationSeconds])

  useEffect(() => {
    if (!currentTimer?.enabled || pageRemainingSeconds === null) return
    if (pageRemainingSeconds <= 0) return

    const intervalId = window.setInterval(() => {
      setPageRemainingSeconds((previous) => {
        if (previous === null || previous <= 0) return 0
        return previous - 1
      })
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [currentPage?.id, currentTimer?.enabled, pageRemainingSeconds])

  useEffect(() => {
    if (!currentTimer?.enabled || pageRemainingSeconds === null) return
    if (pageRemainingSeconds > 0) return

    if (currentTimer.behaviour === 'auto-advance') {
      if (!canLeaveCurrentPage) {
        setNavigationWarning(buildNavigationWarning())
        setStatus('Required responses missing')
        return
      }
      if (currentVisiblePageIndex < totalPages - 1) {
        setPageIndex(visiblePageIndexes[currentVisiblePageIndex + 1])
        return
      }
      setStatus('Time expired')
      return
    }

    setStatus('Time expired')
  }, [buildNavigationWarning, canLeaveCurrentPage, currentPage?.id, currentTimer, currentVisiblePageIndex, pageRemainingSeconds, totalPages, visiblePageIndexes])

  const updateResponse = (blockId: string, value: any) => {
    if (hasSubmittedOnlineResponse) return
    setNavigationWarning('')
    setExportError('')
    if (status === 'Required responses missing' || status === 'Page jumping disabled') {
      setStatus('In progress')
    }
    setResponses((previous) => ({ ...previous, [blockId]: value }))
  }

  const focusFirstMissingBlock = useCallback(() => {
    const firstMissing = missingRequiredBlocks[0]
    if (!firstMissing) return
    const wrapper = document.getElementById(getBlockWrapperId(firstMissing.id))
    wrapper?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const focusTarget = wrapper?.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]')
    focusTarget?.focus()
  }, [missingRequiredBlocks])

  const focusMissingBlock = useCallback((blockId: string) => {
    window.setTimeout(() => {
      const wrapper = document.getElementById(getBlockWrapperId(blockId))
      wrapper?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const focusTarget = wrapper?.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]')
      focusTarget?.focus()
    })
  }, [])

  const buildDocument = useCallback((): WorksheetResponse => ({
    responseSchema: 'interactive-worksheet-response',
    schemaVersion: 1,
    worksheetId: definition.id,
    worksheetVersion: definition.version,
    responseId,
    createdAt: responseCreatedAt,
    updatedAt: new Date().toISOString(),
    group: String(responses['group-name'] || ''),
    subject: String(responses['tool-name'] || responses['subject-name'] || ''),
    responses: reconcileWorksheetResponses(definition, responses),
  }), [definition, responseCreatedAt, responseId, responses])

  useEffect(() => {
    if (!onlineWorksheetId || !shouldAutosaveOnlineResponse(definition) || !isSessionHydrated || hasSubmittedOnlineResponse || status === 'Complete' || status === 'Submitting…') return
    const timeoutId = window.setTimeout(() => {
      void saveOnlineResponse(onlineWorksheetId, buildDocument(), String(responses['group-name'] || '')).then((savedResponse) => {
        if (savedResponse.status === 'submitted') {
          setSubmittedOnlineResponse(savedResponse)
          setResponses(savedResponse.answers.responses || {})
          setStatus('Submitted')
          setExportError('')
          return
        }
        setStatus('Saved online')
      }).catch(() => {
        setStatus('Saved on this device')
      })
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [buildDocument, definition, hasSubmittedOnlineResponse, isSessionHydrated, onlineWorksheetId, responses, status])

  const tryLeaveCurrentPage = () => {
    if (canLeaveCurrentPage) {
      setValidationAttempted(false)
      setNavigationWarning('')
      return true
    }

    setValidationAttempted(true)
    setNavigationWarning(buildNavigationWarning())
    setStatus('Required responses missing')
    focusFirstMissingBlock()
    return false
  }

  const tryCompleteWorksheet = () => {
    const firstMissingLocation = missingRequiredBlockLocations[0]
    if (!firstMissingLocation) return true

    const pageMissingBlocks = missingRequiredBlockLocations
      .filter((location) => location.pageIndex === firstMissingLocation.pageIndex)
      .map((location) => location.block)
    setPageIndex(firstMissingLocation.pageIndex)
    setValidationAttempted(true)
    setNavigationWarning(buildRequiredBlocksWarning(pageMissingBlocks))
    setStatus('Required responses missing')
    focusMissingBlock(firstMissingLocation.block.id)
    return false
  }

  const goToPage = (index: number) => {
    const targetVisiblePageIndex = visiblePageIndexes.indexOf(index)
    if (targetVisiblePageIndex < 0) return
    if (targetVisiblePageIndex > currentVisiblePageIndex && !tryLeaveCurrentPage()) return
    if (!canNavigateToVisiblePage(definition.settings, currentVisiblePageIndex, targetVisiblePageIndex)) {
      setNavigationWarning(buildPageJumpingWarning())
      setStatus('Page jumping disabled')
      return
    }
    if (status === 'Page jumping disabled') {
      setStatus('In progress')
    }
    setPageIndex(index)
  }

  const handleNext = async () => {
    if (!tryLeaveCurrentPage()) return

    if (currentVisiblePageIndex < totalPages - 1) {
      setPageIndex(visiblePageIndexes[currentVisiblePageIndex + 1])
      return
    }
    if (!tryCompleteWorksheet()) return
    if (onlineWorksheetId) {
      if (hasSubmittedOnlineResponse) {
        setExportError('This response has already been submitted. It is now read-only.')
        setStatus('Submitted')
        return
      }
      setStatus('Submitting…')
      setExportError('')
      try {
        const saved = await saveOnlineResponse(onlineWorksheetId, buildDocument(), String(responses['group-name'] || ''))
        if (saved.status === 'submitted') {
          setSubmittedOnlineResponse(saved)
          setResponses(saved.answers.responses || {})
          setExportError('This response has already been submitted. It is now read-only.')
          setStatus('Submitted')
          return
        }
        const submitted = await submitOnlineResponse(saved.id)
        setSubmittedOnlineResponse(submitted)
        setStatus('Complete')
        setShowCompletionDialog(true)
      } catch {
        setExportError("We couldn't submit your response. Your work is still saved on this device; check your connection and try again.")
        setStatus('Submission failed')
      }
      return
    }

    if (isResponseJsonExportEnabled(definition)) {
      try {
        exportResponseJson(buildDocument())
      } catch {
        setExportError("We couldn't automatically download your response. Use Download JSON above to save your work.")
        setStatus('Download failed')
        return
      }
    }
    setStatus('Complete')
    setShowCompletionDialog(true)
  }

  const handleBack = () => {
    if (currentVisiblePageIndex > 0) {
      goToPage(visiblePageIndexes[currentVisiblePageIndex - 1])
    }
  }

  const handleStartNew = () => {
    if (!window.confirm('Start a new response? This will clear the current saved version.')) return
    const nextId = getDefaultResponseId()
    const nextCreatedAt = new Date().toISOString()
    setShowCompletionDialog(false)
    setValidationAttempted(false)
    setNavigationWarning('')
    setExportError('')
    setResponseCreatedAt(nextCreatedAt)
    setResponseId(nextId)
    setResponses({})
    setPageIndex(0)
    setStatus('New response started')
    localStorage.setItem(responseIdStorageKey, nextId)
  }

  const handleExportJson = () => {
    if (!isResponseJsonExportEnabled(definition)) return
    exportResponseJson(buildDocument())
  }

  const handleExportPdf = () => {
    if (!isResponsePdfExportEnabled(definition)) return
    const document = buildDocument()
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const generatedAt = new Date().toLocaleString()
    const visiblePdfPages = getVisiblePagesWithBlocks(definition, document.responses)
      .map(({ page, blocks }) => ({
        page,
        blocks: blocks.filter((block) => getBlockAudience(block) === 'student'),
      }))
    const responseBlocks = visiblePdfPages.flatMap(({ blocks }) => blocks.filter(isResponseProducingBlock))
    const answeredCount = responseBlocks.filter((block) => hasMeaningfulResponseValue(document.responses[block.id])).length
    let y = 42

    const ensurePdfSpace = (height: number) => {
      if (y + height <= pageHeight - 42) return
      pdf.addPage()
      y = 52
    }

    const drawPdfCard = (title: string, lines: string[], tone: 'default' | 'section' = 'default') => {
      const innerWidth = pageWidth - 104
      const lineHeight = 12
      const wrappedLines = lines.flatMap((line) => pdf.splitTextToSize(line, innerWidth - 24))
      let remainingLines = wrappedLines.length ? wrappedLines : ['']
      let continued = false

      while (remainingLines.length > 0) {
        const fixedHeight = 34 + 14 + 10
        let capacity = getPdfLineCapacity(pageHeight - 42 - y - fixedHeight, lineHeight)
        if (capacity < 1) {
          pdf.addPage()
          y = 52
          capacity = getPdfLineCapacity(pageHeight - 42 - y - fixedHeight, lineHeight)
        }

        const pageLines = remainingLines.slice(0, Math.max(1, capacity))
        remainingLines = remainingLines.slice(pageLines.length)
        const cardHeight = 34 + pageLines.length * lineHeight + 14
        if (tone === 'section') {
          pdf.setFillColor(248, 250, 252)
          pdf.setDrawColor(203, 213, 225)
        } else {
          pdf.setFillColor(255, 255, 255)
          pdf.setDrawColor(226, 232, 240)
        }
        pdf.roundedRect(52, y, innerWidth, cardHeight, 10, 10, 'FD')
        pdf.setTextColor(15, 23, 42)
        pdf.setFontSize(11)
        pdf.text(continued ? `${title} (continued)` : title, 64, y + 18)
        pdf.setTextColor(71, 85, 105)
        pdf.setFontSize(9)
        pdf.text(pageLines, 64, y + 34)
        y += cardHeight + 10
        continued = true
      }
    }

    pdf.setFillColor(15, 23, 42)
    pdf.rect(0, 0, pageWidth, 82, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(22)
    pdf.text(`${definition.title} — Worksheet Response`, 52, 42)
    pdf.setFontSize(10)
    pdf.setTextColor(191, 219, 254)
    pdf.text(`Worksheet: ${definition.id} v${definition.version}   •   Answered items: ${answeredCount}/${responseBlocks.length}   •   Generated: ${generatedAt}`, 52, 62)

    y = 106
    pdf.setTextColor(15, 23, 42)
    pdf.setFontSize(14)
    pdf.text('Response overview', 52, y)
    y += 18

    const overviewCards = [
      { label: 'Subject', value: document.subject || 'Not recorded' },
      { label: 'Group', value: document.group || 'Not recorded' },
      { label: 'Response ID', value: document.responseId.slice(0, 12) },
    ]
    overviewCards.forEach((card, index) => {
      const width = 160
      const x = 52 + index * (width + 18)
      pdf.setFillColor(248, 250, 252)
      pdf.setDrawColor(226, 232, 240)
      pdf.roundedRect(x, y, width, 46, 8, 8, 'FD')
      pdf.setTextColor(100, 116, 139)
      pdf.setFontSize(8)
      pdf.text(card.label.toUpperCase(), x + 12, y + 15)
      pdf.setTextColor(15, 23, 42)
      pdf.setFontSize(11)
      const valueLines = pdf.splitTextToSize(card.value, width - 24).slice(0, 2)
      pdf.text(valueLines, x + 12, y + 30)
    })
    y += 68

    visiblePdfPages.forEach(({ page, blocks }) => {
      const answeredBlocks = blocks
        .filter(isResponseProducingBlock)
        .filter((block) => hasMeaningfulResponseValue(document.responses[block.id]))
      const contextText = getPageContextText({ ...page, blocks })

      if (answeredBlocks.length === 0 && !contextText) return

      drawPdfCard(page.title, contextText ? [contextText] : [], 'section')

      if (answeredBlocks.length === 0) {
        drawPdfCard('Responses', ['No recorded responses on this page.'])
        return
      }

      answeredBlocks.forEach((block) => {
        const value = document.responses[block.id]

        if (block.type === 'radar' && value && typeof value === 'object') {
          const scores = value as Record<string, number>
          const { min, max } = getNumericRange(block.config, 1, 10)
          const scoreEntries = Object.entries(scores)
            .map(([dimension, score]) => [dimension, numberInRange(score, min, max)] as const)
            .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
          if (!scoreEntries.length) return
          const radarHeight = Math.max(122, 46 + scoreEntries.length * 12)
          ensurePdfSpace(radarHeight + 10)
          pdf.setFillColor(255, 255, 255)
          pdf.setDrawColor(226, 232, 240)
          pdf.roundedRect(52, y, pageWidth - 104, radarHeight, 10, 10, 'FD')
          pdf.setTextColor(15, 23, 42)
          pdf.setFontSize(11)
          pdf.text(getBlockDisplayLabel(block), 64, y + 18)
          drawPdfRadar(pdf, 118, y + 72, 34, Object.fromEntries(scoreEntries))
          pdf.setFontSize(9)
          pdf.setTextColor(71, 85, 105)
          scoreEntries.forEach(([label, score], index) => {
            pdf.text(`${label}: ${score.toFixed(1)}`, 180, y + 34 + index * 12)
          })
          y += radarHeight + 12
          return
        }

        if (block.type === 'quadrant' && value && typeof value === 'object') {
          const point = value as Record<string, unknown>
          const pointX = numberInRange(point.x, 0, 100) ?? 0
          const pointY = numberInRange(point.y, 0, 100) ?? 0
          const rationale = typeof point.rationale === 'string' && point.rationale.trim() ? String(point.rationale).trim() : 'No rationale recorded.'
          const rationaleLines = pdf.splitTextToSize(rationale, pageWidth - 292)
          const firstPageLineLimit = getPdfLineCapacity(pageHeight - 42 - y - 88 - 10, 12)
          const firstPageLines = rationaleLines.slice(0, Math.max(1, firstPageLineLimit))
          const remainingRationaleLines = rationaleLines.slice(firstPageLines.length)
          const quadrantHeight = Math.max(134, 88 + firstPageLines.length * 12)
          ensurePdfSpace(quadrantHeight + 10)
          pdf.setFillColor(255, 255, 255)
          pdf.setDrawColor(226, 232, 240)
          pdf.roundedRect(52, y, pageWidth - 104, quadrantHeight, 10, 10, 'FD')
          pdf.setTextColor(15, 23, 42)
          pdf.setFontSize(11)
          pdf.text(getBlockDisplayLabel(block), 64, y + 18)
          drawPdfQuadrant(pdf, 64, y + 30, 92, pointX, pointY)
          pdf.setFontSize(9)
          pdf.setTextColor(71, 85, 105)
          pdf.text(`x: ${pointX.toFixed(1)}`, 172, y + 42)
          pdf.text(`y: ${pointY.toFixed(1)}`, 172, y + 56)
          pdf.text(firstPageLines, 172, y + 74)
          y += quadrantHeight + 12
          if (remainingRationaleLines.length) {
            drawPdfCard(`${getBlockDisplayLabel(block)} rationale`, remainingRationaleLines)
          }
          return
        }

        if (block.type === 'matrix' && value && typeof value === 'object') {
          const { min, max } = getNumericRange(block.config, 1, 5)
          const lines = Object.entries(value as Record<string, unknown>)
            .map(([row, score]) => [row, numberInRange(score, min, max)] as const)
            .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
            .map(([row, score]) => `${row}: ${score.toFixed(1)}`)
          if (!lines.length) return
          drawPdfCard(getBlockDisplayLabel(block), lines)
          return
        }

        if (block.type === 'swot' && value && typeof value === 'object') {
          const categories = Array.isArray(block.config?.categories)
            ? block.config.categories
            : [
                { id: 'strengths', label: 'Strengths' },
                { id: 'weaknesses', label: 'Weaknesses' },
                { id: 'opportunities', label: 'Opportunities' },
                { id: 'threats', label: 'Threats' },
              ]
          const lines = categories.flatMap((category: any) => {
            const entries = ((((value as Record<string, unknown>)[category.id]) || []) as any[])
              .map((item) => String(item?.text || '').trim())
              .filter(Boolean)
            return entries.length > 0 ? [`${category.label}:`, ...entries.map((entry) => `• ${entry}`)] : []
          })
          if (!lines.length) return
          drawPdfCard(getBlockDisplayLabel(block), lines)
          return
        }

        if (block.type === 'checklist') {
          const lines = (Array.isArray(value) ? value : []).map((item) => `• ${String(item)}`)
          if (!lines.length) return
          drawPdfCard(getBlockDisplayLabel(block), lines)
          return
        }

        drawPdfCard(getBlockDisplayLabel(block), [formatBlockValue(block, value)])
      })
    })

    pdf.save(`${definition.id}-response.pdf`)
  }

  const handleBackToBuilder = () => {
    if (previewMode && window.opener && !window.opener.closed) {
      window.close()
      return
    }

    navigate('/builder')
  }

  const closeCompletionDialog = useCallback(() => {
    setShowCompletionDialog(false)
  }, [])

  const handleReturnToStart = () => {
    setShowCompletionDialog(false)
    navigate('/')
  }

  if (!currentPage || totalPages === 0) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-slate-700">
        This worksheet has no pages.
      </main>
    )
  }

  const progress = totalPages > 0 ? ((currentVisiblePageIndex + 1) / totalPages) * 100 : 0

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{definition.id}</p>
          <h1 className="text-3xl font-bold text-slate-900">{definition.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleReturnToStart} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><ArrowLeft className="h-4 w-4" />Back to start</button>
          {previewMode && (
            <button type="button" onClick={handleBackToBuilder} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><ArrowLeft className="h-4 w-4" />Back to builder</button>
          )}
          {!previewMode && !onlineWorksheetId && (
            <>
              <button onClick={handleStartNew} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><Play className="h-4 w-4" />Start New</button>
              {isResponseJsonExportEnabled(definition) && <button onClick={handleExportJson} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><FileUp className="h-4 w-4" />Download JSON</button>}
              {isResponsePdfExportEnabled(definition) && <button onClick={handleExportPdf} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"><FileText className="h-4 w-4" />Download PDF</button>}
            </>
          )}
          {onlineWorksheetId && <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-800"><CloudUpload className="h-4 w-4" />Online workbook{publicCode ? ` · ${publicCode}` : ''}</span>}
          {previewMode && <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">Preview mode</span>}
        </div>
      </header>

      {definition.settings.showProgress && (
        <div className="mb-6">
          <div className="mb-2 flex justify-between text-sm text-slate-600">
            <span>Page {currentVisiblePageIndex + 1} of {totalPages}</span>
            <span role="status">{status}</span>
          </div>
          {currentTimer?.enabled && (
            <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span className="inline-flex items-center gap-2 font-medium">
                <Clock3 className="h-4 w-4" />
                Time remaining
              </span>
              <span>{formatTimerValue(pageRemainingSeconds ?? currentTimer.durationSeconds)}</span>
            </div>
          )}
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {navigationWarning && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p className="font-medium">Required responses are still missing.</p>
          <p className="mt-1 whitespace-pre-line">{navigationWarning}</p>
        </div>
      )}
      {exportError && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {exportError}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(260px,1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold text-slate-900">{currentPage.title}</h2>
          {hasSubmittedOnlineResponse && (
            <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              This response has already been submitted and is now read-only.
            </div>
          )}
          <fieldset disabled={hasSubmittedOnlineResponse} className="space-y-6 disabled:opacity-75">
            {visibleBlocks.map((block) => (
              <div key={block.id} id={getBlockWrapperId(block.id)}>{renderBlock(block, responses, updateResponse, {
                showRequiredError: validationAttempted && missingRequiredBlockIds.has(block.id),
              })}</div>
            ))}
          </fieldset>

          <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4">
            <button onClick={handleBack} disabled={currentVisiblePageIndex <= 0} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Back</button>
            <button onClick={() => void handleNext()} disabled={status === 'Submitting…' || hasSubmittedOnlineResponse} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
              {status === 'Submitting…' ? 'Submitting…' : hasSubmittedOnlineResponse ? 'Submitted' : currentVisiblePageIndex === totalPages - 1 ? onlineWorksheetId ? 'Submit' : 'Finish' : 'Next'}
            </button>
          </div>
        </section>

        <aside className="space-y-5 rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          {quizSummary.totalQuestions > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Quiz score</p>
              <p className="mt-2 text-2xl font-bold text-emerald-900">{quizSummary.totalScore}/{quizSummary.totalMax}</p>
              <p className="text-sm text-emerald-700">{formatQuizPercent(quizSummary.percent)}% correct</p>
            </div>
          )}

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-900">Progress snapshot</h3>
            <ul className="space-y-2 text-sm text-slate-700">
              {visiblePages.map((page, visibleIndex) => {
                const index = definition.pages.indexOf(page)
                const isFutureJumpDisabled = isRestrictedNavigation && visibleIndex > currentVisiblePageIndex + 1
                return (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => goToPage(index)}
                    disabled={isFutureJumpDisabled}
                    aria-current={index === pageIndex ? 'page' : undefined}
                    title={isFutureJumpDisabled ? buildPageJumpingWarning() : undefined}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 ${index === pageIndex ? 'bg-blue-100 text-blue-900' : 'bg-white text-slate-700 hover:bg-slate-100 disabled:hover:bg-white'}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {page.title}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs">
                      {visibleIndex + 1}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                </li>
              )})}
            </ul>
          </div>
        </aside>
      </div>

      <ModalOverlay isOpen={showCompletionDialog} onClose={closeCompletionDialog} labelledBy="completion-dialog-title">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Worksheet complete</p>
            <h2 id="completion-dialog-title" className="mt-2 text-2xl font-bold text-slate-900">{onlineWorksheetId ? 'Your response has been submitted' : 'Your response has been exported'}</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{completionMessage}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleReturnToStart}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              >
                Back to start
              </button>
              <button
                type="button"
                data-modal-initial-focus
                onClick={closeCompletionDialog}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
      </ModalOverlay>
    </main>
  )
}

function RadarBlock({ block, responses, updateResponse, showRequiredError = false }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void; showRequiredError?: boolean }) {
  const dimensions = getLabeledConfigItems(block.config?.dimensions, 'dimension')
  const valueMap: Record<string, number> = responses[block.id] || {}
  const { min, max } = getNumericRange(block.config, 1, 10)
  const radius = 100
  const center = 150
  const scores = dimensions.map((dimension, index) => {
    const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
    const value = numberInRange(valueMap[dimension.id] ?? valueMap[dimension.label], min, max) ?? Math.round((min + max) / 2)
    const distance = (value / 10) * radius
    return `${center + Math.cos(angle) * distance},${center + Math.sin(angle) * distance}`
  })

  return (
    <div className={`space-y-4 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`} aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
      <h3 className="text-lg font-semibold text-slate-900"><BlockFieldLabel block={block} /></h3>
      <svg viewBox="0 0 300 300" className="mx-auto h-80 w-full max-w-md rounded-2xl bg-slate-50 p-4">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((ring) => {
          const r = (ring / 10) * 100
          const points = Array.from({ length: dimensions.length }, (_, index) => {
            const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
            const x = center + Math.cos(angle) * r
            const y = center + Math.sin(angle) * r
            return `${x},${y}`
          }).join(' ')
          return <polygon key={ring} points={points} fill="none" stroke="#cbd5e1" strokeWidth="1" />
        })}

        {dimensions.map((dimension, index: number) => {
          const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
          const x = center + Math.cos(angle) * 120
          const y = center + Math.sin(angle) * 120
          return (
            <g key={dimension.id}>
              <line x1={center} y1={center} x2={x} y2={y} stroke="#cbd5e1" strokeWidth="1" />
              <text x={center + Math.cos(angle) * 138} y={center + Math.sin(angle) * 138} textAnchor="middle" fontSize="9" fill="#334155">{dimension.label}</text>
            </g>
          )
        })}
        <polygon points={scores.join(' ')} fill="rgba(59,130,246,0.35)" stroke="#2563eb" strokeWidth="2" />
      </svg>

      <div className="space-y-3">
        {dimensions.map((dimension) => {
          const value = numberInRange(valueMap[dimension.id] ?? valueMap[dimension.label], min, max) ?? Math.round((min + max) / 2)
          return (
            <div key={dimension.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">{dimension.label}</span>
                <span className="font-bold text-slate-900">{value}/10</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={value}
                aria-label={`${block.label || 'Radar score'}: ${dimension.label}`}
                aria-required={block.required ? true : undefined}
                onChange={(event) => {
                  const next = { ...(responses[block.id] || {}), [dimension.id]: Number(event.target.value) }
                  updateResponse(block.id, next)
                }}
                className="w-full"
              />
            </div>
          )
        })}
      </div>
      {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">This response is required.</p>}
    </div>
  )
}

function SwotBoard({ block, responses, updateResponse, showRequiredError = false }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void; showRequiredError?: boolean }) {
  const columns = block.config?.categories || []
  const notesState = responses[block.id] || Object.fromEntries(columns.map((column: any) => [column.id, []]))
  const [dragItem, setDragItem] = useState<{ noteId: string; fromColumn: string } | null>(null)

  const addNote = (columnId: string) => {
    const label = window.prompt('Add a note')
    if (!label) return
    const next = { ...notesState }
    next[columnId] = [...(next[columnId] || []), { id: crypto.randomUUID(), text: label.trim() }]
    updateResponse(block.id, next)
  }

  const removeNote = (columnId: string, noteId: string) => {
    const next = { ...notesState }
    next[columnId] = (next[columnId] || []).filter((note: any) => note.id !== noteId)
    updateResponse(block.id, next)
  }

  const moveNote = (noteId: string, fromColumn: string, toColumn: string) => {
    const next = { ...notesState }
    const target = (next[fromColumn] || []).find((note: any) => note.id === noteId)
    if (!target) return
    next[fromColumn] = (next[fromColumn] || []).filter((note: any) => note.id !== noteId)
    next[toColumn] = [...(next[toColumn] || []), target]
    updateResponse(block.id, next)
  }

  return (
    <div className={`space-y-4 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`} aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
      <h3 className="text-lg font-semibold text-slate-900"><BlockFieldLabel block={block} /></h3>
      <div className="grid gap-4 md:grid-cols-2">
        {columns.map((column: any) => (
          <div
            key={column.id}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!dragItem) return
              moveNote(dragItem.noteId, dragItem.fromColumn, column.id)
              setDragItem(null)
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-semibold text-slate-800">{column.label}</h4>
              <button type="button" onClick={() => addNote(column.id)} className="rounded-full bg-slate-900 px-2 py-1 text-xs text-white">Add</button>
            </div>
            <div className="space-y-2">
              {(notesState[column.id] || []).map((note: any) => (
                <div
                  key={note.id}
                  draggable
                  onDragStart={() => setDragItem({ noteId: note.id, fromColumn: column.id })}
                  className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-slate-700"
                >
                  <p>{note.text}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {columns.filter((item: any) => item.id !== column.id).map((item: any) => (
                      <button key={item.id} type="button" onClick={() => moveNote(note.id, column.id, item.id)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] uppercase text-slate-700">
                        Move to {item.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => removeNote(column.id, note.id)} className="rounded-md bg-red-100 px-2 py-1 text-[10px] uppercase text-red-700">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Add at least one note for this required item.</p>}
    </div>
  )
}

function QuadrantBoard({ block, responses, updateResponse, showRequiredError = false }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void; showRequiredError?: boolean }) {
  const defaultValue = responses[block.id] || { x: 55, y: 55, rationale: '' }
  const x = Number(defaultValue.x ?? 50)
  const y = Number(defaultValue.y ?? 50)
  const [isDragging, setIsDragging] = useState(false)

  const updatePointFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    const next = mapCanvasPointToQuadrant(px, py)
    updateResponse(block.id, { ...defaultValue, x: next.x, y: next.y })
  }

  return (
    <div className={`space-y-4 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`} aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
      <h3 className="text-lg font-semibold text-slate-900"><BlockFieldLabel block={block} /></h3>
      <p className="text-sm text-slate-600">{block.config?.instructions || 'Place the tool in the space that best represents its value and risk.'}</p>
      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <svg
            viewBox="0 0 400 400"
            className={`h-80 w-full touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
            onPointerDown={(event) => {
              setIsDragging(true)
              event.currentTarget.setPointerCapture(event.pointerId)
              updatePointFromEvent(event)
            }}
            onPointerMove={(event) => {
              if (!isDragging) return
              updatePointFromEvent(event)
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              setIsDragging(false)
              updatePointFromEvent(event)
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              setIsDragging(false)
            }}
            onPointerLeave={() => {
              if (!isDragging) return
              setIsDragging(false)
            }}
          >
            <rect x="0" y="0" width="400" height="400" fill="#f8fafc" />
            <line x1="200" y1="0" x2="200" y2="400" stroke="#cbd5e1" strokeWidth="2" />
            <line x1="0" y1="200" x2="400" y2="200" stroke="#cbd5e1" strokeWidth="2" />
            <text x="20" y="195" fontSize="13" fill="#475569">{block.config?.xLeft || 'Left'}</text>
            <text x="330" y="195" fontSize="13" fill="#475569">{block.config?.xRight || 'Right'}</text>
            <text x="185" y="390" fontSize="13" fill="#475569">{block.config?.yBottom || 'Bottom'}</text>
            <text x="185" y="22" fontSize="13" fill="#475569">{block.config?.yTop || 'Top'}</text>
            <circle
              cx={(x / 100) * 400}
              cy={400 - (y / 100) * 400}
              r={isDragging ? 11 : 9}
              fill="#2563eb"
              style={{ transition: 'cx 90ms linear, cy 90ms linear, r 120ms ease' }}
            />
          </svg>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Horizontal position</span>
            <input type="range" min={0} max={100} value={x} aria-required={block.required ? true : undefined} onChange={(event) => updateResponse(block.id, { ...defaultValue, x: Number(event.target.value) })} className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Vertical position</span>
            <input type="range" min={0} max={100} value={y} aria-required={block.required ? true : undefined} onChange={(event) => updateResponse(block.id, { ...defaultValue, y: Number(event.target.value) })} className="w-full" />
          </label>
          <textarea
            value={defaultValue.rationale || ''}
            aria-required={block.config?.rationaleRequired ? true : undefined}
            onChange={(event) => updateResponse(block.id, { ...defaultValue, rationale: event.target.value })}
            className="min-h-28 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
            placeholder="Why did you place the tool here?"
          />
        </div>
      </div>
      {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Place the point and complete any required rationale.</p>}
    </div>
  )
}

function isYouTubeUrl(value: string) {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')
  } catch {
    return false
  }
}

function getYouTubeEmbedUrl(value: string) {
  if (!value) return ''
  try {
    const parsed = new URL(value)
    if (parsed.hostname.includes('youtu.be')) {
      const id = parsed.pathname.replace('/', '')
      return `https://www.youtube.com/embed/${id}`
    }
    const videoId = parsed.searchParams.get('v')
    if (videoId) return `https://www.youtube.com/embed/${videoId}`
  } catch {
    return ''
  }
  return ''
}

function SpinWheelDisplay({
  items,
  spinToken,
  targetIndex,
  durationMs,
  onRest,
}: {
  items: string[]
  spinToken: number
  targetIndex: number | null
  durationMs: number
  onRest: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wheelRef = useRef<CanvasWheel | null>(null)
  const onRestRef = useRef(onRest)

  onRestRef.current = onRest

  useEffect(() => {
    if (!containerRef.current) return

    const wheel = new CanvasWheel(containerRef.current, {
      items: items.map((item, index) => ({
        label: item,
        backgroundColor: WHEEL_SEGMENT_COLORS[index % WHEEL_SEGMENT_COLORS.length],
        labelColor: '#ffffff',
      })),
      isInteractive: false,
      radius: 0.92,
      itemLabelRadius: 0.72,
      itemLabelRadiusMax: 0.32,
      itemLabelAlign: 'right',
      itemLabelBaselineOffset: -0.12,
      itemLabelFont: 'Arial',
      itemLabelFontSizeMax: 22,
      itemLabelStrokeColor: 'rgba(15,23,42,0.35)',
      itemLabelStrokeWidth: 1,
      lineColor: '#1e3a8a',
      lineWidth: 2,
      borderColor: '#1e3a8a',
      borderWidth: 8,
      pixelRatio: 2,
      pointerAngle: 0,
      onRest: () => onRestRef.current(),
    })

    wheelRef.current = wheel

    return () => {
      wheel.remove()
      wheelRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!wheelRef.current) return

    wheelRef.current.items = items.map((item, index) => ({
      label: item,
      backgroundColor: WHEEL_SEGMENT_COLORS[index % WHEEL_SEGMENT_COLORS.length],
      labelColor: '#ffffff',
    }))
  }, [items])

  useEffect(() => {
    if (!wheelRef.current || targetIndex === null || spinToken === 0 || targetIndex < 0 || targetIndex >= items.length) return

    wheelRef.current.spinToItem(
      targetIndex,
      durationMs,
      true,
      Math.max(5, Math.ceil(durationMs / 700)),
      1,
    )
  }, [durationMs, items.length, spinToken, targetIndex])

  return (
    <div className="relative flex h-64 w-64 items-center justify-center">
      <div className="absolute -top-4 z-30 h-0 w-0 border-x-[18px] border-b-[28px] border-t-0 border-x-transparent border-b-amber-400 drop-shadow-[0_6px_8px_rgba(180,83,9,0.4)]" />
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,#60a5fa_0%,#2563eb_45%,#1e3a8a_72%,#0f172a_100%)] shadow-[0_18px_45px_rgba(15,23,42,0.35)]" />
      {Array.from({ length: Math.max(10, Math.min(24, items.length * 2)) }).map((_, index, source) => {
        const angle = ((Math.PI * 2) / source.length) * index - (Math.PI / 2)
        const x = Math.cos(angle) * 116
        const y = Math.sin(angle) * 116

        return (
          <span
            key={`wheel-light-${index}`}
            className="absolute z-20 h-2.5 w-2.5 rounded-full bg-yellow-100 shadow-[0_0_10px_rgba(254,240,138,0.95)]"
            style={{ left: `calc(50% + ${x}px - 5px)`, top: `calc(50% + ${y}px - 5px)` }}
          />
        )
      })}
      <div className="absolute inset-[18px] z-10 overflow-hidden rounded-full border-[10px] border-white/15 shadow-inner">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <div className="absolute z-20 flex h-20 w-20 items-center justify-center rounded-full border-4 border-blue-200 bg-blue-950 text-sm font-black uppercase tracking-[0.18em] text-white shadow-[0_10px_25px_rgba(15,23,42,0.4)]">
        Spin
      </div>
    </div>
  )
}

function getBlockAudience(block: WorksheetBlock): 'student' | 'staff' {
  if (block.type === 'url' && block.config?.audience === 'staff') {
    return 'staff'
  }

  return 'student'
}

function RichTextSurface({
  value,
  onChange,
  placeholder,
  editable = true,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  editable?: boolean
  ariaLabel?: string
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      LinkExtension.configure({
        autolink: true,
        defaultProtocol: 'https',
        HTMLAttributes: {
          class: 'text-blue-600 underline underline-offset-2',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
        openOnClick: false,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: value || '',
    editable,
    editorProps: {
      attributes: ariaLabel ? { 'aria-label': ariaLabel } : {},
    },
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(normalizeRichTextResponse(editor.getHTML()))
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
  }, [editable, editor])

  useEffect(() => {
    if (!editor) return
    const currentHtml = editor.getHTML()
    const normalizedIncoming = value || ''
    if (currentHtml === normalizedIncoming) return
    editor.commands.setContent(normalizedIncoming || '<p></p>', { emitUpdate: false })
  }, [editor, value])

  if (!editor) {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="min-h-40 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-400">Loading editor...</div>
      </div>
    )
  }

  const inlineActions = [
    { label: 'Bold', shortLabel: 'B', run: () => editor.chain().focus().toggleBold().run(), isActive: editor.isActive('bold'), canRun: editor.can().chain().focus().toggleBold().run() },
    { label: 'Italic', shortLabel: 'I', run: () => editor.chain().focus().toggleItalic().run(), isActive: editor.isActive('italic'), canRun: editor.can().chain().focus().toggleItalic().run() },
    { label: 'Strike', shortLabel: 'S', run: () => editor.chain().focus().toggleStrike().run(), isActive: editor.isActive('strike'), canRun: editor.can().chain().focus().toggleStrike().run() },
    { label: 'Inline code', shortLabel: '</>', run: () => editor.chain().focus().toggleCode().run(), isActive: editor.isActive('code'), canRun: editor.can().chain().focus().toggleCode().run() },
  ]

  const blockActions = [
    { label: 'Paragraph', run: () => editor.chain().focus().setParagraph().run(), isActive: editor.isActive('paragraph'), canRun: editor.can().chain().focus().setParagraph().run() },
    { label: 'H2', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: editor.isActive('heading', { level: 2 }), canRun: editor.can().chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'H3', run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: editor.isActive('heading', { level: 3 }), canRun: editor.can().chain().focus().toggleHeading({ level: 3 }).run() },
    { label: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run(), isActive: editor.isActive('blockquote'), canRun: editor.can().chain().focus().toggleBlockquote().run() },
    { label: 'Code block', run: () => editor.chain().focus().toggleCodeBlock().run(), isActive: editor.isActive('codeBlock'), canRun: editor.can().chain().focus().toggleCodeBlock().run() },
  ]

  const listActions = [
    { label: 'Bullet list', shortLabel: '��� List', run: () => editor.chain().focus().toggleBulletList().run(), isActive: editor.isActive('bulletList'), canRun: editor.can().chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', shortLabel: '1. List', run: () => editor.chain().focus().toggleOrderedList().run(), isActive: editor.isActive('orderedList'), canRun: editor.can().chain().focus().toggleOrderedList().run() },
  ]

  const historyActions = [
    { label: 'Undo', run: () => editor.chain().focus().undo().run(), canRun: editor.can().chain().focus().undo().run() },
    { label: 'Redo', run: () => editor.chain().focus().redo().run(), canRun: editor.can().chain().focus().redo().run() },
  ]

  const handleSetLink = () => {
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const nextUrl = window.prompt('Enter a URL', previousUrl || 'https://')
    if (nextUrl === null) return

    const trimmedUrl = nextUrl.trim()
    if (!trimmedUrl) {
      editor.chain().focus().unsetLink().run()
      return
    }

    const normalizedUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
    editor.chain().focus().extendMarkRange('link').setLink({ href: normalizedUrl }).run()
  }

  const linkActions = [
    { label: 'Link', run: handleSetLink, isActive: editor.isActive('link') },
    { label: 'Unlink', run: () => editor.chain().focus().unsetLink().run(), isActive: false, disabled: !editor.isActive('link') },
  ]

  const alignmentActions = [
    { label: 'Left', run: () => editor.chain().focus().setTextAlign('left').run(), isActive: editor.isActive({ textAlign: 'left' }) },
    { label: 'Center', run: () => editor.chain().focus().setTextAlign('center').run(), isActive: editor.isActive({ textAlign: 'center' }) },
    { label: 'Right', run: () => editor.chain().focus().setTextAlign('right').run(), isActive: editor.isActive({ textAlign: 'right' }) },
  ]

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      {editable && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {inlineActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.run}
                disabled={!action.canRun}
                title={action.label}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${action.isActive ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
              >
                {action.shortLabel}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {blockActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.run}
                disabled={!action.canRun}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${action.isActive ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2">
            {linkActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.run}
                disabled={action.disabled}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${action.isActive ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
              >
                {action.label}
              </button>
            ))}
            {alignmentActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.run}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${action.isActive ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
            <div className="flex flex-wrap gap-2">
              {listActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.run}
                  disabled={!action.canRun}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${action.isActive ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
                >
                  {action.shortLabel}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {historyActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.run}
                  disabled={!action.canRun}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="relative">
        {!value && editable && (
          <p className="pointer-events-none absolute left-3 top-3 z-10 text-sm text-slate-400">{placeholder}</p>
        )}
        <div className={`min-h-40 rounded-xl border bg-white px-3 py-2.5 text-slate-800 transition ${editable ? 'border-slate-300 focus-within:border-blue-500' : 'border-slate-200'} [&_.ProseMirror]:min-h-32 [&_.ProseMirror]:outline-none [&_.ProseMirror_a]:text-blue-600 [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:underline-offset-2 [&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-slate-300 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:italic [&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-slate-100 [&_.ProseMirror_code]:px-1.5 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:text-2xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h3]:mb-3 [&_.ProseMirror_h3]:mt-4 [&_.ProseMirror_h3]:text-xl [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_p]:mb-3 [&_.ProseMirror_p:last-child]:mb-0 [&_.ProseMirror_pre]:overflow-x-auto [&_.ProseMirror_pre]:rounded-lg [&_.ProseMirror_pre]:bg-slate-900 [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_pre]:text-slate-100 [&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6`}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

function RichTextEditorBlock({ block, responses, updateResponse, showRequiredError = false }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void; showRequiredError?: boolean }) {
  const mode = block.config?.mode === 'information' ? 'information' : 'response'

  if (mode === 'information') {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div>
          <p className="text-sm font-medium text-slate-700">{block.label}</p>
          {block.description && <p className="mt-1 text-xs text-slate-500">{block.description}</p>}
        </div>
        <RichTextSurface
          value={block.config?.contentHtml || '<p>Add rich text information for students here.</p>'}
          onChange={() => {}}
          placeholder="Add rich text information for students here."
          editable={false}
        />
      </div>
    )
  }

  const currentValue = typeof responses[block.id] === 'string' ? normalizeRichTextResponse(responses[block.id]) : ''

  return (
    <div className={`space-y-3 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-slate-50'}`} aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
      <div>
        <p className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></p>
        {block.description && <p className="mt-1 text-xs text-slate-500">{block.description}</p>}
      </div>
      <RichTextSurface
        value={currentValue}
        onChange={(value) => updateResponse(block.id, value)}
        placeholder={block.config?.placeholder || 'Write and format your response here.'}
        ariaLabel={block.label || 'Rich text response'}
        editable
      />
      {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">This response is required.</p>}
    </div>
  )
}

function RandomizerBlock({ block, responses, updateResponse, showRequiredError = false }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void; showRequiredError?: boolean }) {
  const configuredItems = block.config?.items
  const items = useMemo(
    () => Array.isArray(configuredItems) ? configuredItems.filter((item: unknown) => typeof item === 'string' && item.trim()) : [],
    [configuredItems],
  )
  const prompt = block.config?.prompt || 'Generate a random item from this list.'
  const currentValue = responses[block.id]
  const requireFirstGeneration = Boolean(block.config?.requireFirstGeneration)
  const configuredDisplayStyle = block.config?.displayStyle as 'word-flicker' | 'wheel' | 'card-shuffle' | undefined
  const displayStyle: 'word-flicker' | 'wheel' | 'card-shuffle' = configuredDisplayStyle === 'wheel' || configuredDisplayStyle === 'card-shuffle' || configuredDisplayStyle === 'word-flicker'
    ? configuredDisplayStyle
    : 'word-flicker'
  const animationDurationMs = normalizeRandomizerAnimationDuration(block.config?.animationDurationMs)
  const hasCurrentValue = typeof currentValue === 'string' && items.includes(String(currentValue))
  const isLocked = requireFirstGeneration && hasCurrentValue
  const [displayValue, setDisplayValue] = useState<string>(currentValue ?? '')
  const [isAnimating, setIsAnimating] = useState(false)
  const [wheelSpinToken, setWheelSpinToken] = useState(0)
  const [wheelTargetIndex, setWheelTargetIndex] = useState<number | null>(null)
  const [pendingWheelValue, setPendingWheelValue] = useState<string | null>(null)
  const [cardDeckItems, setCardDeckItems] = useState<string[]>(items)
  const [cardPhase, setCardPhase] = useState<'preview' | 'flipping' | 'choosing' | 'revealed'>('preview')
  const [revealedCardIndex, setRevealedCardIndex] = useState<number | null>(null)
  const animatedIntervalRef = useRef<number | null>(null)
  const animatedTimeoutRef = useRef<number | null>(null)
  const cardTimeoutRef = useRef<number | null>(null)

  const clearAnimatedTimers = useCallback(() => {
    if (animatedIntervalRef.current !== null) {
      window.clearInterval(animatedIntervalRef.current)
      animatedIntervalRef.current = null
    }
    if (animatedTimeoutRef.current !== null) {
      window.clearTimeout(animatedTimeoutRef.current)
      animatedTimeoutRef.current = null
    }
  }, [])

  const clearCardTimer = useCallback(() => {
    if (cardTimeoutRef.current !== null) {
      window.clearTimeout(cardTimeoutRef.current)
      cardTimeoutRef.current = null
    }
  }, [])

  const cardCanPick = cardPhase === 'choosing'
  const cardHasGenerated = cardPhase !== 'preview'

  const generateAnimatedValue = useCallback(() => {
    if (!items.length) return

    clearAnimatedTimers()
    const nextValue = block.config?.shuffle === false ? items[0] : selectRandomItem(items)
    if (!nextValue) return
    const rollingIntervalMs = Math.max(80, Math.min(140, Math.round(animationDurationMs / 14)))

    setIsAnimating(true)
    const timer = window.setInterval(() => {
      const rollingItem = selectRandomItem(items) || nextValue
      setDisplayValue(rollingItem)
    }, rollingIntervalMs)
    animatedIntervalRef.current = timer

    animatedTimeoutRef.current = window.setTimeout(() => {
      clearAnimatedTimers()
      setDisplayValue(nextValue)
      setIsAnimating(false)
      updateResponse(block.id, nextValue)
    }, animationDurationMs)
  }, [animationDurationMs, block.config?.shuffle, block.id, clearAnimatedTimers, items, updateResponse])

  const generateWheelValue = useCallback(() => {
    if (!items.length) return

    const nextValue = block.config?.shuffle === false ? items[0] : selectRandomItem(items)
    if (!nextValue) return
    const nextIndex = items.indexOf(nextValue)
    if (nextIndex < 0) return

    setDisplayValue('')
    setPendingWheelValue(nextValue)
    setWheelTargetIndex(nextIndex)
    setIsAnimating(true)
    setWheelSpinToken((previous) => previous + 1)
  }, [block.config?.shuffle, items])

  const beginCardShuffle = useCallback(() => {
    if (!items.length) return

    clearCardTimer()
    const deckItems = block.config?.shuffle === false ? [...items] : shuffleRandomizerItems(items)
    setCardPhase('flipping')
    setRevealedCardIndex(null)
    setDisplayValue('')
    setCardDeckItems(deckItems)
    setIsAnimating(true)

    cardTimeoutRef.current = window.setTimeout(() => {
      cardTimeoutRef.current = null
      setIsAnimating(false)
      setCardPhase('choosing')
    }, animationDurationMs)
  }, [animationDurationMs, block.config?.shuffle, clearCardTimer, items])

  useEffect(() => {
    return () => {
      clearAnimatedTimers()
      clearCardTimer()
    }
  }, [clearAnimatedTimers, clearCardTimer])

  const handleGenerateClick = useCallback(() => {
    if (!items.length || isAnimating || isLocked) return

    if (displayStyle === 'wheel') {
      generateWheelValue()
      return
    }

    if (displayStyle === 'card-shuffle') {
      beginCardShuffle()
      return
    }

    generateAnimatedValue()
  }, [beginCardShuffle, displayStyle, generateAnimatedValue, generateWheelValue, isAnimating, isLocked, items.length])

  const handleWheelRest = useCallback(() => {
    if (!pendingWheelValue) return

    setDisplayValue(pendingWheelValue)
    setIsAnimating(false)
    updateResponse(block.id, pendingWheelValue)
    setPendingWheelValue(null)
  }, [block.id, pendingWheelValue, updateResponse])

  useEffect(() => {
    if (!isAnimating || !pendingWheelValue || displayStyle !== 'wheel') return undefined

    const fallbackTimer = window.setTimeout(() => {
      handleWheelRest()
    }, animationDurationMs + 200)

    return () => {
      window.clearTimeout(fallbackTimer)
    }
  }, [animationDurationMs, displayStyle, handleWheelRest, isAnimating, pendingWheelValue])

  const handleCardPick = useCallback((cardIndex: number) => {
    if (!cardCanPick || isAnimating || isLocked) return

    const nextValue = cardDeckItems[cardIndex]
    if (!nextValue) return

    setCardPhase('revealed')
    setRevealedCardIndex(cardIndex)
    setDisplayValue(nextValue)
    updateResponse(block.id, nextValue)
  }, [block.id, cardCanPick, cardDeckItems, isAnimating, isLocked, updateResponse])

  useEffect(() => {
    if (!items.length) {
      clearAnimatedTimers()
      clearCardTimer()
      setDisplayValue('')
      setIsAnimating(false)
      setWheelTargetIndex(null)
      setPendingWheelValue(null)
      setCardDeckItems([])
      setCardPhase('preview')
      setRevealedCardIndex(null)
      return
    }

    if (displayStyle === 'wheel' && (isAnimating || pendingWheelValue)) {
      return
    }

    if (currentValue === undefined || currentValue === null || !items.includes(String(currentValue))) {
      setCardDeckItems(items)
      setDisplayValue('')
      setWheelTargetIndex(null)
      setPendingWheelValue(null)
      setCardPhase('preview')
      setRevealedCardIndex(null)
      setIsAnimating(false)
      return
    }

    setDisplayValue(String(currentValue))
    setIsAnimating(false)
    if (displayStyle === 'card-shuffle') {
      if (cardDeckItems.length !== items.length || !items.every((item) => cardDeckItems.includes(item))) {
        setCardDeckItems(items)
      }
      setCardPhase('revealed')
      setRevealedCardIndex(cardDeckItems.indexOf(String(currentValue)))
      return
    }

    setCardDeckItems(items)
  }, [clearAnimatedTimers, clearCardTimer, currentValue, displayStyle, isAnimating, items, pendingWheelValue])

  const displayClasses = isAnimating
    ? {
        'word-flicker': 'animate-pulse text-blue-700',
        wheel: 'tracking-[0.2em] text-blue-700',
        'card-shuffle': 'text-blue-700',
      }[displayStyle]
    : 'text-blue-900'

  const displayStyles: Record<string, React.CSSProperties> = {
    'word-flicker': {
      transition: 'all 0.12s ease',
      filter: isAnimating ? 'blur(0.5px)' : 'none',
      animation: isAnimating ? 'word-flicker 0.16s steps(2, end) infinite' : 'none',
    },
    'card-shuffle': {
      transition: 'transform 0.2s ease',
      transform: isAnimating ? 'rotate(-8deg) translateY(-2px)' : 'rotate(0deg) translateY(0)',
      animation: isAnimating ? 'card-shuffle 0.12s ease-in-out infinite alternate' : 'none',
    },
  }

  const generateButtonLabel = displayStyle === 'card-shuffle'
    ? (hasCurrentValue ? 'Shuffle again' : 'Generate')
    : (hasCurrentValue ? 'Generate again' : 'Generate')

  const getCardSlotStyle = (index: number): React.CSSProperties => {
    const totalCards = Math.max(1, cardDeckItems.length)
    const centerOffset = index - ((totalCards - 1) / 2)
    const previewLeft = centerOffset * 78
    const previewTop = Math.abs(centerOffset) * 6
    const shuffledLeft = centerOffset * 44
    const shuffledTop = Math.abs(centerOffset) * 3
    const rotation = cardPhase === 'preview' ? centerOffset * 5 : centerOffset * 9
    const lift = cardPhase === 'revealed' && revealedCardIndex === index ? -18 : 0

    return {
      left: `calc(50% + ${(cardPhase === 'preview' ? previewLeft : shuffledLeft)}px - 56px)`,
      top: `calc(50% - 80px + ${(cardPhase === 'preview' ? previewTop : shuffledTop)}px)`,
      transform: `translateY(${lift}px) rotate(${rotation}deg) scale(${cardPhase === 'revealed' && revealedCardIndex === index ? 1.06 : 1})`,
      transition: `left ${Math.max(250, animationDurationMs * 0.45)}ms cubic-bezier(0.22, 1, 0.36, 1), top ${Math.max(250, animationDurationMs * 0.45)}ms cubic-bezier(0.22, 1, 0.36, 1), transform 260ms ease`,
      zIndex: cardPhase === 'revealed' && revealedCardIndex === index ? 50 : Math.round(20 - Math.abs(centerOffset)),
      animation: isAnimating ? `${index % 3 === 0 ? 'card-shuffle-left' : index % 3 === 1 ? 'card-shuffle-center' : 'card-shuffle-right'} 0.4s ease-in-out ${index * 40}ms infinite alternate` : 'none',
    }
  }

  return (
    <>
      <style>{`
        @keyframes word-flicker {
          0% { opacity: 0.7; transform: scale(0.98); }
          50% { opacity: 1; transform: scale(1.04); }
          100% { opacity: 0.8; transform: scale(0.99); }
        }

        @keyframes card-shuffle {
          0% { transform: translateX(-5px) rotate(-10deg) translateY(0px); }
          25% { transform: translateX(5px) rotate(8deg) translateY(-2px); }
          50% { transform: translateX(-4px) rotate(-6deg) translateY(1px); }
          75% { transform: translateX(4px) rotate(5deg) translateY(-1px); }
          100% { transform: translateX(0px) rotate(0deg) translateY(0px); }
        }

        @keyframes card-shuffle-left {
          0% { margin-left: 0px; margin-top: 0px; }
          50% { margin-left: 18px; margin-top: -12px; }
          100% { margin-left: -22px; margin-top: 8px; }
        }

        @keyframes card-shuffle-center {
          0% { margin-left: 0px; margin-top: 0px; }
          50% { margin-left: -16px; margin-top: -16px; }
          100% { margin-left: 14px; margin-top: 10px; }
        }

        @keyframes card-shuffle-right {
          0% { margin-left: 0px; margin-top: 0px; }
          50% { margin-left: 20px; margin-top: -10px; }
          100% { margin-left: -16px; margin-top: 6px; }
        }
      `}</style>
      <div className={`space-y-3 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-slate-50'}`} aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></p>
          {prompt && <p className="mt-1 text-xs text-slate-500">{prompt}</p>}
        </div>
        <button
          type="button"
          onClick={handleGenerateClick}
          disabled={!items.length || isAnimating || isLocked || (displayStyle === 'card-shuffle' && cardCanPick)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        >
          {generateButtonLabel}
        </button>
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-lg font-semibold text-blue-900">
        {displayStyle === 'wheel' ? (
          <div className="flex flex-col items-center gap-4" aria-live="polite">
            <SpinWheelDisplay items={items} spinToken={wheelSpinToken} targetIndex={wheelTargetIndex} durationMs={animationDurationMs} onRest={handleWheelRest} />
            <div className="w-full max-w-md rounded-2xl border border-blue-300 bg-white px-4 py-3 text-center shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Selected item</p>
              <p className="mt-2 min-h-8 text-lg font-bold text-slate-900">
                {displayValue
                  ? displayValue
                  : isAnimating
                    ? 'Spinning...'
                    : 'Click Generate to spin'}
              </p>
            </div>
          </div>
        ) : displayStyle === 'card-shuffle' ? (
          <div className="flex flex-col items-center gap-4" aria-live="polite">
            <div className="relative h-[26rem] w-full max-w-2xl overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_top,#dbeafe_0%,#bfdbfe_28%,#93c5fd_55%,#60a5fa_100%)] px-6 py-6 shadow-inner [perspective:1200px]">
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.35),transparent_45%,rgba(30,64,175,0.12))]" />
              {cardDeckItems.map((item, index) => {
                const isRevealed = !cardHasGenerated || revealedCardIndex === index
                const showCardBack = cardHasGenerated && !isRevealed

                return (
                  <button
                    type="button"
                    key={`${block.id}-deck-card-${index}-${item}`}
                    onClick={() => handleCardPick(index)}
                    disabled={!cardCanPick || isAnimating || isLocked}
                    className="absolute flex h-40 w-28 items-center justify-center rounded-2xl border border-blue-100/80 bg-transparent p-0 text-center text-xs font-bold uppercase tracking-[0.14em] text-blue-800 shadow-[0_18px_35px_rgba(30,64,175,0.22)] hover:z-[60] disabled:cursor-default"
                    style={getCardSlotStyle(index)}
                  >
                    <div
                      className="relative h-full w-full rounded-2xl [transform-style:preserve-3d]"
                      style={{
                        transform: showCardBack ? 'rotateY(180deg)' : 'rotateY(0deg)',
                        transition: `transform ${Math.max(320, animationDurationMs * 0.25)}ms ease`,
                      }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-blue-100/80 bg-white/95 p-3 [backface-visibility:hidden]">
                        <div className="absolute inset-2 rounded-xl border border-dashed border-blue-200/80" />
                        <span className="relative line-clamp-4">{item}</span>
                      </div>
                      <div className="absolute inset-0 rounded-2xl border border-blue-300/70 bg-[linear-gradient(145deg,#1d4ed8,#1e3a8a)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
                        <div className="absolute inset-2 rounded-xl border border-white/30" />
                        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-black uppercase tracking-[0.24em] text-white/80">Pick Me</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="min-h-12 min-w-64 rounded-xl border border-white/60 bg-white/80 px-4 py-2 text-center text-sm font-semibold text-blue-900 shadow-inner">
              {displayValue
                ? displayValue
                : isAnimating
                  ? 'Shuffling cards...'
                  : cardCanPick
                    ? 'Pick one card to reveal your result'
                    : 'Click Generate to turn the cards over and shuffle'}
            </div>
          </div>
        ) : (
          <div
            className={`inline-flex rounded-lg px-2 py-1 ${displayClasses}`}
            style={displayStyles[displayStyle]}
            aria-live="polite"
          >
            {displayValue || (isAnimating ? 'Generating...' : 'Click Generate to start')}
          </div>
        )}
      </div>
      {displayStyle === 'card-shuffle' && cardCanPick && (
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Choose one face-down card to lock in the result.</p>
      )}
      {requireFirstGeneration && (
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">The first generated value is locked in.</p>
      )}
      {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Please generate a result for this required item.</p>}
    </div>
    </>
  )
}

function clampHotspotPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

function HotspotBlock({ block, responses, updateResponse, showRequiredError = false }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void; showRequiredError?: boolean }) {
  const points = Array.isArray(responses[block.id]) ? responses[block.id] : []
  const lastPoint = points[points.length - 1]
  const [keyboardPoint, setKeyboardPoint] = useState(() => ({
    x: clampHotspotPercent(Number(lastPoint?.x ?? 50)),
    y: clampHotspotPercent(Number(lastPoint?.y ?? 50)),
  }))
  const [showKeyboardPoint, setShowKeyboardPoint] = useState(false)
  const statusId = `${block.id}-hotspot-status`
  const instructionId = `${block.id}-hotspot-instructions`

  const placePoint = (point: { x: number; y: number }) => {
    updateResponse(block.id, block.config?.allowMultiple ? [...points, point] : [point])
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></p>
      {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
      <div
        role="button"
        tabIndex={0}
        aria-describedby={`${instructionId} ${statusId}`}
        aria-label={`${getBlockDisplayLabel(block)} hotspot image`}
        className={`relative overflow-hidden rounded-xl border bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${showRequiredError ? 'border-red-300' : 'border-slate-200'}`}
        onFocus={() => setShowKeyboardPoint(true)}
        onBlur={() => setShowKeyboardPoint(false)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const point = { x: clampHotspotPercent(((event.clientX - rect.left) / rect.width) * 100), y: clampHotspotPercent(((event.clientY - rect.top) / rect.height) * 100) }
          setKeyboardPoint(point)
          placePoint(point)
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            placePoint(keyboardPoint)
            return
          }
          const deltas: Record<string, { x: number; y: number }> = {
            ArrowUp: { x: 0, y: -step },
            ArrowDown: { x: 0, y: step },
            ArrowLeft: { x: -step, y: 0 },
            ArrowRight: { x: step, y: 0 },
          }
          const delta = deltas[event.key]
          if (!delta) return
          event.preventDefault()
          setShowKeyboardPoint(true)
          setKeyboardPoint((current) => ({ x: clampHotspotPercent(current.x + delta.x), y: clampHotspotPercent(current.y + delta.y) }))
        }}
      >
        <img src={block.config?.imageUrl || ''} alt={block.config?.altText || block.label || 'Hotspot activity'} className="block h-auto min-h-48 w-full cursor-crosshair object-cover" />
        {points.map((point: any, index: number) => <span key={`${point.x}-${point.y}-${index}`} className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow" style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}
        {showKeyboardPoint && <span className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-700 bg-white/70 shadow" style={{ left: `${keyboardPoint.x}%`, top: `${keyboardPoint.y}%` }} />}
      </div>
      <p id={instructionId} className="text-xs text-slate-500">Click the image, or focus it and use arrow keys to move the target then Enter or Space to place a hotspot.</p>
      <div id={statusId} className="flex items-center justify-between text-xs text-slate-500"><span>{points.length ? `${points.length} hotspot${points.length === 1 ? '' : 's'} placed` : 'No hotspots placed.'}</span>{points.length > 0 && <button type="button" onClick={() => updateResponse(block.id, [])} className="font-medium text-blue-700">Clear</button>}</div>
      {showRequiredError && <p className="text-sm font-medium text-red-700">Place at least one hotspot to continue.</p>}
    </div>
  )
}

export function renderBlock(block: WorksheetBlock, responses: Record<string, any>, updateResponse: (blockId: string, value: any) => void, options?: { showRequiredError?: boolean }) {
  const showRequiredError = options?.showRequiredError ?? false

  switch (block.type) {
    case 'content':
      return (
        <div className="rounded-2xl bg-slate-50 p-4">
          {block.title && <h3 className="text-lg font-semibold text-slate-900">{block.title}</h3>}
          {block.description && <p className="mt-2 text-sm text-slate-600">{block.description}</p>}
        </div>
      )
    case 'richText':
      return <RichTextEditorBlock block={block} responses={responses} updateResponse={updateResponse} showRequiredError={showRequiredError} />
    case 'url':
      return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">{block.label || 'Open link'}</p>
            {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
            <a
              href={block.config?.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {block.config?.buttonText || 'Open link'}
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      )
    case 'shortText':
      return (
        <label className="block" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <span className="mb-2 block text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></span>
          {block.description && <p className="mb-2 text-xs text-slate-500">{block.description}</p>}
          <input
            value={responses[block.id] || ''}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            aria-required={block.required ? true : undefined}
            className={`w-full rounded-xl border bg-white px-3 py-2.5 text-slate-800 outline-none ring-0 transition focus:border-blue-500 ${showRequiredError ? 'border-red-300' : 'border-slate-300'}`}
            placeholder={block.config?.placeholder || 'Type here'}
          />
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="mt-2 text-sm font-medium text-red-700">This response is required.</p>}
        </label>
      )
    case 'longText':
      return (
        <label className="block" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <span className="mb-2 block text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></span>
          {block.description && <p className="mb-2 text-xs text-slate-500">{block.description}</p>}
          <textarea
            value={responses[block.id] || ''}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            aria-required={block.required ? true : undefined}
            className={`min-h-28 w-full rounded-xl border bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500 ${showRequiredError ? 'border-red-300' : 'border-slate-300'}`}
            placeholder={block.config?.placeholder || 'Write your response'}
          />
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="mt-2 text-sm font-medium text-red-700">This response is required.</p>}
        </label>
      )
    case 'singleSelect':
      {
      const options = getLabeledConfigItems(block.config?.options, 'option')
      return (
        <fieldset className="space-y-3" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <legend className="mb-2 block text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></legend>
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <input type="radio" name={block.id} aria-required={block.required ? true : undefined} checked={matchesOptionValue(responses[block.id], option)} onChange={() => updateResponse(block.id, option.id)} />
              <span>{option.label}</span>
            </label>
          ))}
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Choose one option to continue.</p>}
        </fieldset>
      )
      }
    case 'randomizer': {
      return <RandomizerBlock block={block} responses={responses} updateResponse={updateResponse} showRequiredError={showRequiredError} />
    }
    case 'multipleChoice':
    case 'quiz': {
      const allowMultiple = Boolean(block.config?.multipleAnswers)
      const selectedValues = allowMultiple ? getSelectedOptionValues(responses[block.id]) : responses[block.id]
      const correctAnswer = block.config?.correctAnswer
      const showFeedback = block.config?.showFeedback !== false
      const options = getLabeledConfigItems(block.config?.options, 'option')
      const correctValues = getSelectedOptionValues(correctAnswer)
      const isCorrectOption = (option: { id: string; label: string }) => correctValues.some((value) => matchesOptionValue(value, option))
      const selectedIds = allowMultiple ? getSelectedOptionValues(selectedValues) : getSelectedOptionValues(selectedValues)
      const correctIds = options.filter(isCorrectOption).map((option) => option.id)

      return (
        <fieldset className="space-y-3" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <legend className="mb-2 block text-sm font-medium text-slate-700">{block.label || block.config?.question || 'Quiz question'}</legend>
          {block.config?.question && <p className="text-sm text-slate-600">{block.config.question}</p>}
          {allowMultiple ? (
            options.map((option) => {
              const checked = selectedValues.some((value: unknown) => matchesOptionValue(value, option))
              const isCorrect = isCorrectOption(option)
              const isSelected = checked
              const showState = selectedValues !== undefined && isSelected
              return (
                <label key={option.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${showState && isCorrect ? 'border-emerald-300 bg-emerald-50' : showState && !isCorrect ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                  <input
                    type="checkbox"
                    aria-required={block.required ? true : undefined}
                    checked={checked}
                    onChange={() => {
                      const nextValues = Array.isArray(selectedValues) ? [...selectedValues] : []
                      const index = nextValues.findIndex((value) => matchesOptionValue(value, option))
                      if (index >= 0) nextValues.splice(index, 1)
                      else nextValues.push(option.id)
                      updateResponse(block.id, nextValues)
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              )
            })
          ) : (
            options.map((option) => {
              const isCorrect = isCorrectOption(option)
              const isSelected = matchesOptionValue(selectedValues, option)
              const showState = selectedValues !== undefined && isSelected
              return (
                <label key={option.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${showState && isCorrect ? 'border-emerald-300 bg-emerald-50' : showState && !isCorrect ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                  <input type="radio" name={block.id} aria-required={block.required ? true : undefined} checked={isSelected} onChange={() => updateResponse(block.id, option.id)} />
                  <span>{option.label}</span>
                </label>
              )
            })
          )}
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">{allowMultiple ? 'Select at least one answer to continue.' : 'Choose one answer to continue.'}</p>}
          {selectedValues !== undefined && showFeedback && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${JSON.stringify([...selectedIds].sort()) === JSON.stringify([...correctIds].sort()) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {JSON.stringify([...selectedIds].sort()) === JSON.stringify([...correctIds].sort()) ? 'Correct.' : `Incorrect. Correct answer: ${String(options.filter(isCorrectOption).map((option) => option.label).join(', ') || 'Not set')}.`}
              {block.config?.explanation && <p className="mt-2 text-sm text-slate-700">{block.config.explanation}</p>}
            </div>
          )}
        </fieldset>
      )
    }
    case 'trueFalse': {
      const selectedAnswer = responses[block.id]
      const correctAnswer = block.config?.correctAnswer
      const showFeedback = block.config?.showFeedback !== false
      return (
        <fieldset className="space-y-3" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <legend className="mb-2 block text-sm font-medium text-slate-700">{block.label || block.config?.question || 'True or false'}</legend>
          {block.config?.question && <p className="text-sm text-slate-600">{block.config.question}</p>}
          {['True', 'False'].map((option) => {
            const boolValue = option === 'True'
            const isCorrect = boolValue === correctAnswer
            const isSelected = selectedAnswer === boolValue
            const showState = selectedAnswer !== undefined && isSelected
            return (
              <label key={option} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${showState && isCorrect ? 'border-emerald-300 bg-emerald-50' : showState && !isCorrect ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <input type="radio" name={block.id} aria-required={block.required ? true : undefined} checked={selectedAnswer === boolValue} onChange={() => updateResponse(block.id, boolValue)} />
                <span>{option}</span>
              </label>
            )
          })}
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Choose true or false to continue.</p>}
          {selectedAnswer !== undefined && showFeedback && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${selectedAnswer === correctAnswer ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {selectedAnswer === correctAnswer ? 'Correct.' : `Incorrect. Correct answer: ${String(correctAnswer === true ? 'True' : 'False')}.`}
              {block.config?.explanation && <p className="mt-2 text-sm text-slate-700">{block.config.explanation}</p>}
            </div>
          )}
        </fieldset>
      )
    }
    case 'shortAnswer': {
      const selectedAnswer = String(responses[block.id] || '')
      const correctAnswer = String(block.config?.correctAnswer || '')
      const showFeedback = block.config?.showFeedback !== false
      const normalizedSelected = selectedAnswer.trim().toLowerCase()
      const normalizedCorrect = correctAnswer.trim().toLowerCase()
      return (
        <label className="block" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <span className="mb-2 block text-sm font-medium text-slate-700">{block.label || block.config?.question || 'Short answer'}</span>
          {block.config?.question && <p className="mb-2 text-xs text-slate-500">{block.config.question}</p>}
          <input
            value={selectedAnswer}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            aria-label={block.label || block.config?.question || 'Short answer'}
            aria-required={block.required ? true : undefined}
            className={`w-full rounded-xl border bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500 ${showRequiredError ? 'border-red-300' : 'border-slate-300'}`}
            placeholder={block.config?.placeholder || 'Type your answer'}
          />
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="mt-2 text-sm font-medium text-red-700">This response is required.</p>}
          {selectedAnswer && showFeedback && (
            <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${normalizedSelected === normalizedCorrect ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {normalizedSelected === normalizedCorrect ? 'Correct.' : `Incorrect. Correct answer: ${correctAnswer || 'Not set'}.`}
              {block.config?.explanation && <p className="mt-2 text-sm text-slate-700">{block.config.explanation}</p>}
            </div>
          )}
        </label>
      )
    }
    case 'matching': {
      const pairs = Array.isArray(block.config?.pairs) ? block.config.pairs : []
      const options = Array.isArray(block.config?.options) ? block.config.options : []
      const currentSelection = (responses[block.id] && typeof responses[block.id] === 'object') ? responses[block.id] : {}
      const correctAnswerMap = Object.fromEntries(pairs.map((pair: any, index: number) => [getMatchingPairKey(pair, index), String(pair.answer ?? '')]))
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">{block.label}</p>
          {pairs.map((pair: any, index: number) => {
            const pairKey = getMatchingPairKey(pair, index)
            const selected = currentSelection[pairKey] ?? ''
            return (
              <div key={pairKey} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_210px]">
                <div className="text-sm font-medium text-slate-700">{pair.prompt || pair.left || `Item ${index + 1}`}</div>
                <select
                  value={selected}
                  aria-label={`${block.label || 'Matching'}: ${pair.prompt || pair.left || `Item ${index + 1}`}`}
                  onChange={(event) => {
                    const next = { ...(responses[block.id] || {}), [pairKey]: event.target.value }
                    updateResponse(block.id, next)
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select a match</option>
                  {options.map((option: string) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                {selected && (
                  <div className="md:col-span-2 text-xs text-slate-500">
                    {selected === correctAnswerMap[pairKey] ? 'Correct match.' : `Correct match: ${correctAnswerMap[pairKey] || 'Not set'}.`}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )
    }
    case 'fillBlank': {
      const selectedAnswer = String(responses[block.id] || '')
      const correctAnswer = String(block.config?.correctAnswer || block.config?.answer || '')
      const acceptedAnswers = Array.isArray(block.config?.answers)
        ? block.config.answers.map((value: string) => String(value))
        : [correctAnswer].filter(Boolean)
      const showFeedback = block.config?.showFeedback !== false
      const normalizedSelected = selectedAnswer.trim().toLowerCase()
      const isCorrect = acceptedAnswers.some((value: string) => value.trim().toLowerCase() === normalizedSelected)
      return (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">{block.label || block.config?.question || 'Fill in the blank'}</span>
          {block.config?.question && <p className="mb-2 text-xs text-slate-500">{block.config.question}</p>}
          <input
            value={selectedAnswer}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500"
            placeholder={block.config?.placeholder || 'Type your answer'}
          />
          {selectedAnswer && showFeedback && (
            <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${isCorrect ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {isCorrect ? 'Correct.' : `Incorrect. Correct answer: ${acceptedAnswers[0] || 'Not set'}.`}
              {block.config?.explanation && <p className="mt-2 text-sm text-slate-700">{block.config.explanation}</p>}
            </div>
          )}
        </label>
      )
    }
    case 'checklist': {
      const selectedValues = Array.isArray(responses[block.id]) ? responses[block.id] : []
      const options = getLabeledConfigItems(block.config?.options, 'option')
      return (
        <fieldset className="space-y-3" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <legend className="mb-2 block text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></legend>
          {options.map((option) => {
            const checked = selectedValues.some((value: unknown) => matchesOptionValue(value, option))
            return (
              <label key={option.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selectedValues.filter((entry: unknown) => !matchesOptionValue(entry, option))
                      : [...selectedValues, option.id]
                    updateResponse(block.id, next)
                  }}
                />
                <span>{option.label}</span>
              </label>
            )
          })}
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Select at least one option to continue.</p>}
        </fieldset>
      )
    }
    case 'ranking': {
      const currentOrder = reconcileRankingResponse(block.config?.options, responses[block.id])
      const storedOrder: unknown[] = Array.isArray(responses[block.id]) ? responses[block.id] : []
      const currentIds = currentOrder.map((item) => item.id)
      const needsSave = currentIds.length > 0 && (storedOrder.length !== currentIds.length || storedOrder.some((entry, index) => entry !== currentIds[index]))
      const moveOption = (index: number, direction: -1 | 1) => {
        const next = [...currentIds]
        const targetIndex = index + direction
        if (targetIndex < 0 || targetIndex >= next.length) return
        const [moved] = next.splice(index, 1)
        next.splice(targetIndex, 0, moved)
        updateResponse(block.id, next)
      }
      return (
        <div className="space-y-2" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <p className="text-sm font-medium text-slate-700">{block.label}</p>
          {currentOrder.map((option, index: number) => (
            <div key={`${block.id}-${option.id}`} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{index + 1}</span>
              <span className="flex-1 text-sm text-slate-700">{option.label}</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => moveOption(index, -1)} disabled={index === 0} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-40">���</button>
                <button type="button" onClick={() => moveOption(index, 1)} disabled={index === currentOrder.length - 1} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-40">���</button>
              </div>
            </div>
          ))}
          {needsSave && <button type="button" onClick={() => updateResponse(block.id, currentIds)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">Keep this order</button>}
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Rank the items or choose “Keep this order” to continue.</p>}
        </div>
      )
    }
    case 'categorize': {
      const items = getLabeledConfigItems(block.config?.items, 'item')
      const categories = Array.isArray(block.config?.categories) ? block.config.categories.map((category: any) => typeof category === 'object' ? String(category.label || '') : String(category)) : []
      const assignments = reconcileCategorizeResponse(block, responses[block.id])
      return (
        <fieldset className="space-y-3" aria-invalid={showRequiredError}>
          <legend className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></legend>
          {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
          <div className="grid gap-2">
            {items.map((item) => (
              <label key={item.id} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_180px] sm:items-center">
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                <select value={assignments[item.id] || ''} onChange={(event) => updateResponse(block.id, { ...assignments, [item.id]: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="">Choose a category</option>
                  {categories.map((category: string) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
            ))}
          </div>
          {showRequiredError && <p className="text-sm font-medium text-red-700">Categorize every item to continue.</p>}
        </fieldset>
      )
    }
    case 'hotspot': {
      return <HotspotBlock block={block} responses={responses} updateResponse={updateResponse} showRequiredError={showRequiredError} />
    }
    case 'numeric': {
      const value = responses[block.id] ?? ''
      const actual = Number(value)
      const expected = Number(block.config?.correctAnswer)
      const tolerance = Math.max(0, Number(block.config?.tolerance || 0))
      const isCorrect = value !== '' && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
      return (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></span>
          {block.description && <p className="mb-2 text-xs text-slate-500">{block.description}</p>}
          <div className="flex items-center gap-2"><input type="number" value={value} onChange={(event) => updateResponse(block.id, event.target.value === '' ? '' : Number(event.target.value))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" placeholder={block.config?.placeholder || 'Enter a number'} />{block.config?.unit && <span className="text-sm font-medium text-slate-600">{block.config.unit}</span>}</div>
          {value !== '' && block.config?.showFeedback !== false && <p className={`mt-2 text-sm font-medium ${isCorrect ? 'text-emerald-700' : 'text-red-700'}`}>{isCorrect ? 'Correct.' : `Try again${tolerance ? ` (within ±${tolerance})` : ''}.`}</p>}
        </label>
      )
    }
    case 'wordCloud': {
      const maxEntries = Math.min(10, Math.max(1, Number(block.config?.maxEntries || 3)))
      const values = Array.isArray(responses[block.id]) ? responses[block.id] : []
      return (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></legend>
          {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
          {Array.from({ length: maxEntries }, (_, index) => <input key={index} value={values[index] || ''} onChange={(event) => { const next = [...values]; next[index] = event.target.value; updateResponse(block.id, next) }} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" placeholder={`${block.config?.placeholder || 'Add a word or short phrase'} ${index + 1}`} />)}
          {values.some((entry: string) => entry?.trim()) && <div className="flex flex-wrap gap-2 pt-2">{values.filter((entry: string) => entry?.trim()).map((entry: string, index: number) => <span key={`${entry}-${index}`} className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">{entry}</span>)}</div>}
          {showRequiredError && <p className="text-sm font-medium text-red-700">Add at least one word or phrase.</p>}
        </fieldset>
      )
    }
    case 'confidence': {
      const options = getLabeledConfigItems(block.config?.options, 'option')
      return (
        <fieldset className="space-y-3" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <legend className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></legend>
          <div className="grid gap-2 sm:grid-cols-3">{options.map((option, index: number) => <button type="button" key={option.id} aria-pressed={matchesOptionValue(responses[block.id], option)} onClick={() => updateResponse(block.id, option.id)} className={`rounded-xl border px-3 py-3 text-left text-sm transition ${matchesOptionValue(responses[block.id], option) ? 'border-blue-600 bg-blue-600 font-semibold text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'}`}><span className="mb-1 block text-xs opacity-70">{index + 1}</span>{option.label}</button>)}</div>
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Choose a confidence level.</p>}
        </fieldset>
      )
    }
    case 'matrix': {
      const rows = getLabeledConfigItems(block.config?.rows, 'row')
      const values = responses[block.id] || {}
      const min = Number(block.config?.min ?? 1)
      const max = Number(block.config?.max ?? 5)
      return (
        <div className={`space-y-3 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`} aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <p className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></p>
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{row.label}</span>
                <span className="rounded-full bg-blue-100 px-2 py-1 text-sm font-semibold text-blue-700">{values[row.id] ?? values[row.label] ?? block.config?.defaultValue ?? min}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={Number(values[row.id] ?? values[row.label] ?? block.config?.defaultValue ?? min)}
                aria-label={`${block.label || 'Matrix rating'}: ${row.label}`}
                aria-required={block.required ? true : undefined}
                onChange={(event) => updateResponse(block.id, { ...values, [row.id]: Number(event.target.value) })}
                className="w-full"
              />
            </div>
          ))}
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Complete all required ratings in this table.</p>}
        </div>
      )
    }
    case 'imagePrompt':
      {
      const { imageFit, imageSize } = getImageDisplayConfig(block)
      const containSizeClass = imageSize === 'small' ? 'max-h-48' : imageSize === 'medium' ? 'max-h-72' : imageSize === 'full' ? 'max-h-none' : 'max-h-[32rem]'
      const coverSizeClass = imageSize === 'small' ? 'h-48' : imageSize === 'medium' ? 'h-72' : imageSize === 'full' ? 'aspect-video' : 'h-[32rem]'
      return (
        <div className="space-y-3" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          {block.config?.imageUrl && (
            <div className={`flex w-full justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 ${imageFit === 'cover' ? coverSizeClass : ''}`}>
              <img
                src={block.config.imageUrl}
                alt={block.config.altText || block.label || 'Worksheet image'}
                className={`w-full ${imageFit === 'cover' ? 'h-full object-cover' : `h-auto object-contain ${containSizeClass}`}`}
              />
            </div>
          )}
          {block.label && <p className="text-sm font-medium text-slate-700">{block.label}</p>}
          {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
          <textarea
            value={responses[block.id] || ''}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            aria-label={block.label || 'Image response'}
            aria-required={block.required ? true : undefined}
            className={`min-h-24 w-full rounded-xl border bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500 ${showRequiredError ? 'border-red-300' : 'border-slate-300'}`}
            placeholder={block.config?.placeholder || 'Add your notes here'}
          />
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">This response is required.</p>}
        </div>
      )
      }
    case 'video':
    case 'youtube': {
      const videoUrl = block.config?.videoUrl || ''
      const shouldUseYoutube = block.type === 'youtube' || isYouTubeUrl(videoUrl)
      const embedUrl = shouldUseYoutube ? getYouTubeEmbedUrl(videoUrl) : videoUrl

      return (
        <div className="space-y-3">
          {videoUrl ? (
            shouldUseYoutube ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                <iframe
                  src={embedUrl}
                  title={block.label || 'Embedded video'}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : (
              <video controls src={videoUrl} className="aspect-video w-full rounded-2xl border border-slate-200 bg-slate-100 object-cover" />
            )
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              No video URL configured yet.
            </div>
          )}
          {block.label && <p className="text-sm font-medium text-slate-700">{block.label}</p>}
          {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
          <textarea
            value={responses[block.id] || ''}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500"
            placeholder={block.config?.placeholder || 'Add your notes after watching'}
          />
        </div>
      )
    }
    case 'section':
      return (
        <div className="rounded-2xl border-l-4 border-blue-500 bg-blue-50 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{block.title || block.label || block.config?.title || 'Section'}</h3>
          {block.description && <p className="mt-1 text-sm text-slate-600">{block.description}</p>}
        </div>
      )
    case 'rating':
      return (
        <div className={`space-y-3 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`} aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></span>
            <span className="rounded-full bg-blue-100 px-2 py-1 text-sm font-semibold text-blue-700">{responses[block.id] ?? block.config?.defaultValue ?? '���'}</span>
          </div>
          {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
          <input
            type="range"
            min={block.config?.min ?? 0}
            max={block.config?.max ?? 10}
            step={block.config?.step ?? 1}
            value={responses[block.id] ?? block.config?.defaultValue ?? 5}
            aria-label={block.label || 'Rating'}
            aria-required={block.required ? true : undefined}
            onChange={(event) => updateResponse(block.id, Number(event.target.value))}
            className="w-full"
          />
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Set a rating to continue.</p>}
        </div>
      )
    case 'continuum': {
      const current = responses[block.id] && typeof responses[block.id] === 'object' ? responses[block.id] : undefined
      const position = Number(current?.position ?? block.config?.defaultValue ?? 50)
      return (
        <div className={`space-y-4 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
          <div>
            <p className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></p>
            {block.config?.instructions && <p className="mt-1 text-sm text-slate-500">{block.config.instructions}</p>}
          </div>
          <div className="flex items-center justify-between gap-4 text-sm font-medium text-slate-700">
            <span>{block.config?.leftLabel || 'Low'}</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-700">{Math.round(position)}</span>
            <span>{block.config?.rightLabel || 'High'}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={position}
            aria-label={block.label || 'Continuum position'}
            aria-required={block.required ? true : undefined}
            onChange={(event) => updateResponse(block.id, { ...(current || {}), position: Number(event.target.value) })}
            className="w-full accent-blue-600"
          />
          <label className="block text-sm font-medium text-slate-700">
            Rationale{block.config?.rationaleRequired ? ' *' : ''}
            <textarea value={current?.rationale || ''} onChange={(event) => updateResponse(block.id, { ...(current || {}), ...(current ? { position } : {}), rationale: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Explain your position" />
          </label>
          {showRequiredError && <p className="text-sm font-medium text-red-700">Choose a position{block.config?.rationaleRequired ? ' and add a rationale' : ''} to continue.</p>}
        </div>
      )
    }
    case 'decisionMatrix': {
      const matrixOptions = getLabeledConfigItems(block.config?.options, 'option')
      const criteria = getLabeledConfigItems(block.config?.criteria, 'criterion')
      const min = Number(block.config?.min ?? 1)
      const max = Number(block.config?.max ?? 5)
      const values = responses[block.id] && typeof responses[block.id] === 'object' ? responses[block.id] : {}
      return (
        <div className={`space-y-4 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
          <div><p className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></p>{block.description && <p className="mt-1 text-xs text-slate-500">{block.description}</p>}</div>
          <div className="space-y-4">
            {matrixOptions.map((option: any) => {
              const optionValues = values[option.id] || values[option.label] || {}
              const completed = criteria.map((criterion) => Number(optionValues[criterion.id] ?? optionValues[criterion.label])).filter(Number.isFinite)
              const total = completed.reduce((sum: number, value: number) => sum + value, 0)
              return (
                <section key={option.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="font-semibold text-slate-900">{option.label}</h4>
                  <div className="mt-3 space-y-3">
                    {criteria.map((criterion: any) => <div key={criterion.id} className="grid gap-2 sm:grid-cols-[minmax(140px,1fr)_auto] sm:items-center">
                      <span className="text-sm text-slate-700">{criterion.label}</span>
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${option.label}: ${criterion.label}`}>
                        {Array.from({ length: Math.max(1, max - min + 1) }, (_, index) => min + index).map((score) => <button type="button" role="radio" aria-checked={(optionValues[criterion.id] ?? optionValues[criterion.label]) === score} key={score} onClick={() => updateResponse(block.id, { ...values, [option.id]: { ...optionValues, [criterion.id]: score } })} className={`h-9 w-9 rounded-lg border text-sm font-semibold ${(optionValues[criterion.id] ?? optionValues[criterion.label]) === score ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{score}</button>)}
                      </div>
                    </div>)}
                  </div>
                  {block.config?.showTotals && completed.length > 0 && <p className="mt-3 text-xs text-slate-600">Total {total} · Average {(total / completed.length).toFixed(1)}. Use these figures as evidence, not an automatic decision.</p>}
                </section>
              )
            })}
          </div>
          {showRequiredError && <p className="text-sm font-medium text-red-700">Rate every option against every criterion.</p>}
        </div>
      )
    }
    case 'board': {
      const columns = Array.isArray(block.config?.columns) ? block.config.columns : []
      const boardValues = responses[block.id] && typeof responses[block.id] === 'object' ? responses[block.id] : {}
      const allowMultiple = block.config?.allowMultipleEntries !== false
      const maxEntries = Math.max(0, Number(block.config?.maxEntriesPerColumn || 0))
      const updateColumn = (columnId: string, entries: any[]) => updateResponse(block.id, { ...boardValues, [columnId]: entries })
      return (
        <div className={`space-y-4 rounded-2xl border p-4 ${showRequiredError ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
          <div><p className="text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></p>{block.description && <p className="mt-1 text-xs text-slate-500">{block.description}</p>}</div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {columns.map((column: any) => {
              const entries = Array.isArray(boardValues[column.id]) ? boardValues[column.id] : []
              const canAdd = allowMultiple && (maxEntries === 0 || entries.length < maxEntries)
              return <section key={column.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-semibold text-slate-900">{column.label}</h4>
                {column.description && <p className="mt-1 text-xs text-slate-500">{column.description}</p>}
                <div className="mt-3 space-y-2">
                  {entries.map((entry: any, index: number) => <div key={entry.id} className="flex gap-2">
                    <textarea value={entry.text || ''} onChange={(event) => { const next = [...entries]; next[index] = { ...entry, text: event.target.value }; updateColumn(column.id, next) }} className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder={block.config?.placeholder || 'Add an idea'} />
                    <button type="button" aria-label={`Delete entry from ${column.label}`} onClick={() => updateColumn(column.id, entries.filter((_: any, itemIndex: number) => itemIndex !== index))} className="self-start rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs font-medium text-red-700">Delete</button>
                  </div>)}
                  {entries.length === 0 && !allowMultiple && <textarea value="" onChange={(event) => updateColumn(column.id, [{ id: `board-entry-${Date.now()}`, text: event.target.value }])} className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder={block.config?.placeholder || 'Add an idea'} />}
                  {canAdd && <button type="button" onClick={() => updateColumn(column.id, [...entries, { id: `board-entry-${Date.now()}-${entries.length}`, text: '' }])} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700">Add entry</button>}
                </div>
              </section>
            })}
          </div>
          {showRequiredError && <p className="text-sm font-medium text-red-700">Add at least one board entry to continue.</p>}
        </div>
      )
    }
    case 'radar':
      return <RadarBlock block={block} responses={responses} updateResponse={updateResponse} showRequiredError={showRequiredError} />
    case 'swot':
      return <SwotBoard block={block} responses={responses} updateResponse={updateResponse} showRequiredError={showRequiredError} />
    case 'quadrant':
      return <QuadrantBoard block={block} responses={responses} updateResponse={updateResponse} showRequiredError={showRequiredError} />
    case 'verdict':
      {
      const options = getLabeledConfigItems(block.config?.options, 'option')
      return (
        <fieldset className="space-y-3" aria-invalid={showRequiredError} aria-describedby={showRequiredError ? getBlockErrorId(block.id) : undefined}>
          <legend className="mb-2 block text-sm font-medium text-slate-700"><BlockFieldLabel block={block} /></legend>
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <input type="radio" name={block.id} aria-required={block.required ? true : undefined} checked={matchesOptionValue(responses[block.id], option)} onChange={() => updateResponse(block.id, option.id)} />
              <span>{option.label}</span>
            </label>
          ))}
          {showRequiredError && <p id={getBlockErrorId(block.id)} className="text-sm font-medium text-red-700">Choose one option to continue.</p>}
        </fieldset>
      )
      }
    default:
      return null
  }
}

function formatBlockValue(block: WorksheetBlock, value: any) {
  if (value === undefined || value === null || value === '') return ''
  if (block.type === 'richText') return stripHtml(sanitizeRichTextHtml(String(value)))
  if (['singleSelect', 'confidence', 'verdict'].includes(block.type)) {
    const option = getLabeledConfigItems(block.config?.options, 'option').find((item) => matchesOptionValue(value, item))
    return option?.label || String(value)
  }
  if (block.type === 'checklist' || block.type === 'multipleChoice' || block.type === 'quiz') {
    const options = getLabeledConfigItems(block.config?.options, 'option')
    const values = getSelectedOptionValues(value)
    return values.map((entry) => options.find((option) => matchesOptionValue(entry, option))?.label || String(entry)).join(', ')
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (block.type === 'wordCloud') return value.filter(Boolean).join(', ')
  if (block.type === 'hotspot') return value.map((point: any) => `(${point.x}%, ${point.y}%)`).join(', ')
  if (block.type === 'categorize') {
    const itemLabels = Object.fromEntries(getLabeledConfigItems(block.config?.items, 'item').map((item) => [item.id, item.label]))
    return Object.entries(reconcileCategorizeResponse(block, value)).filter(([, category]) => String(category).trim()).map(([item, category]) => `${itemLabels[item] || item}: ${category}`).join('; ')
  }
  if (block.type === 'ranking') {
    return reconcileRankingResponse(block.config?.options, value).map((item) => item.label).join(', ')
  }
  if (block.type === 'matrix') {
    const rowLabels = Object.fromEntries(getLabeledConfigItems(block.config?.rows, 'row').map((row) => [row.id, row.label]))
    return Object.entries(value as Record<string, number>).map(([row, score]) => `${rowLabels[row] || row}: ${score}`).join(', ')
  }
  if (block.type === 'radar') {
    const dimensionLabels = Object.fromEntries(getLabeledConfigItems(block.config?.dimensions, 'dimension').map((dimension) => [dimension.id, dimension.label]))
    return `Radar: ${Object.entries(value as Record<string, number>).map(([dimension, score]) => `${dimensionLabels[dimension] || dimension}: ${score}`).join(', ')}`
  }
  if (block.type === 'quadrant') return `Quadrant: x=${value.x}, y=${value.y}. Rationale: ${value.rationale || 'No rationale recorded'}`
  if (block.type === 'continuum') return `Position: ${value.position}. Rationale: ${value.rationale || 'No rationale recorded'}`
  if (block.type === 'decisionMatrix') {
    const optionLabels = Object.fromEntries(getLabeledConfigItems(block.config?.options, 'option').map((option) => [option.id, option.label]))
    const criterionLabels = Object.fromEntries(getLabeledConfigItems(block.config?.criteria, 'criterion').map((criterion) => [criterion.id, criterion.label]))
    return Object.entries(value as Record<string, any>).map(([option, ratings]) => `${optionLabels[option] || option}: ${Object.entries(ratings).map(([criterion, score]) => `${criterionLabels[criterion] || criterion}: ${score}`).join(', ')}`).join(' | ')
  }
  if (block.type === 'board') {
    const columnLabels = Object.fromEntries((block.config?.columns || []).map((column: any) => [column.id, column.label]))
    return Object.entries(value as Record<string, any>).map(([column, entries]) => `${columnLabels[column] || column}: ${(entries as any[]).map((entry) => entry.text).join('; ')}`).join(' | ')
  }
  if (block.type === 'swot') {
    return Object.entries(value as Record<string, any>)
      .map(([key, entries]) => `${key}: ${(entries as any[]).map((entry) => entry.text).join('; ')}`)
      .join(' | ')
  }
  return JSON.stringify(value)
}

function RadarSummaryChart({ data }: { data: Record<string, number> }) {
  const dimensions = Object.keys(data)
  const values = Object.values(data)
  const center = 110
  const radius = 90

  if (!dimensions.length) {
    return <div className="text-sm text-slate-500">No radar dimensions configured.</div>
  }

  const points = dimensions.map((_, index) => {
    const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
    const value = numberInRange(values[index], 0, 10) ?? 0
    const distance = (value / 10) * radius
    const x = center + Math.cos(angle) * distance
    const y = center + Math.sin(angle) * distance
    return `${x},${y}`
  })

  return (
    <svg viewBox="0 0 220 220" className="h-52 w-full max-w-[260px]">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((ring) => {
        const ringRadius = (ring / 10) * radius
        const polygon = dimensions
          .map((_, index) => {
            const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
            const x = center + Math.cos(angle) * ringRadius
            const y = center + Math.sin(angle) * ringRadius
            return `${x},${y}`
          })
          .join(' ')
        return <polygon key={ring} points={polygon} fill="none" stroke="#dbeafe" strokeWidth="1" />
      })}
      {dimensions.map((dimension, index) => {
        const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
        const x = center + Math.cos(angle) * (radius + 22)
        const y = center + Math.sin(angle) * (radius + 22)
        return (
          <text key={dimension} x={x} y={y} textAnchor="middle" fontSize="8" fill="#475569" transform={`rotate(${(index * 360) / dimensions.length}, ${x}, ${y})`}>
            {dimension.slice(0, 10)}
          </text>
        )
      })}
      <polygon points={points.join(' ')} fill="rgba(37,99,235,0.18)" stroke="#2563eb" strokeWidth="2" />
      {points.map((point, index) => {
        const [x, y] = point.split(',').map(Number)
        return <circle key={`${point}-${index}`} cx={x} cy={y} r="3" fill="#1d4ed8" />
      })}
    </svg>
  )
}

export function QuadrantMiniChart({ x, y, xLeft = 'Time', xRight = 'Learning', yBottom = 'Low risk', yTop = 'High risk' }: { x: number; y: number; xLeft?: string; xRight?: string; yBottom?: string; yTop?: string }) {
  const safeX = numberInRange(x, 0, 100) ?? 0
  const safeY = numberInRange(y, 0, 100) ?? 0
  return (
    <svg viewBox="0 0 220 220" className="h-48 w-full max-w-[260px]">
      <rect x="0" y="0" width="220" height="220" fill="#f8fafc" rx="18" />
      <line x1="110" y1="0" x2="110" y2="220" stroke="#cbd5e1" strokeWidth="2" />
      <line x1="0" y1="110" x2="220" y2="110" stroke="#cbd5e1" strokeWidth="2" />
      <circle cx={(safeX / 100) * 220} cy={220 - (safeY / 100) * 220} r="7" fill="#f59e0b" stroke="#fff" strokeWidth="2" />
      <text x="18" y="112" fontSize="11" fill="#475569">{xLeft}</text>
      <text x="160" y="112" fontSize="11" fill="#475569">{xRight}</text>
      <text x="92" y="210" fontSize="11" fill="#475569">{yBottom}</text>
      <text x="92" y="18" fontSize="11" fill="#475569">{yTop}</text>
    </svg>
  )
}

function drawPdfRadar(pdf: jsPDF, centreX: number, centreY: number, radius: number, data: Record<string, number>) {
  const dimensions = Object.keys(data)
  const values = Object.values(data)
  if (!dimensions.length) return

  const points = dimensions.map((_, index) => {
    const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
    const value = numberInRange(values[index], 0, 10) ?? 0
    const distance = (value / 10) * radius
    const x = centreX + Math.cos(angle) * distance
    const y = centreY + Math.sin(angle) * distance
    return { x, y }
  })

  pdf.setDrawColor(191, 219, 254)
  pdf.setLineWidth(0.6)
  for (let ring = 1; ring <= 5; ring += 1) {
    const ringPoints = dimensions.map((_, index) => {
      const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
      const x = centreX + Math.cos(angle) * (radius * ring / 5)
      const y = centreY + Math.sin(angle) * (radius * ring / 5)
      return { x, y }
    })

    ringPoints.forEach((point, index) => {
      const next = ringPoints[(index + 1) % ringPoints.length]
      pdf.line(point.x, point.y, next.x, next.y)
    })
  }

  pdf.setDrawColor(148, 163, 184)
  dimensions.forEach((_, index) => {
    const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
    const x = centreX + Math.cos(angle) * radius
    const y = centreY + Math.sin(angle) * radius
    pdf.line(centreX, centreY, x, y)
  })

  pdf.setDrawColor(37, 99, 235)
  pdf.setLineWidth(1.2)
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    pdf.line(point.x, point.y, next.x, next.y)
  })

  points.forEach((point) => {
    pdf.circle(point.x, point.y, 2, 'F')
  })
}

function drawPdfQuadrant(pdf: jsPDF, left: number, top: number, size: number, x: number, y: number) {
  pdf.setFillColor(248, 250, 252)
  pdf.setDrawColor(203, 213, 225)
  pdf.roundedRect(left, top, size, size, 10, 10, 'FD')
  pdf.line(left + size / 2, top, left + size / 2, top + size)
  pdf.line(left, top + size / 2, left + size, top + size / 2)

  const pointX = left + (Math.max(0, Math.min(100, x)) / 100) * size
  const pointY = top + size - (Math.max(0, Math.min(100, y)) / 100) * size
  pdf.setFillColor(245, 158, 11)
  pdf.setDrawColor(255, 255, 255)
  pdf.circle(pointX, pointY, 4, 'FD')
}

function SynthesisViewer({ definition, initialMode = 'student', initialResponses, initialNotice, backTo = '/' }: { definition: WorksheetDefinition; initialMode?: 'student' | 'teacher'; initialResponses?: WorksheetResponse[]; initialNotice?: string; backTo?: string }) {
  const [responses, setResponses] = useState<WorksheetResponse[]>(initialResponses || [])
  const [error, setError] = useState('')
  const [importInfo, setImportInfo] = useState('')
  const [mode, setMode] = useState<'student' | 'teacher'>(initialMode)
  const [reportGroupByBlockId, setReportGroupByBlockId] = useState(definition.synthesis?.groupByBlockId || '')
  const [groupingFilter, setGroupingFilter] = useState('all')
  const [responseLabelFilter, setResponseLabelFilter] = useState('all')
  const [verdictFilter, setVerdictFilter] = useState('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [expandedReportSections, setExpandedReportSections] = useState<Set<string>>(() => new Set())
  const structure = useMemo(() => getWorksheetStructure(definition), [definition])
  const groupableBlockOptions = useMemo(() => getResponseProducingBlocks(definition)
    .filter((block) => SYNTHESIS_GROUPABLE_BLOCK_TYPES.has(block.type)), [definition])
  const reportDefinition = useMemo<WorksheetDefinition>(() => {
    const selectedGroupingBlock = groupableBlockOptions.find((block) => block.id === reportGroupByBlockId)
    const configuredGroupByBlockId = definition.synthesis?.groupByBlockId
    const configuredResponseLabelBlockId = definition.synthesis?.responseLabelBlockId
    const responseLabelBlockId = reportGroupByBlockId === configuredResponseLabelBlockId
      ? configuredGroupByBlockId
      : configuredResponseLabelBlockId
    return {
      ...definition,
      synthesis: {
        ...definition.synthesis,
        groupByBlockId: reportGroupByBlockId || undefined,
        groupLabel: selectedGroupingBlock ? getBlockDisplayLabel(selectedGroupingBlock) : 'Response group',
        responseLabelBlockId,
      },
    }
  }, [definition, groupableBlockOptions, reportGroupByBlockId])
  const responseLabelLookup = useMemo(
    () => Object.fromEntries(responses.map((response) => [response.responseId, getResponseLabel(response, reportDefinition)])),
    [reportDefinition, responses],
  )
  const synthesisResult = useMemo(() => groupResponsesByKey(reportDefinition, responses), [reportDefinition, responses])
  const groupings = synthesisResult.groups
  const synthesisConfig = synthesisResult.config
  const reportPages = useMemo<ReportPageSection[]>(
    () => definition.pages
      .map((page) => ({
        page,
        responseBlocks: page.blocks.filter((block) => isResponseProducingBlock(block)
          && block.id !== synthesisConfig.groupByBlockId
          && block.id !== synthesisConfig.responseLabelBlockId
          && !REPORT_EXCLUDED_BLOCK_TYPES.has(block.type)),
        contextText: getPageContextText(page),
      }))
      .filter((section) => section.responseBlocks.length > 0),
    [definition.pages, synthesisConfig.groupByBlockId, synthesisConfig.responseLabelBlockId],
  )
  const verdictBlocks = useMemo(
    () => structure.responseBlocks.filter((block) => block.type === 'verdict'),
    [structure.responseBlocks],
  )
  const verdictFilterOptions = useMemo(
    () => Array.from(new Set(groupings.flatMap((grouping) => grouping.responses.flatMap((response) => verdictBlocks.map((block) => String(response.responses?.[block.id] || '').trim()).filter(Boolean))))).sort(),
    [groupings, verdictBlocks],
  )
  const responseLabelFilterOptions = useMemo(
    () => Array.from(new Set(Object.values(responseLabelLookup))).sort((left, right) => left.localeCompare(right)),
    [responseLabelLookup],
  )
  const filteredGroupings = useMemo(() => {
    const normalizedSearch = searchFilter.trim().toLowerCase()

    return groupings
      .filter((grouping) => groupingFilter === 'all' || grouping.key === groupingFilter)
      .map((grouping) => {
        const filteredResponses = grouping.responses.filter((response) => {
          const label = responseLabelLookup[response.responseId] || ''
          const matchesLabel = responseLabelFilter === 'all' || label === responseLabelFilter
          const matchesVerdict = verdictFilter === 'all' || verdictBlocks.some((block) => String(response.responses?.[block.id] || '').trim() === verdictFilter)
          const matchesSearch = !normalizedSearch
            || grouping.label.toLowerCase().includes(normalizedSearch)
            || label.toLowerCase().includes(normalizedSearch)
            || buildResponseSearchText(response).includes(normalizedSearch)

          return matchesLabel && matchesVerdict && matchesSearch
        })

        return {
          ...grouping,
          responses: filteredResponses,
        }
      })
      .filter((grouping) => grouping.responses.length > 0)
  }, [groupings, groupingFilter, responseLabelFilter, responseLabelLookup, searchFilter, verdictBlocks, verdictFilter])
  const filteredResponseCount = useMemo(
    () => filteredGroupings.reduce((sum, grouping) => sum + grouping.responses.length, 0),
    [filteredGroupings],
  )
  const studentSynthesis = useMemo(
    () => buildStudentSynthesis(filteredGroupings, structure.radarBlockId, synthesisConfig.groupLabel, definition),
    [definition, filteredGroupings, structure.radarBlockId, synthesisConfig.groupLabel],
  )

  const getVisiblePageSections = useCallback((groupingResponses: WorksheetResponse[]) => (
    reportPages
      .map((section) => ({
        ...section,
        visibleBlocks: section.responseBlocks.filter((block) => groupingResponses.some((response) => hasMeaningfulResponseValue(response.responses?.[block.id]))),
      }))
      .filter((section) => section.visibleBlocks.length > 0)
  ), [reportPages])

  const getBlockEntries = useCallback((block: WorksheetBlock, groupingResponses: WorksheetResponse[]) => (
    groupingResponses
      .map((response) => ({
        response,
        label: responseLabelLookup[response.responseId],
        value: response.responses?.[block.id],
      }))
      .filter((entry) => hasMeaningfulResponseValue(entry.value))
  ), [responseLabelLookup])

  const getBlockCardSpanClass = (block: WorksheetBlock) => {
    switch (block.type) {
      case 'swot':
      case 'board':
      case 'decisionMatrix':
        return 'md:col-span-2 xl:col-span-6'
      case 'radar':
      case 'quadrant':
      case 'longText':
      case 'richText':
      case 'checklist':
      case 'ranking':
      case 'imagePrompt':
      case 'video':
      case 'youtube':
        return 'md:col-span-2 xl:col-span-3'
      default:
        return 'xl:col-span-2'
    }
  }

  const renderResponseValue = (block: WorksheetBlock, value: any) => {
    if (block.type === 'richText') {
      return <div className="prose prose-slate mt-2 max-w-none text-sm" dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(String(value)) }} />
    }

    if (block.type === 'checklist') {
      const items = Array.isArray(value) ? value.filter((item) => hasMeaningfulResponseValue(item)) : []
      return (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={`${block.id}-${String(item)}`} className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{String(item)}</span>
          ))}
        </div>
      )
    }

    if (block.type === 'ranking') {
      const items = reconcileRankingResponse(block.config?.options, value)
      return (
        <ol className="mt-2 space-y-2 text-sm text-slate-700">
          {items.map((item, index) => (
            <li key={`${block.id}-${item.id}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{index + 1}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ol>
      )
    }

    return <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{formatBlockValue(block, value)}</div>
  }

  const renderReportBlockCard = (block: WorksheetBlock, groupingResponses: WorksheetResponse[], viewerMode: 'student' | 'teacher') => {
    const entries = getBlockEntries(block, groupingResponses)
    if (entries.length === 0) return null

    const title = getBlockDisplayLabel(block)

    if (block.type === 'radar') {
      const configuredDimensionItems = getLabeledConfigItems(block.config?.dimensions, 'dimension')
      const configuredDimensions = configuredDimensionItems.map((dimension) => dimension.id)
      const dimensionLabels = Object.fromEntries(configuredDimensionItems.map((dimension) => [dimension.id, dimension.label]))
      const fallbackDimensions = Array.from(new Set(entries.flatMap(({ value }) => Object.keys((value as Record<string, number>) || {}))))
      const dimensions = configuredDimensions.length ? configuredDimensions : fallbackDimensions
      const averages = Object.fromEntries(Object.entries(aggregateRadarValues(groupingResponses, dimensions, block.id, getNumericRange(block.config, 1, 10))).map(([dimension, score]) => [dimensionLabels[dimension] || dimension, score]))

      return (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">{title}</h4>
              <p className="mt-1 text-sm text-slate-500">Average across {formatCountLabel(groupingResponses.length, 'evaluation')}.</p>
            </div>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Radar</span>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <RadarSummaryChart data={averages} />
            </div>
            <div className="space-y-2">
              {Object.entries(averages).map(([label, score]) => (
                <div key={label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-700">{label}</span>
                  <span className="text-sm font-semibold text-slate-900">{Number(score).toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )
    }

    if (block.type === 'quadrant') {
      const averagePoint = aggregateQuadrantMean(groupingResponses, block.id)
      const rationaleEntries = entries.filter(({ value }) => typeof value?.rationale === 'string' && value.rationale.trim())
      const visibleRationales = viewerMode === 'student' ? rationaleEntries.slice(0, 3) : rationaleEntries

      return (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">{title}</h4>
              <p className="mt-1 text-sm text-slate-500">Average position across {formatCountLabel(groupingResponses.length, 'evaluation')}.</p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Quadrant</span>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <QuadrantMiniChart x={averagePoint.x} y={averagePoint.y} xLeft={block.config?.xLeft} xRight={block.config?.xRight} yBottom={block.config?.yBottom} yTop={block.config?.yTop} />
              <div className="mt-3 flex justify-between text-sm text-slate-700">
                <span>x: {averagePoint.x.toFixed(1)}</span>
                <span>y: {averagePoint.y.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <h5 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Rationales</h5>
              <div className="mt-3 space-y-2">
                {visibleRationales.length > 0 ? visibleRationales.map(({ response, label, value }) => (
                  <div key={`${response.responseId}-${block.id}`} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-800">{label}</span>
                      {viewerMode === 'teacher' && <span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{response.responseId.slice(0, 8)}</span>}
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{String(value.rationale).trim()}</p>
                  </div>
                )) : <p className="text-sm text-slate-500">No rationale text was recorded for this block.</p>}
              </div>
            </div>
          </div>
        </>
      )
    }

    if (block.type === 'continuum') {
      const summary = aggregateContinuum(groupingResponses, block.id)
      const rationales = entries.filter(({ value }) => typeof value?.rationale === 'string' && value.rationale.trim())
      return <><div className="flex items-center justify-between gap-3"><div><h4 className="text-base font-semibold text-slate-900">{title}</h4><p className="mt-1 text-sm text-slate-500">{summary.count} recorded position(s).</p></div><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Continuum</span></div><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex justify-between text-xs font-medium text-slate-600"><span>{block.config?.leftLabel || 'Low'}</span><span>{block.config?.rightLabel || 'High'}</span></div><div className="relative mt-5 h-2 rounded-full bg-slate-300">{summary.positions.map((position, index) => <span key={`${position}-${index}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow" style={{ left: `${position}%` }} />)}</div><div className="mt-4 flex gap-4 text-sm text-slate-700"><span>Mean <strong>{summary.mean.toFixed(1)}</strong></span><span>Median <strong>{summary.median.toFixed(1)}</strong></span></div></div>{rationales.length > 0 && <div className="mt-4 space-y-2">{rationales.map(({ response, label, value }) => <div key={response.responseId} className="rounded-xl bg-slate-50 p-3"><span className="text-xs font-semibold text-slate-500">{label} · {Number(value.position).toFixed(0)}</span><p className="mt-1 text-sm text-slate-700">{value.rationale}</p></div>)}</div>}</>
    }

    if (block.type === 'decisionMatrix') {
      const matrixOptions = Array.isArray(block.config?.options) ? block.config.options : []
      const criteria = Array.isArray(block.config?.criteria) ? block.config.criteria : []
      const summary = aggregateDecisionMatrix(groupingResponses, block.id, matrixOptions, criteria, getNumericRange(block.config, 1, 5))
      return <><div className="flex items-center justify-between gap-3"><div><h4 className="text-base font-semibold text-slate-900">{title}</h4><p className="mt-1 text-sm text-slate-500">Average ratings by option and criterion. Counts reflect valid submitted values.</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-violet-700">Decision matrix</span></div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-slate-200"><th className="p-2">Option</th>{criteria.map((criterion: any) => <th key={criterion.id} className="p-2">{criterion.label}</th>)}<th className="p-2">Overall</th></tr></thead><tbody>{summary.map((option) => <tr key={option.id} className="border-b border-slate-100"><th className="p-2 font-medium text-slate-800">{option.label}<span className="block text-xs font-normal text-slate-500">{option.count} response(s)</span></th>{option.criteria.map((criterion) => <td key={criterion.id} className="p-2">{criterion.count ? criterion.average.toFixed(1) : '—'}<span className="block text-[10px] text-slate-400">n={criterion.count}</span></td>)}<td className="p-2 font-semibold">{option.overallMean.toFixed(1)}</td></tr>)}</tbody></table></div></>
    }

    if (block.type === 'board') {
      const columns = Array.isArray(block.config?.columns) ? block.config.columns : []
      return <><div className="flex items-center justify-between gap-3"><div><h4 className="text-base font-semibold text-slate-900">{title}</h4><p className="mt-1 text-sm text-slate-500">Ideas remain grouped by board column with source labels attached.</p></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Board</span></div><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{columns.map((column: any) => { const items = groupingResponses.flatMap((response) => (((response.responses?.[block.id] as Record<string, any>)?.[column.id] || []) as any[]).filter((entry) => hasMeaningfulResponseValue(entry?.text)).map((entry) => ({ text: String(entry.text).trim(), label: responseLabelLookup[response.responseId], responseId: response.responseId }))); return <div key={column.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h5 className="font-semibold text-slate-800">{column.label}</h5>{column.description && <p className="mt-1 text-xs text-slate-500">{column.description}</p>}<div className="mt-3 space-y-2">{items.length ? items.map((item, index) => <div key={`${item.responseId}-${index}`} className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><span className="text-xs font-medium text-slate-500">{item.label}</span><p className="mt-1 text-sm text-slate-700">{item.text}</p></div>) : <p className="text-sm text-slate-500">No entries recorded.</p>}</div></div> })}</div></>
    }

    if (block.type === 'swot') {
      const categories = Array.isArray(block.config?.categories)
        ? block.config.categories
        : [
            { id: 'strengths', label: 'Strengths' },
            { id: 'weaknesses', label: 'Weaknesses' },
            { id: 'opportunities', label: 'Opportunities' },
            { id: 'threats', label: 'Threats' },
          ]

      return (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">{title}</h4>
              <p className="mt-1 text-sm text-slate-500">Responses stay grouped by SWOT category with source labels attached.</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">SWOT</span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {categories.map((category: any) => {
              const items = groupingResponses.flatMap((response) => (((response.responses?.[block.id] as Record<string, any>)?.[category.id] || []) as any[])
                .filter((item) => hasMeaningfulResponseValue(item?.text))
                .map((item) => ({ text: String(item.text).trim(), label: responseLabelLookup[response.responseId], responseId: response.responseId })))

              return (
                <div key={`${block.id}-${category.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600">{category.label}</h5>
                  <div className="mt-3 space-y-2">
                    {items.length > 0 ? items.map((item, index) => (
                      <div key={`${category.id}-${index}-${item.responseId}`} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-slate-800">{item.label}</span>
                          {viewerMode === 'teacher' && <span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{item.responseId.slice(0, 8)}</span>}
                        </div>
                        <p className="mt-2 text-sm text-slate-700">{item.text}</p>
                      </div>
                    )) : <p className="text-sm text-slate-500">No entries recorded.</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )
    }

    if (block.type === 'matrix') {
      const rows = getLabeledConfigItems(block.config?.rows, 'row')
      const { min, max } = getNumericRange(block.config, 1, 5)
      const averages = rows.map((row) => {
        const values = groupingResponses
          .map((response) => numberInRange(response.responses?.[block.id]?.[row.id] ?? response.responses?.[block.id]?.[row.label], min, max))
          .filter((value): value is number => value !== undefined)
        return {
          row,
          average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
          count: values.length,
        }
      }).filter((entry) => entry.count > 0)

      return (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">{title}</h4>
              <p className="mt-1 text-sm text-slate-500">Average across {formatCountLabel(groupingResponses.length, 'evaluation')}.</p>
            </div>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-violet-700">Matrix</span>
          </div>
          <div className="mt-4 space-y-2">
            {averages.map(({ row, average }) => (
              <div key={`${block.id}-${row.id}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-700">{row.label}</span>
                <span className="text-sm font-semibold text-slate-900">{average.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </>
      )
    }

    if (block.type === 'rating') {
      const { min, max } = getNumericRange(block.config, 0, 10)
      const numericEntries = entries
        .map(({ response, label, value }) => ({ response, label, value: Number(value) }))
        .filter((entry) => numberInRange(entry.value, min, max) !== undefined)
      const average = numericEntries.length ? numericEntries.reduce((sum, entry) => sum + entry.value, 0) / numericEntries.length : 0

      return (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">{title}</h4>
              <p className="mt-1 text-sm text-slate-500">Scale {block.config?.min ?? 0} to {block.config?.max ?? 10}.</p>
            </div>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">Rating</span>
          </div>
          <div className="mt-4 flex items-end justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Average</div>
              <div className="mt-2 text-4xl font-bold text-slate-900">{average.toFixed(1)}</div>
            </div>
            <div className="text-sm text-slate-600">{numericEntries.length} recorded value(s)</div>
          </div>
          <div className="mt-4 space-y-2">
            {numericEntries.map(({ response, label, value }) => (
              <div key={`${response.responseId}-${block.id}`} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                <span className="text-sm text-slate-700">{label}</span>
                <span className="text-sm font-semibold text-slate-900">{value}</span>
              </div>
            ))}
          </div>
        </>
      )
    }

    if (block.type === 'singleSelect' || block.type === 'verdict' || block.type === 'multipleChoice' || block.type === 'trueFalse') {
      const counts = new Map<string, string[]>()
      entries.forEach(({ label, value }) => {
        const selectedValues = Array.isArray(value) ? value : [value]
        selectedValues
          .map((item) => String(item).trim())
          .filter(Boolean)
          .forEach((item) => {
            counts.set(item, [...(counts.get(item) || []), label])
          })
      })

      return (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">{title}</h4>
              <p className="mt-1 text-sm text-slate-500">Distribution across visible responses.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">Summary</span>
          </div>
          <div className="mt-4 space-y-3">
            {Array.from(counts.entries()).map(([option, labels]) => (
              <div key={`${block.id}-${option}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-800">{option}</span>
                  <span className="text-sm font-semibold text-slate-900">{labels.length}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {labels.map((label) => (
                    <span key={`${block.id}-${option}-${label}`} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">{label}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )
    }

    const isSummaryCard = RESPONSE_SUMMARY_BLOCK_TYPES.has(block.type)

    return (
      <>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">{title}</h4>
            <p className="mt-1 text-sm text-slate-500">{isSummaryCard ? 'Reported individually with source labels preserved.' : 'Captured responses for this worksheet block.'}</p>
          </div>
          {block.type === 'shortText' || block.type === 'longText' || block.type === 'richText' ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">Written</span> : null}
        </div>
        <div className="mt-4 space-y-3">
          {entries.map(({ response, label, value }) => (
            <div key={`${response.responseId}-${block.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-800">{label}</span>
                {viewerMode === 'teacher' && <span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{response.responseId.slice(0, 8)}</span>}
              </div>
              {renderResponseValue(block, value)}
            </div>
          ))}
        </div>
      </>
    )
  }

  const renderPageSections = (grouping: GroupedResponseSet, viewerMode: 'student' | 'teacher') => {
    const visibleSections = getVisiblePageSections(grouping.responses)

    return <div className="mt-6 space-y-3">{visibleSections.map((section) => {
      const sectionKey = `${grouping.key}:${section.page.id}`
      const isExpanded = expandedReportSections.has(sectionKey)
      return <section key={sectionKey} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70">
        <button type="button" aria-expanded={isExpanded} aria-controls={`report-section-${sectionKey}`} onClick={() => setExpandedReportSections((current) => { const next = new Set(current); if (next.has(sectionKey)) next.delete(sectionKey); else next.add(sectionKey); return next })} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-100">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Worksheet section</p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{section.page.title}</h3>
            <p className="mt-1 text-sm text-slate-500">{section.visibleBlocks.length} response area{section.visibleBlocks.length === 1 ? '' : 's'} · {formatCountLabel(grouping.responses.length, 'response')}</p>
          </div>
          <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-blue-700">{isExpanded ? 'Hide details' : 'View details'}<ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} /></span>
        </button>

        {isExpanded && <div id={`report-section-${sectionKey}`} className="border-t border-slate-200 p-5">
          {section.contextText && <p className="mb-5 max-w-3xl text-sm leading-6 text-slate-600">{section.contextText}</p>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {section.visibleBlocks.map((block) => {
            const content = renderReportBlockCard(block, grouping.responses, viewerMode)
            if (!content) return null

            return (
              <div key={`${grouping.key}-${section.page.id}-${block.id}`} className={`${getBlockCardSpanClass(block)} rounded-2xl border border-slate-200 bg-white p-4 shadow-sm`}>
                {content}
              </div>
            )
          })}
          </div>
        </div>
        }
      </section>
    })}</div>
  }

  const clearFilters = () => {
    setGroupingFilter('all')
    setResponseLabelFilter('all')
    setVerdictFilter('all')
    setSearchFilter('')
  }

  const expandAllReportSections = () => {
    setExpandedReportSections(new Set(filteredGroupings.flatMap((grouping) =>
      getVisiblePageSections(grouping.responses).map((section) => `${grouping.key}:${section.page.id}`))))
  }

  const toggleResponseLabelFilter = (label: string) => {
    setResponseLabelFilter((current) => current === label ? 'all' : label)
    setExpandedReportSections(new Set())
  }

  const renderFilters = (title: string, description: string) => (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={expandAllReportSections} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Expand all sections</button>
          <button type="button" onClick={() => setExpandedReportSections(new Set())} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Collapse all</button>
          <button type="button" onClick={clearFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Clear filters</button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="block text-sm font-medium text-slate-700">
          Group report by
          <select value={reportGroupByBlockId} onChange={(event) => { setReportGroupByBlockId(event.target.value); setGroupingFilter('all'); setResponseLabelFilter('all'); setExpandedReportSections(new Set()) }} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">No grouping</option>
            {groupableBlockOptions.map((block) => <option key={block.id} value={block.id}>{getBlockDisplayLabel(block)}</option>)}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Filter {synthesisConfig.groupLabel}
          <select value={groupingFilter} onChange={(event) => setGroupingFilter(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="all">All {pluralizeLabel(synthesisConfig.groupLabel, groupings.length)}</option>
            {groupings.map((grouping) => (
              <option key={grouping.key} value={grouping.key}>{grouping.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Response label
          <select value={responseLabelFilter} onChange={(event) => setResponseLabelFilter(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="all">All response labels</option>
            {responseLabelFilterOptions.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Verdict
          <select value={verdictFilter} onChange={(event) => setVerdictFilter(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="all">All verdicts</option>
            {verdictFilterOptions.map((verdict) => (
              <option key={verdict} value={verdict}>{verdict}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Search
          <input
            value={searchFilter}
            onChange={(event) => setSearchFilter(event.target.value)}
            placeholder="Search labels and responses"
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
      </div>
    </section>
  )

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    setReportGroupByBlockId(definition.synthesis?.groupByBlockId || '')
    setGroupingFilter('all')
    setResponseLabelFilter('all')
    setExpandedReportSections(new Set())
  }, [definition.id, definition.synthesis?.groupByBlockId, definition.version])

  useEffect(() => {
    if (!initialResponses) return
    setResponses(initialResponses)
    setImportInfo(initialNotice || `Loaded ${initialResponses.length} submitted response${initialResponses.length === 1 ? '' : 's'} from this workbook.`)
  }, [initialNotice, initialResponses])

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    const parsed: WorksheetResponse[] = []
    let rejected = 0
    setError('')

    for (const file of files) {
      try {
        const text = await file.text()
        const json = JSON.parse(text) as WorksheetResponse
        const importError = getWorksheetResponseImportError(definition, json)
        if (importError) {
          rejected += 1
          setError(`Rejected ${file.name}: ${importError}`)
          continue
        }
        parsed.push(json)
      } catch {
        rejected += 1
        setError(`Rejected ${file.name}: malformed JSON.`)
      }
    }

    if (parsed.length > 0) {
      const sanitised = sanitiseWorksheetResponses(definition, parsed)
      setResponses((current) => {
        const combined = [...current, ...sanitised.responses]
        const uniqueByResponseId = new Map<string, WorksheetResponse>()
        combined.forEach((response) => {
          uniqueByResponseId.set(response.responseId, response)
        })
        return Array.from(uniqueByResponseId.values())
      })
      const totalRejected = rejected + sanitised.rejectedResponses
      setImportInfo(`Imported ${sanitised.responses.length} response file(s) for ${definition.title}.${totalRejected ? ` ${totalRejected} rejected.` : ''}${sanitised.rejectedValues ? ` ${sanitised.rejectedValues} malformed answer value(s) ignored.` : ''}`)
    } else if (files.length > 0) {
      setImportInfo(`No files imported.${rejected ? ` ${rejected} rejected.` : ''}`)
    }

    event.target.value = ''
  }

  const exportClassPdf = () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const groupingLabelPlural = pluralizeLabel(synthesisConfig.groupLabel, filteredGroupings.length)
    let y = 42

    const ensurePdfSpace = (height: number) => {
      if (y + height <= pageHeight - 42) return
      pdf.addPage()
      y = 52
    }

    const drawPdfCard = (title: string, lines: string[], tone: 'default' | 'section' = 'default') => {
      const innerWidth = pageWidth - 104
      const lineHeight = 12
      const wrappedLines = lines.flatMap((line) => pdf.splitTextToSize(line, innerWidth - 24))
      let remainingLines = wrappedLines.length ? wrappedLines : ['']
      let continued = false

      while (remainingLines.length > 0) {
        const fixedHeight = 34 + 14 + 10
        let capacity = getPdfLineCapacity(pageHeight - 42 - y - fixedHeight, lineHeight)
        if (capacity < 1) {
          pdf.addPage()
          y = 52
          capacity = getPdfLineCapacity(pageHeight - 42 - y - fixedHeight, lineHeight)
        }

        const pageLines = remainingLines.slice(0, Math.max(1, capacity))
        remainingLines = remainingLines.slice(pageLines.length)
        const cardHeight = 34 + pageLines.length * lineHeight + 14
        if (tone === 'section') {
          pdf.setFillColor(248, 250, 252)
          pdf.setDrawColor(203, 213, 225)
        } else {
          pdf.setFillColor(255, 255, 255)
          pdf.setDrawColor(226, 232, 240)
        }
        pdf.roundedRect(52, y, innerWidth, cardHeight, 10, 10, 'FD')
        pdf.setTextColor(15, 23, 42)
        pdf.setFontSize(11)
        pdf.text(continued ? `${title} (continued)` : title, 64, y + 18)
        pdf.setTextColor(71, 85, 105)
        pdf.setFontSize(9)
        pdf.text(pageLines, 64, y + 34)
        y += cardHeight + 10
        continued = true
      }
    }

    pdf.setFillColor(15, 23, 42)
    pdf.rect(0, 0, pageWidth, 78, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(22)
    pdf.text(`${definition.title} ��� Class Evaluation Report`, 52, 40)
    pdf.setFontSize(10)
    pdf.setTextColor(191, 219, 254)
    pdf.text(`Worksheet: ${definition.id} v${definition.version}   ���   Evaluations: ${filteredResponseCount}   ���   ${groupingLabelPlural}: ${filteredGroupings.length}   ���   Response labels: ${new Set(filteredGroupings.flatMap((grouping) => grouping.responses.map((response) => responseLabelLookup[response.responseId]))).size}`, 52, 60)

    y = 102
    pdf.setTextColor(15, 23, 42)
    pdf.setFontSize(14)
    pdf.text('Overview', 52, y)
    y += 18
    pdf.setFontSize(11)
    const cards = [
      `Total evaluations: ${filteredResponseCount}`,
      `${groupingLabelPlural}: ${filteredGroupings.length}`,
      `Response labels: ${new Set(filteredGroupings.flatMap((grouping) => grouping.responses.map((response) => responseLabelLookup[response.responseId]))).size}`,
    ]
    const cardWidth = 160
    cards.forEach((card, index) => {
      const x = 52 + index * (cardWidth + 18)
      pdf.setFillColor(248, 250, 252)
      pdf.roundedRect(x, y, cardWidth, 42, 7, 7, 'F')
      pdf.setTextColor(51, 65, 85)
      pdf.text(card, x + 12, y + 18)
    })
    y += 66

    filteredGroupings.forEach((grouping) => {
      const radarDimensions = structure.radarDimensions.length ? structure.radarDimensions : ['Score']
      const avgRadar = aggregateRadarValues(grouping.responses, radarDimensions, structure.radarBlockId)
      const metrics = Object.entries(avgRadar)
      const radarCardHeight = Math.max(120, 64 + metrics.length * 12)
      ensurePdfSpace(radarCardHeight + 6)
      pdf.setFillColor(255, 255, 255)
      pdf.setDrawColor(226, 232, 240)
      pdf.roundedRect(52, y, 500, radarCardHeight, 12, 12, 'FD')
      pdf.setTextColor(15, 23, 42)
      pdf.setFontSize(15)
      pdf.text(grouping.label, 68, y + 24)
      pdf.setFontSize(10)
      pdf.setTextColor(100, 116, 139)
      pdf.text(`${formatCountLabel(grouping.responses.length, 'evaluation')} in this ${synthesisConfig.groupLabel.toLowerCase()}`, 68, y + 38)

      drawPdfRadar(pdf, 190, y + 80, 46, avgRadar)

      pdf.setTextColor(51, 65, 85)
      pdf.setFontSize(9)
      metrics.forEach(([label, value], idx) => {
        const rowY = y + 52 + idx * 12
        pdf.text(label, 325, rowY)
        pdf.text(String(Number(value).toFixed(1)), 470, rowY)
        pdf.setDrawColor(226, 232, 240)
        pdf.line(325, rowY + 3, 470, rowY + 3)
      })

      y += radarCardHeight + 12

      const visibleSections = getVisiblePageSections(grouping.responses)
      visibleSections.forEach((section) => {
        drawPdfCard(section.page.title, section.contextText ? [section.contextText] : [], 'section')

        section.visibleBlocks.forEach((block) => {
          const entries = getBlockEntries(block, grouping.responses)
          if (entries.length === 0) return

          if (block.type === 'radar') {
            const configuredDimensions = Array.isArray(block.config?.dimensions)
              ? block.config.dimensions.map((dimension: any) => (typeof dimension === 'string' ? dimension : String(dimension?.label || ''))).filter(Boolean)
              : []
            const fallbackDimensions = Array.from(new Set(entries.flatMap(({ value }) => Object.keys((value as Record<string, number>) || {}))))
            const dimensions = configuredDimensions.length ? configuredDimensions : fallbackDimensions
            const averages = aggregateRadarValues(grouping.responses, dimensions, block.id)
            const radarHeight = Math.max(118, 46 + Object.keys(averages).length * 12)
            ensurePdfSpace(radarHeight + 10)
            pdf.setFillColor(255, 255, 255)
            pdf.setDrawColor(226, 232, 240)
            pdf.roundedRect(52, y, pageWidth - 104, radarHeight, 10, 10, 'FD')
            pdf.setTextColor(15, 23, 42)
            pdf.setFontSize(11)
            pdf.text(getBlockDisplayLabel(block), 64, y + 18)
            drawPdfRadar(pdf, 118, y + 70, 34, averages)
            pdf.setFontSize(9)
            pdf.setTextColor(71, 85, 105)
            Object.entries(averages).forEach(([label, score], index) => {
              pdf.text(`${label}: ${Number(score).toFixed(1)}`, 180, y + 34 + index * 12)
            })
            y += radarHeight + 12
            return
          }

          if (block.type === 'matrix') {
            const rows = Array.isArray(block.config?.rows) ? block.config.rows : []
            const lines = rows
              .map((row: string) => {
                const values = grouping.responses
                  .map((response) => Number(response.responses?.[block.id]?.[row]))
                  .filter((value) => Number.isFinite(value))
                if (!values.length) return ''
                const average = values.reduce((sum, value) => sum + value, 0) / values.length
                return `${row}: ${average.toFixed(1)}`
              })
              .filter(Boolean)
            drawPdfCard(getBlockDisplayLabel(block), lines)
            return
          }

          if (block.type === 'quadrant') {
            const averagePoint = aggregateQuadrantMean(grouping.responses, block.id)
            const lines = [
              `Average x position: ${averagePoint.x.toFixed(1)}`,
              `Average y position: ${averagePoint.y.toFixed(1)}`,
              ...entries
                .filter(({ value }) => typeof value?.rationale === 'string' && value.rationale.trim())
                .map(({ label, value }) => `${label}: ${String(value.rationale).trim()}`),
            ]
            drawPdfCard(getBlockDisplayLabel(block), lines)
            return
          }

          if (block.type === 'swot') {
            const categories = Array.isArray(block.config?.categories)
              ? block.config.categories
              : [
                  { id: 'strengths', label: 'Strengths' },
                  { id: 'weaknesses', label: 'Weaknesses' },
                  { id: 'opportunities', label: 'Opportunities' },
                  { id: 'threats', label: 'Threats' },
                ]
            const lines = categories.flatMap((category: any) => {
              const items = grouping.responses.flatMap((response) => (((response.responses?.[block.id] as Record<string, any>)?.[category.id] || []) as any[])
                .filter((item) => hasMeaningfulResponseValue(item?.text))
                .map((item) => `${responseLabelLookup[response.responseId]}: ${String(item.text).trim()}`))

              return items.length > 0 ? [`${category.label}:`, ...items] : [`${category.label}: No entries recorded.`]
            })
            drawPdfCard(getBlockDisplayLabel(block), lines)
            return
          }

          if (block.type === 'singleSelect' || block.type === 'verdict' || block.type === 'multipleChoice' || block.type === 'trueFalse') {
            const counts = new Map<string, string[]>()
            entries.forEach(({ label, value }) => {
              const selectedValues = Array.isArray(value) ? value : [value]
              selectedValues.map((item) => String(item).trim()).filter(Boolean).forEach((item) => {
                counts.set(item, [...(counts.get(item) || []), label])
              })
            })
            const lines = Array.from(counts.entries()).flatMap(([option, labels]) => [`${option}: ${labels.length}`, `  ${labels.join(', ')}`])
            drawPdfCard(getBlockDisplayLabel(block), lines)
            return
          }

          const lines = entries.map(({ label, value }) => `${label}: ${formatBlockValue(block, value)}`)
          drawPdfCard(getBlockDisplayLabel(block), lines)
        })
      })
    })

    pdf.save(`${definition.id}-class-report.pdf`)
  }

  const renderStudentView = () => (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-900 px-6 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Student synthesis</h1>
            <Link to={backTo} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-400 px-3 py-2 text-sm font-medium text-slate-100 hover:border-slate-200"><ArrowLeft className="h-4 w-4" />{backTo === '/teacher' ? 'Back to my workbooks' : 'Back to start'}</Link>
          </div>
          <p className="mt-2 text-sm text-slate-300">A student-facing summary of what the class is noticing across the submitted responses.</p>
          <p className="mt-2 text-xs text-slate-400">Expected worksheet: {definition.id} v{definition.version}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setMode('student')} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === 'student' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>Student synthesis</button>
            <button type="button" onClick={() => setMode('teacher')} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === 'teacher' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>Teacher report</button>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800">
            <Upload className="h-4 w-4" />
            Import response files
            <input type="file" multiple accept="application/json" className="hidden" onChange={handleFiles} />
          </label>
        </div>
        {importInfo && <p className="border-t border-slate-200 px-6 py-3 text-sm text-emerald-700">{importInfo}</p>}
        {error && <p className="border-t border-slate-200 px-6 py-3 text-sm text-red-600">{error}</p>}
        {synthesisConfig.warning && <p className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">{synthesisConfig.warning}</p>}
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Responses imported</div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{filteredResponseCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Response labels</div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{new Set(filteredGroupings.flatMap((grouping) => grouping.responses.map((response) => responseLabelLookup[response.responseId]))).size}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">{pluralizeLabel(synthesisConfig.groupLabel, filteredGroupings.length)}</div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{filteredGroupings.length}</div>
        </div>
      </section>

      {renderFilters('Synthesis filters', 'Filter the visible synthesis items by group, response label, verdict, or keyword.')}

      <section className="mt-8 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Class overview</p>
        <h2 className="mt-2 text-3xl font-bold text-slate-900">{studentSynthesis.headline}</h2>
        <p className="mt-4 max-w-3xl text-base text-slate-600">{studentSynthesis.summary}</p>

        {studentSynthesis.highlights.length > 0 && <div className="mt-6 grid gap-4 md:grid-cols-3">
          {studentSynthesis.highlights.map((highlight, index) => (
            <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Measured pattern {index + 1}</p>
              <p className="mt-3 text-sm text-slate-700">{highlight}</p>
            </div>
          ))}
        </div>}

        {studentSynthesis.recommendations.length > 0 && <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h3 className="text-lg font-semibold text-emerald-900">What the class could do next</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-emerald-800 marker:text-emerald-600">
            {studentSynthesis.recommendations.map((recommendation, index) => (
              <li key={index} className="pl-1">{recommendation}</li>
            ))}
          </ul>
        </div>}
      </section>

      <section className="mt-8 space-y-5">
        {filteredGroupings.map((grouping) => {
          return (
            <article key={grouping.key} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">{grouping.label}</h3>
                  {grouping.isMissingValue && <p className="mt-1 text-sm text-amber-700">Grouping value missing for one or more imported responses.</p>}
                </div>
                <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{formatCountLabel(grouping.responses.length, 'evaluation')}</span>
              </div>
              <p className="mt-3 text-sm text-slate-600">This {synthesisConfig.groupLabel.toLowerCase()} contains {formatCountLabel(grouping.responses.length, 'response')}. Expand its worksheet sections to inspect the recorded evidence.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {grouping.responses.map((response) => {
                  const label = responseLabelLookup[response.responseId]
                  return <button type="button" key={response.responseId} aria-pressed={responseLabelFilter === label} onClick={() => toggleResponseLabelFilter(label)} className={`rounded-full border px-3 py-1 text-sm transition ${responseLabelFilter === label ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50'}`}>{label}</button>
                })}
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">Aggregate</span>
              </div>

              {renderPageSections(grouping, 'student')}
            </article>
          )
        })}
        {filteredGroupings.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No synthesis items match the current filters.
          </div>
        )}
      </section>
    </main>
  )

  const renderTeacherView = () => (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-900 px-6 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Teacher report</h1>
            <Link to={backTo} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-400 px-3 py-2 text-sm font-medium text-slate-100 hover:border-slate-200"><ArrowLeft className="h-4 w-4" />{backTo === '/teacher' ? 'Back to my workbooks' : 'Back to start'}</Link>
          </div>
          <p className="mt-2 text-sm text-slate-300">A teacher-facing summary of class patterns, strengths, and reportable trends for the current worksheet.</p>
          <p className="mt-2 text-xs text-slate-400">Expected worksheet: {definition.id} v{definition.version}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setMode('student')} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === 'student' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>Student synthesis</button>
            <button type="button" onClick={() => setMode('teacher')} className={`rounded-lg px-3 py-2 text-sm font-medium ${mode === 'teacher' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>Teacher report</button>
          </div>
          <div className="flex gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800">
              <Upload className="h-4 w-4" />
              Import response files
              <input type="file" multiple accept="application/json" className="hidden" onChange={handleFiles} />
            </label>
            <button onClick={exportClassPdf} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500"><Download className="h-4 w-4" />Export class PDF</button>
          </div>
        </div>
        {importInfo && <p className="border-t border-slate-200 px-6 py-3 text-sm text-emerald-700">{importInfo}</p>}
        {error && <p className="border-t border-slate-200 px-6 py-3 text-sm text-red-600">{error}</p>}
        {synthesisConfig.warning && <p className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-800">{synthesisConfig.warning}</p>}
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Number of evaluations</div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{filteredResponseCount}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Distinct {pluralizeLabel(synthesisConfig.groupLabel, groupings.length)}</div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{filteredGroupings.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Response labels</div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{new Set(filteredGroupings.flatMap((grouping) => grouping.responses.map((response) => responseLabelLookup[response.responseId]))).size}</div>
        </div>
      </section>

      {renderFilters('Report filters', 'Filter the visible items to focus the teacher report on specific groups, labels, verdicts, or keywords.')}

      <section className="mt-8 space-y-6">
        {filteredGroupings.map((grouping) => {
          return (
            <article key={grouping.key} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{synthesisConfig.groupLabel}</p>
                  <h2 className="mt-1 text-2xl font-bold text-slate-900">{grouping.label}</h2>
                  {grouping.isMissingValue && <p className="mt-2 text-sm text-amber-700">This group contains responses where the configured grouping value was missing.</p>}
                </div>
                <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{formatCountLabel(grouping.responses.length, 'evaluation')}</span>
              </div>

              <div className="mb-5 flex flex-wrap gap-2">
                {grouping.responses.map((response) => {
                  const label = responseLabelLookup[response.responseId]
                  return <button type="button" key={response.responseId} aria-pressed={responseLabelFilter === label} onClick={() => toggleResponseLabelFilter(label)} className={`rounded-full border px-3 py-1 text-sm transition ${responseLabelFilter === label ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50'}`}>{label}</button>
                })}
              </div>

              {renderPageSections(grouping, 'teacher')}
            </article>
          )
        })}
        {filteredGroupings.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No report items match the current filters.
          </div>
        )}
      </section>
    </main>
  )

  return mode === 'student' ? renderStudentView() : renderTeacherView()
}

function ConditionalDisplayEditor({
  condition,
  candidates,
  onChange,
}: {
  condition?: WorksheetCondition
  candidates: WorksheetBlock[]
  onChange: (condition: WorksheetCondition | undefined) => void
}) {
  const source = candidates.find((block) => block.id === condition?.blockId)
  const expectedOptions = source ? getConditionOptions(source) : []
  const enableCondition = () => {
    const first = candidates[0]
    if (!first) return
    const firstOption = getConditionOptions(first)[0]
    onChange({ blockId: first.id, operator: 'equals', value: firstOption?.value ?? '' })
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-semibold text-slate-800">Visibility / Conditional display</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => onChange(undefined)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${!condition ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}>Always show</button>
        <button type="button" onClick={enableCondition} disabled={candidates.length === 0} className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${condition ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}>Show when…</button>
      </div>
      {candidates.length === 0 && <p className="mt-2 text-xs text-slate-500">Add a response question earlier in the worksheet to use conditional display.</p>}
      {condition && (
        <div className="mt-3 grid gap-2">
          <label className="text-xs font-medium text-slate-600">Earlier question
            <select value={condition.blockId} onChange={(event) => {
              const nextSource = candidates.find((block) => block.id === event.target.value)
              const firstOption = nextSource ? getConditionOptions(nextSource)[0] : undefined
              onChange({ ...condition, blockId: event.target.value, value: firstOption?.value ?? '' })
            }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {candidates.map((block) => <option key={block.id} value={block.id}>{getBlockDisplayLabel(block)}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Rule
            <select value={condition.operator} onChange={(event) => onChange({ ...condition, operator: event.target.value as ConditionOperator })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="equals">equals</option>
              <option value="notEquals">does not equal</option>
              <option value="contains">contains</option>
              <option value="notContains">does not contain</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Expected answer
            {expectedOptions.length > 0 ? (
              <select value={String(condition.value)} onChange={(event) => {
                const option = expectedOptions.find((candidate) => String(candidate.value) === event.target.value)
                onChange({ ...condition, value: option?.value ?? event.target.value })
              }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {expectedOptions.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
              </select>
            ) : <input type={source?.type === 'numeric' ? 'number' : 'text'} value={String(condition.value)} onChange={(event) => onChange({ ...condition, value: source?.type === 'numeric' && event.target.value !== '' ? Number(event.target.value) : event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />}
          </label>
          <button type="button" onClick={() => onChange(undefined)} className="justify-self-start text-xs font-medium text-red-700">Remove condition</button>
        </div>
      )}
    </div>
  )
}

function BuilderPage({
  definition,
  setDefinition,
  importWorksheetDefinition,
}: {
  definition: WorksheetDefinition
  setDefinition: WorksheetBuilderSetter
  importWorksheetDefinition: (event: ChangeEvent<HTMLInputElement>) => Promise<string | null>
}) {
  const { user, loading: authLoading } = useTeacherAuth()
  const blockLibrary: Array<{ type: string; label?: string; description: string }> = [
    { type: 'content', label: 'Information panel', description: 'Static instructional text, prompts, or explanatory copy.' },
    { type: 'richTextInfo', label: 'Rich text information', description: 'Teacher-authored formatted information displayed to learners.' },
    { type: 'richTextResponse', label: 'Rich text response', description: 'Formatted response area completed by the learner.' },
    { type: 'shortText', description: 'Single-line response for short answers like names or titles.' },
    { type: 'longText', description: 'Multi-line response for detailed written reflection.' },
    { type: 'url', description: 'Open a teacher-defined web link in a new browser tab.' },
    { type: 'singleSelect', description: 'Non-graded single answer from a set of options.' },
    { type: 'randomizer', description: 'Generate a single random item from a teacher-defined list for the learner to use.' },
    { type: 'multipleChoice', description: 'Graded multiple-choice question with optional multi-answer mode.' },
    { type: 'trueFalse', description: 'Turn a statement into a graded true/false question.' },
    { type: 'shortAnswer', description: 'Short-answer quiz question with a correct text response.' },
    { type: 'matching', description: 'Match each prompt to the correct answer from a set of choices.' },
    { type: 'fillBlank', description: 'Fill in the blank with the correct wording or value.' },
    { type: 'checklist', description: 'Multi-select checklist for choosing several items or behaviours.' },
    { type: 'ranking', description: 'Prioritise items by reordering them from most to least important.' },
    { type: 'categorize', label: 'Categorize', description: 'Sort a set of items into teacher-defined categories.' },
    { type: 'wordCloud', label: 'Word cloud', description: 'Collect a small set of words or short phrases from each learner.' },
    { type: 'confidence', label: 'Confidence check', description: 'Capture a quick learner confidence pulse with clear levels.' },
    { type: 'matrix', description: 'Compare multiple rows against a common scale or rubric.' },
    { type: 'imagePrompt', description: 'Display an image and invite a written reflection or analysis.' },
    { type: 'hotspot', label: 'Image hotspot', description: 'Ask learners to mark one or more locations directly on an image.' },
    { type: 'video', description: 'Embed a generic video from a direct URL or media file.' },
    { type: 'youtube', description: 'Embed a YouTube clip using a YouTube share or watch URL.' },
    { type: 'section', description: 'Add a clear visual divider or section label to structure the worksheet.' },
    { type: 'rating', description: 'Numeric slider scale for confidence, usefulness, or score input.' },
    { type: 'radar', description: 'Multi-dimension scoring visualized as a radar/spider chart.' },
    { type: 'quadrant', description: 'Two-axis placement activity for value vs risk mapping.' },
    { type: 'swot', description: 'Card-based SWOT board with strengths, weaknesses, opportunities, threats.' },
    { type: 'verdict', description: 'Final recommendation/decision options for concluding judgement.' },
    { type: 'numeric', label: 'Numeric answer', description: 'Graded number input with an optional tolerance and unit.' },
    { type: 'continuum', label: 'Continuum', description: 'Place an idea or judgement along a labelled spectrum.' },
    { type: 'decisionMatrix', label: 'Decision Matrix', description: 'Compare several options against shared criteria.' },
    { type: 'board', label: 'Board', description: 'Collect ideas into configurable labelled columns.' },
  ]

  const blockCategories = [
    { key: 'information', label: 'Information & structure', types: ['content', 'richTextInfo', 'section', 'url'] },
    { key: 'input', label: 'Learner input', types: ['richTextResponse', 'shortText', 'longText', 'singleSelect', 'checklist', 'ranking', 'categorize', 'wordCloud', 'confidence'] },
    { key: 'quiz', label: 'Quiz', types: ['multipleChoice', 'trueFalse', 'shortAnswer', 'matching', 'fillBlank', 'numeric'] },
    { key: 'interactive', label: 'Interactive & decisions', types: ['randomizer', 'verdict'] },
    { key: 'analysis', label: 'Assessment & analysis', types: ['rating', 'continuum', 'matrix', 'decisionMatrix', 'radar', 'quadrant', 'swot', 'board'] },
    { key: 'media', label: 'Media & evidence', types: ['imagePrompt', 'hotspot', 'video', 'youtube'] },
  ]

  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    information: true,
    input: true,
    quiz: false,
    interactive: false,
    analysis: false,
    media: false,
  })
  const [builderMode, setBuilderMode] = useState<'setup' | 'pages'>(() => definition.pages.length > 0 ? 'pages' : 'setup')
  const [librarySearch, setLibrarySearch] = useState('')
  const [openBlockMenuId, setOpenBlockMenuId] = useState<string | null>(null)
  const [aiPromptCopied, setAiPromptCopied] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [publishedWorkbook, setPublishedWorkbook] = useState<OnlineWorksheetRow | null>(null)
  const [publishedDefinitionJson, setPublishedDefinitionJson] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [pastedJson, setPastedJson] = useState('')
  const [pastedJsonError, setPastedJsonError] = useState('')
  const [importFileError, setImportFileError] = useState('')
  const closeImportDialog = useCallback(() => {
    setShowImportDialog(false)
  }, [])

  const [selectedPageId, setSelectedPageId] = useState(definition.pages[0]?.id || '')
  const [selectedBlockId, setSelectedBlockId] = useState(definition.pages[0]?.blocks[0]?.id || '')
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ blockId: string; edge: 'top' | 'bottom' } | null>(null)
  const [activeDrag, setActiveDrag] = useState<{ kind: 'library' | 'existing'; id: string } | null>(null)

  useEffect(() => {
    const firstPage = definition.pages[0]
    if (!firstPage) return

    if (!definition.pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(firstPage.id)
    }

    const pageForSelection = definition.pages.find((page) => page.id === selectedPageId) || firstPage
    if (!pageForSelection.blocks.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(pageForSelection.blocks[0]?.id || '')
    }
  }, [definition, selectedPageId, selectedBlockId])

  const selectedPage = definition.pages.find((page) => page.id === selectedPageId) || definition.pages[0]
  const selectedBlock = selectedPage?.blocks.find((block) => block.id === selectedBlockId) || selectedPage?.blocks[0]
  const selectedPageIndex = selectedPage ? definition.pages.findIndex((page) => page.id === selectedPage.id) : -1
  const priorPageResponseBlocks = definition.pages
    .slice(0, Math.max(0, selectedPageIndex))
    .flatMap((page) => page.blocks)
    .filter(isConditionSourceBlock)
  const priorBlockResponseBlocks = selectedPage && selectedBlock
    ? [...priorPageResponseBlocks, ...selectedPage.blocks.slice(0, selectedPage.blocks.findIndex((block) => block.id === selectedBlock.id)).filter(isConditionSourceBlock)]
    : priorPageResponseBlocks

  const addPage = () => {
    const nextPage: WorksheetPage = {
      id: createBuilderId('page'),
      title: `Page ${definition.pages.length + 1}`,
      timer: getDefaultPageTimer(),
      blocks: [{ id: createBuilderId('block'), type: 'content', title: 'New content block' }],
    }
    setDefinition((previous) => ({ ...previous, pages: [...previous.pages, nextPage] }))
    setSelectedPageId(nextPage.id)
    setSelectedBlockId(nextPage.blocks[0].id)
    setBuilderMode('pages')
  }

  const startWorksheet = (template: 'blank' | 'quiz' | 'reflection') => {
    const timestamp = Date.now()
    const templateBlocks: WorksheetBlock[] = template === 'quiz'
      ? [
          {
            id: createBuilderId('block'),
            type: 'content',
            title: 'Quiz introduction',
            description: 'Add instructions for learners before they begin.',
          },
          {
            id: createBuilderId('block'),
            type: 'multipleChoice',
            label: 'Question 1',
            required: true,
            config: getDefaultBlockConfig('multipleChoice', timestamp),
          },
        ]
      : template === 'reflection'
        ? [
            {
              id: createBuilderId('block'),
              type: 'content',
              title: 'Reflection',
              description: 'Introduce the activity and explain what learners should reflect on.',
            },
            {
              id: createBuilderId('block'),
              type: 'longText',
              label: 'What did you learn?',
              required: true,
              config: { placeholder: 'Write your reflection here.' },
            },
          ]
        : []

    const page: WorksheetPage = {
      id: createBuilderId('page'),
      title: template === 'quiz' ? 'Quiz' : template === 'reflection' ? 'Reflection' : 'Page 1',
      timer: getDefaultPageTimer(),
      blocks: templateBlocks,
    }

    setDefinition((previous) => ({ ...previous, pages: [page] }))
    setSelectedPageId(page.id)
    setSelectedBlockId(page.blocks[0]?.id || '')
    setBuilderMode('pages')
  }

  const moveSelectedPage = (direction: -1 | 1) => {
    if (!selectedPage) return
    const currentIndex = definition.pages.findIndex((page) => page.id === selectedPage.id)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= definition.pages.length) return

    setDefinition((previous) => {
      const nextPages = [...previous.pages]
      const [moved] = nextPages.splice(currentIndex, 1)
      nextPages.splice(targetIndex, 0, moved)
      const nextDefinition = { ...previous, pages: nextPages }
      if (getFirstConditionOrderViolation(nextDefinition)) {
        window.alert('This move would put conditional content before the question it depends on. Remove or update the condition first.')
        return previous
      }
      return nextDefinition
    })
  }

  const duplicateSelectedPage = () => {
    if (!selectedPage) return
    const pageIndex = definition.pages.findIndex((page) => page.id === selectedPage.id)
    if (pageIndex < 0) return

    const blockIdMap: Record<string, string> = {}
    const duplicatedBlocks = selectedPage.blocks.map((block) => {
      const id = createBuilderId('block')
      blockIdMap[block.id] = id
      return {
        ...JSON.parse(JSON.stringify(block)) as WorksheetBlock,
        id,
      }
    })

    const duplicatePage: WorksheetPage = {
      ...JSON.parse(JSON.stringify(selectedPage)) as WorksheetPage,
      id: createBuilderId('page'),
      title: `${selectedPage.title} (Copy)`,
      blocks: remapBlockConditions(duplicatedBlocks, blockIdMap),
    }

    setDefinition((previous) => {
      const nextPages = [...previous.pages]
      nextPages.splice(pageIndex + 1, 0, duplicatePage)
      return { ...previous, pages: nextPages }
    })
    setSelectedPageId(duplicatePage.id)
    setSelectedBlockId(duplicatePage.blocks[0]?.id || '')
  }

  const deleteSelectedPage = () => {
    if (!selectedPage) return

    if (definition.pages.length === 1) {
      if (!window.confirm('Delete the only page? This will create a new blank page.')) return
      const replacementPage: WorksheetPage = {
        id: createBuilderId('page'),
        title: 'Page 1',
        timer: getDefaultPageTimer(),
        blocks: [],
      }
      setDefinition((previous) => {
        const removedBlockIds = selectedPage.blocks.map((block) => block.id)
        return {
          ...clearConditionsReferencingBlocks(previous, removedBlockIds),
          synthesis: clearRemovedBlockReferences(previous.synthesis, removedBlockIds),
          pages: [replacementPage],
        }
      })
      setSelectedPageId(replacementPage.id)
      setSelectedBlockId('')
      return
    }

    const dependentConditions = getConditionReferenceCount(definition, selectedPage.blocks.map((block) => block.id))
    const deleteMessage = dependentConditions > 0
      ? `Delete this page and all of its blocks? This will also remove ${formatCountLabel(dependentConditions, 'condition')} that depends on its blocks.`
      : 'Delete this page and all of its blocks?'
    if (!window.confirm(deleteMessage)) return
    const currentIndex = definition.pages.findIndex((page) => page.id === selectedPage.id)
    const fallbackPage = definition.pages[Math.max(0, currentIndex - 1)]

    setDefinition((previous) => {
      const removedBlockIds = selectedPage.blocks.map((block) => block.id)
      const nextDefinition = clearConditionsReferencingBlocks(previous, removedBlockIds)
      return {
        ...nextDefinition,
        synthesis: clearRemovedBlockReferences(previous.synthesis, removedBlockIds),
        pages: nextDefinition.pages.filter((page) => page.id !== selectedPage.id),
      }
    })
    if (fallbackPage) {
      setSelectedPageId(fallbackPage.id)
      setSelectedBlockId(fallbackPage.blocks[0]?.id || '')
    }
  }

  const createBlockFromType = (libraryType: string): WorksheetBlock => {
    const timestamp = Date.now()
    const type = libraryType === 'richTextInfo' || libraryType === 'richTextResponse' ? 'richText' : libraryType
    const config = getDefaultBlockConfig(type, timestamp)
    if (libraryType === 'richTextInfo') {
      config.mode = 'information'
      config.contentHtml = '<p>Add rich text information for learners here.</p>'
    }
    if (libraryType === 'richTextResponse') config.mode = 'response'

    const label = libraryType === 'richTextInfo'
      ? 'Rich text information'
      : libraryType === 'richTextResponse'
        ? 'Rich text response'
        : `New ${type} block`

    return {
      id: createBuilderId('block'),
      type,
      label,
      title: type === 'content' ? 'New content block' : type === 'section' ? 'Section heading' : undefined,
      config,
    }
  }

  const addBlock = (type: string) => {
    if (!selectedPage) return
    const newBlock = createBlockFromType(type)
    setDefinition((previous) => ({
      ...previous,
      pages: previous.pages.map((page) => (page.id === selectedPage.id ? { ...page, blocks: [...page.blocks, newBlock] } : page)),
    }))
    setSelectedBlockId(newBlock.id)
  }

  const insertBlockAt = (type: string, insertIndex: number) => {
    if (!selectedPage) return
    const newBlock = createBlockFromType(type)
    setDefinition((previous) => ({
      ...previous,
      pages: previous.pages.map((page) => {
        if (page.id !== selectedPage.id) return page
        const nextBlocks = [...page.blocks]
        const boundedIndex = Math.max(0, Math.min(insertIndex, nextBlocks.length))
        nextBlocks.splice(boundedIndex, 0, newBlock)
        return { ...page, blocks: nextBlocks }
      }),
    }))
    setSelectedBlockId(newBlock.id)
  }

  const moveBlockWithinPage = (blockId: string, insertIndex: number) => {
    if (!selectedPage || !selectedPage.blocks.some((block) => block.id === blockId)) return

    setDefinition((previous) => {
      const nextDefinition = {
        ...previous,
        pages: previous.pages.map((page) => {
          if (page.id !== selectedPage.id) return page
          const nextBlocks = reorderBlocks(page.blocks, blockId, insertIndex)
          return nextBlocks === page.blocks ? page : { ...page, blocks: nextBlocks }
        }),
      }
      if (getFirstConditionOrderViolation(nextDefinition)) {
        window.alert('This move would put conditional content before the question it depends on. Remove or update the condition first.')
        return previous
      }
      return nextDefinition
    })
    setSelectedBlockId(blockId)
  }

  const readDragPayload = (event: DragEvent<HTMLElement>) => {
    const raw = event.dataTransfer.getData('application/x-worksheet-block')
    if (!raw) return null
    try {
      return JSON.parse(raw) as { kind: 'library'; blockType: string } | { kind: 'existing'; blockId: string }
    } catch {
      return null
    }
  }

  const createDragGhost = (event: DragEvent<HTMLElement>) => {
    const source = event.currentTarget
    const ghost = source.cloneNode(true) as HTMLElement
    const rect = source.getBoundingClientRect()

    ghost.style.position = 'fixed'
    ghost.style.top = '-9999px'
    ghost.style.left = '-9999px'
    ghost.style.width = `${rect.width}px`
    ghost.style.height = 'auto'
    ghost.style.opacity = '1'
    ghost.style.transform = 'none'
    ghost.style.boxShadow = '0 20px 40px rgba(15, 23, 42, 0.18)'
    ghost.style.pointerEvents = 'none'
    ghost.style.zIndex = '999999'
    document.body.appendChild(ghost)

    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    event.dataTransfer.setDragImage(ghost, offsetX, offsetY)

    window.setTimeout(() => {
      ghost.remove()
    }, 0)
  }

  const handleDropAtIndex = (event: DragEvent<HTMLElement>, insertIndex: number) => {
    event.preventDefault()
    const payload = readDragPayload(event)
    setDragOverIndex(null)
    setDropIndicator(null)
    setActiveDrag(null)
    if (!payload) return

    if (payload.kind === 'library') {
      insertBlockAt(payload.blockType, insertIndex)
      return
    }

    moveBlockWithinPage(payload.blockId, insertIndex)
  }

  const getInsertIndexFromHotzone = (event: DragEvent<HTMLElement>, baseIndex: number) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height
    if (ratio <= 0.5) {
      return { index: baseIndex, edge: 'top' as const }
    }
    return { index: baseIndex + 1, edge: 'bottom' as const }
  }

  const updateSelectedBlock = (partial: Partial<WorksheetBlock>) => {
    if (!selectedPage || !selectedBlock) return
    setDefinition((previous) => ({
      ...previous,
      pages: previous.pages.map((page) => (
        page.id !== selectedPage.id
          ? page
          : {
              ...page,
              blocks: page.blocks.map((block) => (block.id === selectedBlock.id ? { ...block, ...partial } : block)),
            }
      )),
    }))
  }

  const updatePageSettings = (partial: Partial<WorksheetPage>) => {
    if (!selectedPage) return
    setDefinition((previous) => ({
      ...previous,
      pages: previous.pages.map((page) => (page.id === selectedPage.id ? { ...page, ...partial } : page)),
    }))
  }

  const deleteSelectedBlock = () => {
    if (!selectedPage || !selectedBlock) return
    const synthesisEffects = [
      definition.synthesis?.groupByBlockId === selectedBlock.id ? 'group synthesis results' : '',
      definition.synthesis?.responseLabelBlockId === selectedBlock.id ? 'label individual responses in synthesis' : '',
    ].filter(Boolean)

    const dependentConditions = getConditionReferenceCount(definition, [selectedBlock.id])
    if (synthesisEffects.length > 0 || dependentConditions > 0) {
      const effects = [
        synthesisEffects.length > 0 ? `remove the ${synthesisEffects.join(' and ')} synthesis setting` : '',
        dependentConditions > 0 ? `remove ${formatCountLabel(dependentConditions, 'condition')} that depends on it` : '',
      ].filter(Boolean)
      const warningText = `This block is currently used elsewhere. Deleting it will ${effects.join(' and ')}.`
      if (!window.confirm(warningText)) return
    }

    setDefinition((previous) => {
      const nextDefinition = clearConditionsReferencingBlocks(previous, [selectedBlock.id])
      return {
        ...nextDefinition,
        synthesis: clearRemovedBlockReferences(previous.synthesis, [selectedBlock.id]),
        pages: nextDefinition.pages.map((page) => (
          page.id === selectedPage.id
            ? { ...page, blocks: page.blocks.filter((block) => block.id !== selectedBlock.id) }
            : page
        )),
      }
    })
  }

  const duplicateBlockAtIndex = (pageId: string, blockId: string, index: number) => {
    const blockToDuplicate = definition.pages
      .find((page) => page.id === pageId)?.blocks.find((block) => block.id === blockId)

    if (!blockToDuplicate) return

    const duplicateBlock: WorksheetBlock = {
      ...JSON.parse(JSON.stringify(blockToDuplicate)) as WorksheetBlock,
      id: createBuilderId('block'),
    }

    setDefinition((previous) => ({
      ...previous,
      pages: previous.pages.map((page) => {
        if (page.id !== pageId) return page
        const nextBlocks = [...page.blocks]
        nextBlocks.splice(index + 1, 0, duplicateBlock)
        return { ...page, blocks: nextBlocks }
      }),
    }))
    setSelectedBlockId(duplicateBlock.id)
  }

  const duplicateSelectedBlock = () => {
    if (!selectedPage || !selectedBlock) return
    const currentIndex = selectedPage.blocks.findIndex((block) => block.id === selectedBlock.id)
    if (currentIndex < 0) return
    duplicateBlockAtIndex(selectedPage.id, selectedBlock.id, currentIndex)
  }

  const deleteBlockAtIndex = (pageId: string, blockId: string) => {
    const block = definition.pages.find((page) => page.id === pageId)?.blocks.find((candidate) => candidate.id === blockId)
    if (!block) return

    const synthesisEffects = [
      definition.synthesis?.groupByBlockId === blockId ? 'group synthesis results' : '',
      definition.synthesis?.responseLabelBlockId === blockId ? 'label individual responses in synthesis' : '',
    ].filter(Boolean)
    const dependentConditions = getConditionReferenceCount(definition, [blockId])
    if (synthesisEffects.length > 0 || dependentConditions > 0) {
      const effects = [
        synthesisEffects.length > 0 ? `remove the ${synthesisEffects.join(' and ')} synthesis setting` : '',
        dependentConditions > 0 ? `remove ${formatCountLabel(dependentConditions, 'condition')} that depends on it` : '',
      ].filter(Boolean)
      if (!window.confirm(`This block is currently used elsewhere. Deleting it will ${effects.join(' and ')}.`)) return
    }

    setDefinition((previous) => {
      const nextDefinition = clearConditionsReferencingBlocks(previous, [blockId])
      return {
        ...nextDefinition,
        synthesis: clearRemovedBlockReferences(previous.synthesis, [blockId]),
        pages: nextDefinition.pages.map((page) => page.id === pageId
          ? { ...page, blocks: page.blocks.filter((candidate) => candidate.id !== blockId) }
          : page),
      }
    })
    if (selectedBlockId === blockId) setSelectedBlockId('')
    setOpenBlockMenuId(null)
  }

  const selectedConfig = (selectedBlock?.config || {}) as Record<string, any>
  const optionList = getLabeledConfigItems(selectedConfig.options, 'option')
  const randomizerItems = Array.isArray(selectedConfig.items) ? (selectedConfig.items as string[]) : []
  const rankingOptions = getLabeledConfigItems(selectedConfig.options, 'option')
  const matrixRows = getLabeledConfigItems(selectedConfig.rows, 'row')
  const decisionOptions = getLabeledConfigItems(selectedConfig.options, 'option')
  const decisionCriteria = getLabeledConfigItems(selectedConfig.criteria, 'criterion')
  const boardColumns = Array.isArray(selectedConfig.columns) ? selectedConfig.columns as Array<{ id: string; label: string; description?: string }> : []
  const radarDimensions = Array.isArray(selectedConfig.dimensions)
    ? (selectedConfig.dimensions as any[]).map((dimension, index) => {
      if (typeof dimension === 'string') {
        return { id: `radar-dimension-${index + 1}`, label: dimension }
      }
      return { id: String(dimension.id || `radar-dimension-${index + 1}`), label: String(dimension.label || '') }
    })
    : []
  const swotCategories = Array.isArray(selectedConfig.categories)
    ? (selectedConfig.categories as any[]).map((category, index) => {
      if (typeof category === 'string') {
        return { id: `swot-category-${index + 1}`, label: category }
      }
      return { id: String(category.id || `swot-category-${index + 1}`), label: String(category.label || '') }
    })
    : []

  const updateSelectedConfig = (partial: Record<string, any>) => {
    if (!selectedBlock) return
    setDefinition((previous) => sanitizeWorksheetDefinition(updateBlockConfigWithOptionReferences(previous, selectedBlock.id, partial)))
  }

  const updateWorksheetDefinition = (partial: Partial<WorksheetDefinition>) => {
    setDefinition((previous) => ({ ...previous, ...partial }))
  }

  const updateWorksheetSettings = (partial: Partial<WorksheetSettings>) => {
    setDefinition((previous) => ({
      ...previous,
      settings: {
        ...previous.settings,
        ...partial,
      },
    }))
  }

  const synthesisBlockOptions = getResponseProducingBlocks(definition).map((block) => ({
    value: block.id,
    label: getBlockDisplayLabel(block),
  }))
  const synthesisSettings = definition.synthesis || {}

  const shareLink = publishedWorkbook
    ? `${window.location.origin}${window.location.pathname}#/join/${publishedWorkbook.public_code}`
    : ''
  const currentDefinitionJson = useMemo(() => JSON.stringify(definition), [definition])
  const publishCardState = getPublishCardState(publishError, publishedWorkbook, publishedDefinitionJson, currentDefinitionJson)

  const handlePublish = async () => {
    const definitionToPublish = definition
    const definitionToPublishJson = JSON.stringify(definitionToPublish)
    setPublishError('')
    setPublishedWorkbook(null)
    setPublishedDefinitionJson(null)
    setShareCopied(false)
    if (!user) {
      setPublishError('Sign in with a teacher account before publishing.')
      return
    }
    if (!definitionToPublish.title.trim() || definitionToPublish.pages.length === 0) {
      setPublishError('Add a title and at least one page before publishing.')
      return
    }
    const unanswerableBlocks = getUnanswerableRequiredBlocks(definitionToPublish)
    if (unanswerableBlocks.length > 0) {
      const labels = unanswerableBlocks.slice(0, 3).map((block) => getBlockDisplayLabel(block))
      const remainingCount = unanswerableBlocks.length - labels.length
      setPublishError(`Required blocks need answerable choices before publishing: ${labels.join(', ')}${remainingCount > 0 ? ` and ${remainingCount} more` : ''}.`)
      return
    }

    setPublishing(true)
    try {
      const workbook = await publishWorksheet(definitionToPublish)
      setPublishedWorkbook(workbook)
      setPublishedDefinitionJson(definitionToPublishJson)
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'The workbook could not be published. Please try again.')
    } finally {
      setPublishing(false)
    }
  }

  const copyShareLink = async () => {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 1800)
    } catch {
      setPublishError('Copying was blocked. Select and copy the link below instead.')
    }
  }

  const importPastedJson = () => {
    setPastedJsonError('')
    setImportFileError('')
    try {
      const parsed = JSON.parse(pastedJson) as unknown
      if (!isWorksheetDefinition(parsed)) {
        setPastedJsonError('This is valid JSON, but every page needs id, title, and blocks, and every block needs id and type.')
        return
      }
      const sanitized = sanitizeWorksheetDefinition(normalizeWorksheetDefinitionStableIds(parsed))
      setDefinition(sanitized)
      setSelectedPageId(sanitized.pages[0]?.id || '')
      setSelectedBlockId(sanitized.pages[0]?.blocks[0]?.id || '')
      setBuilderMode(sanitized.pages.length > 0 ? 'pages' : 'setup')
      setPastedJson('')
      setShowImportDialog(false)
    } catch {
      setPastedJsonError('The pasted text is not valid JSON. Check for missing commas, quotes, or brackets.')
    }
  }

  const updateSynthesisSettings = (partial: Partial<WorksheetSynthesisSettings>) => {
    setDefinition((previous) => {
      const merged = { ...(previous.synthesis || {}), ...partial }
      const next: WorksheetSynthesisSettings = {}
      const groupByBlockId = trimSynthesisValue(merged.groupByBlockId)
      const groupLabel = trimSynthesisValue(merged.groupLabel)
      const responseLabelBlockId = trimSynthesisValue(merged.responseLabelBlockId)

      if (groupByBlockId) next.groupByBlockId = groupByBlockId
      if (groupLabel) next.groupLabel = groupLabel
      if (responseLabelBlockId) next.responseLabelBlockId = responseLabelBlockId

      return {
        ...previous,
        synthesis: isSynthesisSettingsEmpty(next) ? undefined : next,
      }
    })
  }

  const aiWorksheetPrompt = `Create an interactive worksheet as valid JSON that I can import into the Worksheet Builder.

Topic: [insert topic]
Learners: [insert age, year group, or level]
Learning goal: [insert the outcome learners should achieve]
Duration: [insert approximate time]

Structure the worksheet into clear pages that move from explanation to practice, reflection, and a final check for understanding. Use a varied but purposeful selection of these block types: content, richText, section, shortText, longText, singleSelect, checklist, ranking, categorize, wordCloud, confidence, multipleChoice, trueFalse, shortAnswer, matching, fillBlank, numeric, imagePrompt, hotspot, video, youtube, url, randomizer, rating, continuum, matrix, decisionMatrix, radar, quadrant, swot, board, and verdict.

Return JSON only. The root object must include id, version, title, description, settings, and pages. Every page must include id, title, and blocks. Every block must include a unique id and supported type. Add clear labels, helpful descriptions, sensible config values, and required: true only where a response is genuinely necessary. For graded blocks, include correctAnswer, points, showFeedback, and a useful explanation. Use richText with config.mode = "information" for teacher-authored formatted guidance and config.mode = "response" for learner-authored formatted answers.

Use this settings shape:
{
  "navigation": "sequential",
  "allowPageJumping": false,
  "autosave": true,
  "showProgress": true,
  "completionMessage": "Your work has been exported. Follow your teacher's instructions to submit it.",
  "exports": { "json": true, "pdf": true }
}

Make the language concise and appropriate for the learners. Do not include Markdown fences, commentary, or properties outside the JSON.`

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8">
      <div className="mb-6 grid items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Builder</p>
          <h1 className="text-3xl font-bold text-slate-900">Worksheet Builder</h1>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="inline-flex rounded-xl border border-slate-300 bg-white p-1 shadow-sm" aria-label="Builder section">
            <button
              type="button"
              aria-pressed={builderMode === 'setup'}
              onClick={() => setBuilderMode('setup')}
              className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${builderMode === 'setup' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Setup
            </button>
            <button
              type="button"
              aria-pressed={builderMode === 'pages'}
              onClick={() => setBuilderMode('pages')}
              className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${builderMode === 'pages' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              Pages &amp; blocks
            </button>
          </div>
          {definition.pages.length > 0 && (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs text-white" aria-hidden="true">✓</span>
              Setup complete
            </span>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/" title="Back to start" aria-label="Back to start" className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400"><ArrowLeft className="h-3.5 w-3.5" />Back</Link>
          <button type="button" title="Load worksheet JSON" onClick={() => { setPastedJsonError(''); setImportFileError(''); setShowImportDialog(true) }} className="inline-flex h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400">
            <Upload className="h-4 w-4" />
            Load JSON
          </button>
          <Link to="/preview" className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400"><Eye className="h-3.5 w-3.5" />Preview</Link>
          <button type="button" onClick={() => void handlePublish()} disabled={publishing || authLoading} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-60"><CloudUpload className="h-3.5 w-3.5" />{publishing ? 'Publishing…' : 'Publish & invite'}</button>
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = `${definition.id || 'worksheet-definition'}.json`
              anchor.click()
              URL.revokeObjectURL(url)
            }}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
          >
            <FileUp className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>

      {publishCardState !== 'hidden' && (
        <section role={publishCardState === 'error' ? 'alert' : 'status'} className={`mb-6 rounded-2xl border p-5 shadow-sm ${publishCardState === 'published' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          {publishCardState === 'published' && publishedWorkbook ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Published and ready to share</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Invite learners to {publishedWorkbook.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg border border-emerald-300 bg-white px-4 py-2 font-mono text-lg font-bold tracking-[0.18em] text-emerald-900">{publishedWorkbook.public_code}</span>
                  <span className="break-all text-sm text-slate-600">{shareLink}</span>
                </div>
              </div>
              <button type="button" onClick={() => void copyShareLink()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600"><Copy className="h-4 w-4" />{shareCopied ? 'Link copied' : 'Copy invite link'}</button>
            </div>
          ) : publishCardState === 'unpublished' && publishedWorkbook ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-amber-900">
                <p className="text-xs font-semibold uppercase tracking-[0.16em]">Unpublished changes</p>
                <h2 className="mt-1 text-xl font-bold">Republish to update learners</h2>
                <p className="mt-2 text-sm">Learners still see the last published version of {publishedWorkbook.title}.</p>
              </div>
              <button type="button" onClick={() => void handlePublish()} disabled={publishing || authLoading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"><CloudUpload className="h-4 w-4" />{publishing ? 'Publishing…' : 'Republish'}</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-amber-900">
              <p>{publishError}</p>
              {!user && <Link to="/account" className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">Teacher sign in</Link>}
            </div>
          )}
        </section>
      )}

      <ModalOverlay isOpen={showImportDialog} onClose={closeImportDialog} labelledBy="import-json-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Import workbook</p>
                <h2 id="import-json-title" className="mt-1 text-2xl font-bold text-slate-900">Load JSON</h2>
                <p className="mt-2 text-sm text-slate-600">Upload a JSON file or paste the full workbook definition below.</p>
              </div>
              <button type="button" data-modal-initial-focus aria-label="Close JSON import" onClick={closeImportDialog} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-slate-400">Close</button>
            </div>

            <label className="mt-6 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-700 hover:border-blue-400 hover:bg-blue-50">
              <Upload className="h-4 w-4" />Choose a JSON file
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (event) => {
                  setImportFileError('')
                  setPastedJsonError('')
                  const error = await importWorksheetDefinition(event)
                  if (error) {
                    setImportFileError(error)
                    return
                  }
                  setShowImportDialog(false)
                }}
              />
            </label>
            {importFileError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{importFileError}</p>}

            <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400"><span className="h-px flex-1 bg-slate-200" />or paste JSON<span className="h-px flex-1 bg-slate-200" /></div>

            <label className="block text-sm font-medium text-slate-700">
              Workbook JSON
              <textarea
                value={pastedJson}
                onChange={(event) => { setPastedJson(event.target.value); setPastedJsonError(''); setImportFileError('') }}
                placeholder={'{\n  "id": "my-workbook",\n  "version": 1,\n  ...\n}'}
                spellCheck={false}
                className="mt-2 min-h-64 w-full resize-y rounded-xl border border-slate-300 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {pastedJsonError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{pastedJsonError}</p>}

            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={closeImportDialog} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
              <button type="button" onClick={importPastedJson} disabled={!pastedJson.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">Import pasted JSON</button>
            </div>
          </div>
      </ModalOverlay>

      <div className="grid gap-6 xl:grid-cols-[260px_1fr_360px]">
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Wrench className="h-5 w-5" />
            Block library
          </h2>
          {builderMode === 'pages' && !selectedPage && (
            <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-800">
              Create your first page before adding blocks.
            </p>
          )}
          <label className="relative mb-4 block">
            <span className="sr-only">Search blocks</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={librarySearch}
              onChange={(event) => setLibrarySearch(event.target.value)}
              placeholder="Search blocks..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <div className="space-y-3">
            {blockCategories.map((category) => {
              const query = librarySearch.trim().toLowerCase()
              const categoryEntries = blockLibrary.filter((entry) => category.types.includes(entry.type)
                && (!query || entry.type.toLowerCase().includes(query) || entry.label?.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query)))
              const isExpanded = expandedCategories[category.key] ?? true

              if (categoryEntries.length === 0) return null

              return (
                <div key={category.key} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedCategories((previous) => ({ ...previous, [category.key]: !isExpanded }))}
                    className="flex w-full items-center justify-between bg-slate-100 px-3 py-2 text-left text-sm font-semibold text-slate-700"
                  >
                    <span>{category.label}</span>
                    <ChevronRight aria-hidden="true" className={`h-4 w-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>

                  {(isExpanded || Boolean(query)) && (
                    <div className="space-y-2 p-2">
                      {categoryEntries.map((entry) => (
                        <button
                          key={entry.type}
                          onClick={() => addBlock(entry.type)}
                          title={entry.description}
                          disabled={!selectedPage}
                          draggable={Boolean(selectedPage)}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'copyMove'
                            setActiveDrag({ kind: 'library', id: entry.type })
                            event.dataTransfer.setData(
                              'application/x-worksheet-block',
                              JSON.stringify({ kind: 'library', blockType: entry.type }),
                            )
                            createDragGhost(event)
                          }}
                          onDragEnd={() => setActiveDrag(null)}
                          className={`flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${activeDrag?.kind === 'library' && activeDrag.id === entry.type ? 'border-blue-400 bg-blue-100 shadow-lg ring-2 ring-blue-200 opacity-100' : ''}`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                              <BlockTypeIcon type={entry.type} />
                            </span>
                            {entry.label || entry.type}
                          </span>
                          <Plus className="h-4 w-4" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </aside>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {builderMode === 'pages' && !selectedPage && (
            <div className="mb-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                <Plus className="h-6 w-6" />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Start building</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">Create your first page</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                Begin with a blank page or use a simple starter structure. You can change every block afterwards.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button type="button" onClick={() => startWorksheet('blank')} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500">Blank page</button>
                <button type="button" onClick={() => startWorksheet('quiz')} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-blue-400">Quiz starter</button>
                <button type="button" onClick={() => startWorksheet('reflection')} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-blue-400">Reflection starter</button>
              </div>
            </div>
          )}
          {builderMode === 'setup' && (
            <>
          <div className="mb-4 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-700">Build with your AI</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">Ask an AI assistant to draft the worksheet JSON</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Replace the bracketed details in the sample prompt, send it to your preferred AI assistant, then save its JSON response and use <strong>Load JSON</strong> above. Preview and check every question before sharing it with learners.</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(aiWorksheetPrompt)
                    setAiPromptCopied(true)
                    window.setTimeout(() => setAiPromptCopied(false), 1800)
                  } catch {
                    setAiPromptCopied(false)
                  }
                }}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-violet-700 px-3 text-xs font-semibold text-white shadow-sm hover:bg-violet-600"
              >
                {aiPromptCopied ? 'Prompt copied' : 'Copy sample prompt'}
              </button>
            </div>
            <details className="mt-4 rounded-xl border border-violet-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">View sample prompt</summary>
              <div className="border-t border-violet-100 p-4">
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6 text-slate-600">{aiWorksheetPrompt}</pre>
              </div>
            </details>
            <p className="mt-3 text-xs text-slate-500">AI-generated content can be inaccurate. Check curriculum alignment, answer keys, external links, accessibility text, and age suitability.</p>
          </div>

          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Worksheet setup</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Configure the worksheet and learner completion flow</h2>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Worksheet ID
                <input
                  value={definition.id}
                  onChange={(event) => updateWorksheetDefinition({ id: event.target.value })}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Version
                <input
                  type="number"
                  min={1}
                  value={definition.version}
                  onChange={(event) => updateWorksheetDefinition({ version: Math.max(1, Number(event.target.value) || 1) })}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Worksheet title
                <input
                  value={definition.title}
                  onChange={(event) => updateWorksheetDefinition({ title: event.target.value })}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Description
                <textarea
                  value={definition.description}
                  onChange={(event) => updateWorksheetDefinition({ description: event.target.value })}
                  className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Navigation mode
                <select
                  value={definition.settings.navigation}
                  onChange={(event) => updateWorksheetSettings({ navigation: event.target.value as 'sequential' | 'free' })}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="sequential">Sequential</option>
                  <option value="free">Free</option>
                </select>
              </label>

              <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:col-span-1">
                <label className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
                  <span>Allow page jumping</span>
                  <input
                    type="checkbox"
                    checked={Boolean(definition.settings.allowPageJumping)}
                    onChange={(event) => updateWorksheetSettings({ allowPageJumping: event.target.checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
                  <span>Autosave</span>
                  <input
                    type="checkbox"
                    checked={Boolean(definition.settings.autosave)}
                    onChange={(event) => updateWorksheetSettings({ autosave: event.target.checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
                  <span>Show progress</span>
                  <input
                    type="checkbox"
                    checked={Boolean(definition.settings.showProgress)}
                    onChange={(event) => updateWorksheetSettings({ showProgress: event.target.checked })}
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Completion popup message
                <textarea
                  value={definition.settings.completionMessage || ''}
                  onChange={(event) => updateWorksheetSettings({ completionMessage: event.target.value })}
                  placeholder="Your response JSON has been downloaded. Upload it to your teacher or learning platform."
                  className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
                <p className="mt-2 text-xs text-slate-500">Shown to learners after Finish exports the worksheet response JSON.</p>
              </label>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Synthesis settings</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Configure how responses are grouped in synthesis</h2>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-sm font-medium text-slate-700">
                Group responses by
                <select
                  value={synthesisSettings.groupByBlockId || ''}
                  onChange={(event) => updateSynthesisSettings({ groupByBlockId: event.target.value || undefined })}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">None</option>
                  {synthesisBlockOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Group label
                <input
                  value={synthesisSettings.groupLabel || ''}
                  onChange={(event) => updateSynthesisSettings({ groupLabel: event.target.value })}
                  placeholder="AI Tool"
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Label individual responses by
                <select
                  value={synthesisSettings.responseLabelBlockId || ''}
                  onChange={(event) => updateSynthesisSettings({ responseLabelBlockId: event.target.value || undefined })}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">None</option>
                  {synthesisBlockOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {synthesisBlockOptions.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">Add at least one response-producing block to configure synthesis grouping.</p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setBuilderMode('pages')}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            >
              Continue to pages &amp; blocks
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

            </>
          )}

          {builderMode === 'pages' && (
            <>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Build worksheet</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">Pages &amp; blocks</h2>
          </div>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {definition.pages.map((page) => (
                <button key={page.id} onClick={() => setSelectedPageId(page.id)} className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${page.id === selectedPageId ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                  {page.title}
                </button>
              ))}
            </div>
            <button onClick={addPage} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-400 hover:text-blue-700"><Plus className="h-4 w-4" />Add page</button>
          </div>

          {selectedPage && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="block text-sm font-medium text-slate-700">Page title</label>
                <input value={selectedPage.title} onChange={(event) => updatePageSettings({ title: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />

                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-700">Enable page timer</span>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedPage.timer?.enabled ?? false)}
                      onChange={(event) => {
                        const nextTimer = { ...(selectedPage.timer ?? getDefaultPageTimer()), enabled: event.target.checked }
                        updatePageSettings({ timer: nextTimer })
                      }}
                    />
                  </label>

                  {selectedPage.timer?.enabled && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Duration (seconds)
                        <input
                          type="number"
                          min={1}
                          value={Number(selectedPage.timer?.durationSeconds ?? 300)}
                          onChange={(event) => {
                            const durationSeconds = Math.max(1, Number(event.target.value) || 1)
                            updatePageSettings({ timer: { ...(selectedPage.timer ?? getDefaultPageTimer()), durationSeconds } })
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        />
                      </label>

                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Behaviour
                        <select
                          value={selectedPage.timer?.behaviour ?? 'advisory'}
                          onChange={(event) => {
                            const behaviour = event.target.value as 'advisory' | 'auto-advance'
                            updatePageSettings({ timer: { ...(selectedPage.timer ?? getDefaultPageTimer()), behaviour } })
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                        >
                          <option value="advisory">Advisory</option>
                          <option value="auto-advance">Auto-advance</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>

                <ConditionalDisplayEditor
                  condition={selectedPage.condition}
                  candidates={priorPageResponseBlocks}
                  onChange={(condition) => updatePageSettings({ condition })}
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => moveSelectedPage(-1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">Move page up</button>
                  <button type="button" onClick={() => moveSelectedPage(1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">Move page down</button>
                  <button type="button" onClick={duplicateSelectedPage} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">Duplicate page</button>
                  <button type="button" onClick={deleteSelectedPage} className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">Delete page</button>
                </div>
              </div>
              <div className="space-y-3">
                {selectedPage.blocks.map((block, index) => (
                  <div
                    key={block.id}
                    onDragOver={(event) => {
                      event.preventDefault()
                      const target = getInsertIndexFromHotzone(event, index)
                      if (!target) {
                        setDropIndicator(null)
                        setDragOverIndex(null)
                        return
                      }
                      setDropIndicator({ blockId: block.id, edge: target.edge })
                      setDragOverIndex(target.index)
                    }}
                    onDragLeave={(event) => {
                      const next = event.relatedTarget as Node | null
                      if (next && event.currentTarget.contains(next)) return
                      if (dropIndicator?.blockId === block.id) {
                        setDropIndicator(null)
                        setDragOverIndex(null)
                      }
                    }}
                    onDrop={(event) => {
                      const target = getInsertIndexFromHotzone(event, index)
                      if (!target) return
                      handleDropAtIndex(event, target.index)
                    }}
                    className="relative"
                  >
                    <div
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        setActiveDrag({ kind: 'existing', id: block.id })
                        event.dataTransfer.setData(
                          'application/x-worksheet-block',
                          JSON.stringify({ kind: 'existing', blockId: block.id }),
                        )
                        createDragGhost(event)
                      }}
                      onDragEnd={() => setActiveDrag(null)}
                      className={`cursor-grab rounded-xl border p-3 transition ${selectedBlockId === block.id ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white'} ${activeDrag?.kind === 'existing' && activeDrag.id === block.id ? 'border-blue-500 bg-blue-100 shadow-xl ring-2 ring-blue-200 opacity-100' : ''}`}
                    >
                      {dropIndicator?.blockId === block.id && dropIndicator.edge === 'top' && (
                        <div className="pointer-events-none absolute -top-1.5 left-2 right-2 h-2 rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 shadow-[0_0_0_3px_rgba(59,130,246,0.25)] animate-pulse" />
                      )}
                      {dropIndicator?.blockId === block.id && dropIndicator.edge === 'bottom' && (
                        <div className="pointer-events-none absolute -bottom-1.5 left-2 right-2 h-2 rounded-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500 shadow-[0_0_0_3px_rgba(59,130,246,0.25)] animate-pulse" />
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" onClick={() => setSelectedBlockId(block.id)} className="flex w-full items-center justify-between text-left">
                          <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700 shadow-sm">
                              <BlockTypeIcon type={block.type} className="h-5 w-5" />
                            </span>
                            {block.label || block.title || block.type}
                          </span>
                          <span className="text-xs uppercase tracking-[0.15em] text-slate-500">{block.type}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setOpenBlockMenuId((current) => current === block.id ? null : block.id)
                          }}
                          aria-label={`Actions for ${block.label || block.title || block.type}`}
                          aria-expanded={openBlockMenuId === block.id}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        >
                          <MoreVertical className="h-5 w-5" />
                        </button>
                        {openBlockMenuId === block.id && (
                          <div className="absolute right-2 top-10 z-10 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                duplicateBlockAtIndex(selectedPage.id, block.id, index)
                                setOpenBlockMenuId(null)
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteBlockAtIndex(selectedPage.id, block.id)}
                              className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                        Drag block to reorder
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            moveBlockWithinPage(block.id, index - 1)
                          }}
                          disabled={index === 0}
                          aria-label={`Move ${block.label || block.title || block.type} up`}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            moveBlockWithinPage(block.id, index + 2)
                          }}
                          disabled={index === selectedPage.blocks.length - 1}
                          aria-label={`Move ${block.label || block.title || block.type} down`}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Move down
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <div
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDropIndicator(null)
                    setDragOverIndex(selectedPage.blocks.length)
                  }}
                  onDrop={(event) => handleDropAtIndex(event, selectedPage.blocks.length)}
                  className={`rounded-xl border border-dashed px-3 py-2 text-center text-xs font-medium uppercase tracking-[0.12em] ${dragOverIndex === selectedPage.blocks.length ? 'border-blue-500 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-800 ring-2 ring-blue-200' : 'border-slate-300 bg-white text-slate-500'}`}
                >
                  Drop here to add or move block to end
                </div>
              </div>
            </div>
          )}
            </>
          )}
        </section>

        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Selected block</h2>
          {!selectedBlock && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
              <p className="text-sm font-semibold text-slate-800">No block selected</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Create a page, then add or select a block to edit its content and settings here.
              </p>
            </div>
          )}
          {selectedBlock && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Type
                <input value={selectedBlock.type} disabled className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-600" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Label
                <input value={selectedBlock.label || ''} onChange={(event) => updateSelectedBlock({ label: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Helper text
                <textarea value={selectedBlock.description || ''} onChange={(event) => updateSelectedBlock({ description: event.target.value })} className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Required
                <input type="checkbox" checked={Boolean(selectedBlock.required)} onChange={(event) => updateSelectedBlock({ required: event.target.checked })} className="mt-2 ml-2" />
              </label>

              <ConditionalDisplayEditor
                condition={selectedBlock.condition}
                candidates={priorBlockResponseBlocks}
                onChange={(condition) => updateSelectedBlock({ condition })}
              />

              {(selectedBlock.type === 'shortText' || selectedBlock.type === 'longText') && (
                <label className="block text-sm font-medium text-slate-700">
                  Placeholder
                  <input
                    value={selectedConfig.placeholder || ''}
                    onChange={(event) => updateSelectedConfig({ placeholder: event.target.value })}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              )}

              {selectedBlock.type === 'rating' && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">Rating scale</p>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Min
                      <input
                        type="number"
                        value={Number(selectedConfig.min ?? 0)}
                        onChange={(event) => updateSelectedConfig({ min: Number(event.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm normal-case"
                      />
                    </label>
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Max
                      <input
                        type="number"
                        value={Number(selectedConfig.max ?? 10)}
                        onChange={(event) => updateSelectedConfig({ max: Number(event.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm normal-case"
                      />
                    </label>
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Step
                      <input
                        type="number"
                        value={Number(selectedConfig.step ?? 1)}
                        onChange={(event) => updateSelectedConfig({ step: Number(event.target.value) })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm normal-case"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Default slider value
                    <input
                      type="number"
                      value={Number(selectedConfig.defaultValue ?? 5)}
                      onChange={(event) => updateSelectedConfig({ defaultValue: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    />
                  </label>
                </div>
              )}

              {selectedBlock.type === 'content' && (
                <>
                  <label className="block text-sm font-medium text-slate-700">
                    Content title
                    <input value={selectedBlock.title || ''} onChange={(event) => updateSelectedBlock({ title: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Content description
                    <textarea value={selectedBlock.description || ''} onChange={(event) => updateSelectedBlock({ description: event.target.value })} className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                </>
              )}

              {selectedBlock.type === 'richText' && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Rich text mode
                    <select
                      value={selectedConfig.mode || 'response'}
                      onChange={(event) => updateSelectedConfig({ mode: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    >
                      <option value="response">Student response</option>
                      <option value="information">Information block</option>
                    </select>
                  </label>

                  {selectedConfig.mode === 'information' ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Information content</p>
                      <RichTextSurface
                        value={selectedConfig.contentHtml || ''}
                        onChange={(value) => updateSelectedConfig({ contentHtml: value })}
                        placeholder="Add rich text information for students here."
                      />
                    </div>
                  ) : (
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Placeholder text
                    <input
                      value={selectedConfig.placeholder || ''}
                      onChange={(event) => updateSelectedConfig({ placeholder: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    />
                  </label>
                  )}
                </div>
              )}

              {selectedBlock.type === 'url' && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    URL
                    <input
                      value={selectedConfig.url || ''}
                      onChange={(event) => updateSelectedConfig({ url: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    />
                  </label>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Button text
                    <input
                      value={selectedConfig.buttonText || ''}
                      onChange={(event) => updateSelectedConfig({ buttonText: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    />
                  </label>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Audience
                    <select
                      value={selectedConfig.audience || 'student'}
                      onChange={(event) => updateSelectedConfig({ audience: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    >
                      <option value="student">Student-facing</option>
                      <option value="staff">Staff-facing</option>
                    </select>
                  </label>
                </div>
              )}

              {selectedBlock.type === 'randomizer' ? (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Generator prompt
                    <input
                      value={selectedConfig.prompt || ''}
                      onChange={(event) => updateSelectedConfig({ prompt: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedConfig.shuffle !== false)}
                      onChange={(event) => updateSelectedConfig({ shuffle: event.target.checked })}
                    />
                    Shuffle list before generating
                  </label>

                  <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedConfig.requireFirstGeneration)}
                      onChange={(event) => updateSelectedConfig({ requireFirstGeneration: event.target.checked })}
                    />
                    Require the user to take the first generation
                  </label>

                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Display style
                    <select
                      value={selectedConfig.displayStyle || 'word-flicker'}
                      onChange={(event) => updateSelectedConfig({ displayStyle: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm normal-case"
                    >
                      <option value="word-flicker">Animated word flicker</option>
                      <option value="wheel">Wheel</option>
                      <option value="card-shuffle">Card shuffle</option>
                    </select>
                  </label>

                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Animation time (ms)
                    <input
                      type="number"
                      min={300}
                      step={100}
                      value={Number(selectedConfig.animationDurationMs ?? 1800)}
                      onChange={(event) => updateSelectedConfig({ animationDurationMs: Math.max(300, Number(event.target.value) || 1800) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"
                    />
                  </label>

                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Generator values</p>
                    {(randomizerItems || ['Item 1', 'Item 2', 'Item 3']).map((item: string, index: number) => (
                      <div key={`${selectedBlock.id}-generator-${index}`} className="flex items-center gap-2">
                        <input
                          value={item}
                          onChange={(event) => {
                            const next = [...randomizerItems]
                            next[index] = event.target.value
                            updateSelectedConfig({ items: next })
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => updateSelectedConfig({ items: randomizerItems.filter((_, itemIndex) => itemIndex !== index) })}
                          className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => updateSelectedConfig({ items: [...randomizerItems, `Item ${randomizerItems.length + 1}`] })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Add value
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {(selectedBlock.type === 'multipleChoice' || selectedBlock.type === 'singleSelect' || selectedBlock.type === 'verdict' || selectedBlock.type === 'checklist' || selectedBlock.type === 'ranking' || selectedBlock.type === 'quiz' || selectedBlock.type === 'trueFalse' || selectedBlock.type === 'matching' || selectedBlock.type === 'confidence') && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">{selectedBlock.type === 'ranking' ? 'Ranking options' : selectedBlock.type === 'trueFalse' ? 'True/false choices' : selectedBlock.type === 'matching' ? 'Matching choices' : selectedBlock.type === 'quiz' ? 'Quiz options' : 'Options'}</p>
                      {(selectedBlock.type === 'trueFalse'
                        ? ['True', 'False'].map((label, index) => ({ id: `option-${index + 1}`, label }))
                        : selectedBlock.type === 'matching'
                          ? getLabeledConfigItems(selectedConfig.options || ['Option 1', 'Option 2'], 'option')
                          : selectedBlock.type === 'ranking' ? rankingOptions : optionList).map((option, index: number) => (
                        <div key={`${selectedBlock.id}-${option.id}`} className="flex items-center gap-2">
                          <input
                            value={option.label}
                            onChange={(event) => {
                              const current = selectedBlock.type === 'ranking' ? rankingOptions : optionList
                              const next = [...current]
                              next[index] = { ...option, label: event.target.value }
                              updateSelectedConfig({ options: next })
                            }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const current = selectedBlock.type === 'ranking' ? rankingOptions : optionList
                              if (selectedBlock.type === 'trueFalse' || current.length <= 1) return
                              const next = current.filter((_, optionIndex) => optionIndex !== index)
                              updateSelectedConfig({ options: next })
                            }}
                            disabled={selectedBlock.type === 'trueFalse' || (selectedBlock.type === 'ranking' ? rankingOptions : optionList).length <= 1}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const current = selectedBlock.type === 'ranking' ? rankingOptions : optionList
                          updateSelectedConfig({ options: [...current, { id: `option-${Date.now()}`, label: `Option ${current.length + 1}` }] })
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        Add option
                      </button>
                    </div>
                  )}

                  {selectedBlock.type === 'categorize' && (
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Items, one per line<textarea value={getLabeledConfigItems(selectedConfig.items, 'item').map((item) => item.label).join('\n')} onChange={(event) => {
                        const current = getLabeledConfigItems(selectedConfig.items, 'item')
                        updateSelectedConfig({ items: event.target.value.split('\n').filter(Boolean).map((label, index) => ({ id: current[index]?.id || `item-${Date.now()}-${index}`, label })) })
                      }} className="mt-1 min-h-32 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Categories, one per line<textarea value={(selectedConfig.categories || []).join('\n')} onChange={(event) => updateSelectedConfig({ categories: event.target.value.split('\n').filter(Boolean) })} className="mt-1 min-h-32 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                    </div>
                  )}

                  {selectedBlock.type === 'wordCloud' && (
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Maximum entries<input type="number" min={1} max={10} value={Number(selectedConfig.maxEntries || 3)} onChange={(event) => updateSelectedConfig({ maxEntries: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Placeholder<input value={selectedConfig.placeholder || ''} onChange={(event) => updateSelectedConfig({ placeholder: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                    </div>
                  )}

                  {selectedBlock.type === 'numeric' && (
                    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Correct answer<input type="number" value={selectedConfig.correctAnswer ?? ''} onChange={(event) => updateSelectedConfig({ correctAnswer: event.target.value === '' ? undefined : Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Tolerance<input type="number" min={0} step="any" value={Number(selectedConfig.tolerance || 0)} onChange={(event) => updateSelectedConfig({ tolerance: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Unit<input value={selectedConfig.unit || ''} onChange={(event) => updateSelectedConfig({ unit: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Points<input type="number" min={0} value={Number(selectedConfig.points ?? 1)} onChange={(event) => updateSelectedConfig({ points: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 sm:col-span-2"><input type="checkbox" checked={selectedConfig.showFeedback !== false} onChange={(event) => updateSelectedConfig({ showFeedback: event.target.checked })} />Show feedback</label>
                    </div>
                  )}

                  {(selectedBlock.type === 'multipleChoice' || selectedBlock.type === 'quiz' || selectedBlock.type === 'shortAnswer' || selectedBlock.type === 'trueFalse' || selectedBlock.type === 'matching' || selectedBlock.type === 'fillBlank') && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Question text
                        <input value={selectedConfig.question || ''} onChange={(event) => updateSelectedConfig({ question: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      {selectedBlock.type === 'multipleChoice' || selectedBlock.type === 'quiz' ? (
                        <>
                          <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                            <input type="checkbox" checked={Boolean(selectedConfig.multipleAnswers)} onChange={(event) => updateSelectedConfig({ multipleAnswers: event.target.checked })} />
                            Allow multiple answers
                          </label>
                          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                            Correct answer
                            {selectedConfig.multipleAnswers ? (
                              <select multiple value={Array.isArray(selectedConfig.correctAnswer) ? selectedConfig.correctAnswer : (selectedConfig.correctAnswer ? [selectedConfig.correctAnswer] : [])} onChange={(event) => updateSelectedConfig({ correctAnswer: Array.from(event.target.selectedOptions, (option) => option.value) })} className="mt-1 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case">
                                {optionList.map((option) => (
                                  <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                              </select>
                            ) : (
                              <select value={selectedConfig.correctAnswer || ''} onChange={(event) => updateSelectedConfig({ correctAnswer: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case">
                                <option value="">Select an answer</option>
                                {optionList.map((option) => (
                                  <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                              </select>
                            )}
                          </label>
                        </>
                      ) : selectedBlock.type === 'trueFalse' ? (
                        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Correct answer
                          <select value={String(selectedConfig.correctAnswer ?? 'true')} onChange={(event) => updateSelectedConfig({ correctAnswer: event.target.value === 'true' })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case">
                            <option value="true">True</option>
                            <option value="false">False</option>
                          </select>
                        </label>
                      ) : selectedBlock.type === 'matching' ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pairs</p>
                          {(selectedConfig.pairs || []).map((pair: any, index: number) => (
                            <div key={`${selectedBlock.id}-pair-${index}`} className="grid grid-cols-2 gap-2">
                              <input value={pair.prompt || ''} onChange={(event) => {
                                const nextPairs = [...(selectedConfig.pairs || [])]
                                nextPairs[index] = { ...nextPairs[index], prompt: event.target.value }
                                updateSelectedConfig({ pairs: nextPairs })
                              }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Prompt" />
                              <div className="flex gap-2">
                                <input value={pair.answer || ''} onChange={(event) => {
                                  const nextPairs = [...(selectedConfig.pairs || [])]
                                  nextPairs[index] = { ...nextPairs[index], answer: event.target.value }
                                  updateSelectedConfig({ pairs: nextPairs })
                                }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Match" />
                                <button type="button" disabled={(selectedConfig.pairs || []).length <= 1} onClick={() => {
                                  if ((selectedConfig.pairs || []).length <= 1) return
                                  updateSelectedConfig({ pairs: (selectedConfig.pairs || []).filter((_: any, itemIndex: number) => itemIndex !== index) })
                                }} className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700">Remove</button>
                              </div>
                            </div>
                          ))}
                          <button type="button" onClick={() => updateSelectedConfig(addMatchingPairConfig(selectedConfig))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700">Add pair</button>
                        </div>
                      ) : (
                        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Correct answer
                          <input value={selectedConfig.correctAnswer || ''} onChange={(event) => updateSelectedConfig(selectedBlock.type === 'fillBlank' ? getFillBlankCorrectAnswerPatch(event.target.value) : { correctAnswer: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                        </label>
                      )}
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Explanation
                        <textarea value={selectedConfig.explanation || ''} onChange={(event) => updateSelectedConfig({ explanation: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Points
                          <input type="number" min={0} value={Number(selectedConfig.points ?? 1)} onChange={(event) => updateSelectedConfig({ points: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="flex items-center gap-2 pt-6 text-xs font-medium uppercase tracking-wide text-slate-500">
                          <input type="checkbox" checked={Boolean(selectedConfig.showFeedback ?? true)} onChange={(event) => updateSelectedConfig({ showFeedback: event.target.checked })} />
                          Show feedback
                        </label>
                      </div>
                    </div>
                  )}

                  {selectedBlock.type === 'continuum' && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Continuum</p>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Left label<input value={selectedConfig.leftLabel || ''} onChange={(event) => updateSelectedConfig({ leftLabel: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Right label<input value={selectedConfig.rightLabel || ''} onChange={(event) => updateSelectedConfig({ rightLabel: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                      </div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Instructions<textarea value={selectedConfig.instructions || ''} onChange={(event) => updateSelectedConfig({ instructions: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Initial marker position<input type="number" min={0} max={100} value={Number(selectedConfig.defaultValue ?? 50)} onChange={(event) => updateSelectedConfig({ defaultValue: Math.max(0, Math.min(100, Number(event.target.value))) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /><span className="mt-1 block normal-case font-normal">This position does not count as an answer until the learner interacts.</span></label>
                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><input type="checkbox" checked={Boolean(selectedConfig.rationaleRequired)} onChange={(event) => updateSelectedConfig({ rationaleRequired: event.target.checked })} />Require rationale</label>
                    </div>
                  )}

                  {selectedBlock.type === 'decisionMatrix' && (
                    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div><p className="text-sm font-semibold text-slate-800">Options</p>{decisionOptions.map((option, index) => <div key={option.id} className="mt-2 flex gap-1"><input value={option.label} onChange={(event) => { const next = [...decisionOptions]; next[index] = { ...option, label: event.target.value }; updateSelectedConfig({ options: next }) }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={index === 0} onClick={() => { const next = [...decisionOptions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; updateSelectedConfig({ options: next }) }} className="rounded border px-2 text-xs disabled:opacity-30">↑</button><button type="button" disabled={index === decisionOptions.length - 1} onClick={() => { const next = [...decisionOptions]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; updateSelectedConfig({ options: next }) }} className="rounded border px-2 text-xs disabled:opacity-30">↓</button><button type="button" onClick={() => updateSelectedConfig({ options: decisionOptions.filter((item) => item.id !== option.id) })} className="rounded border border-red-200 px-2 text-xs text-red-700">Remove</button></div>)}<button type="button" onClick={() => updateSelectedConfig({ options: [...decisionOptions, { id: `option-${Date.now()}`, label: `Option ${decisionOptions.length + 1}` }] })} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium">Add option</button></div>
                      <div><p className="text-sm font-semibold text-slate-800">Criteria</p>{decisionCriteria.map((criterion, index) => <div key={criterion.id} className="mt-2 flex gap-1"><input value={criterion.label} onChange={(event) => { const next = [...decisionCriteria]; next[index] = { ...criterion, label: event.target.value }; updateSelectedConfig({ criteria: next }) }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={index === 0} onClick={() => { const next = [...decisionCriteria]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; updateSelectedConfig({ criteria: next }) }} className="rounded border px-2 text-xs disabled:opacity-30">↑</button><button type="button" disabled={index === decisionCriteria.length - 1} onClick={() => { const next = [...decisionCriteria]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; updateSelectedConfig({ criteria: next }) }} className="rounded border px-2 text-xs disabled:opacity-30">↓</button><button type="button" onClick={() => updateSelectedConfig({ criteria: decisionCriteria.filter((item) => item.id !== criterion.id) })} className="rounded border border-red-200 px-2 text-xs text-red-700">Remove</button></div>)}<button type="button" onClick={() => updateSelectedConfig({ criteria: [...decisionCriteria, { id: `criterion-${Date.now()}`, label: `Criterion ${decisionCriteria.length + 1}` }] })} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium">Add criterion</button></div>
                      <div className="grid grid-cols-2 gap-2"><label className="text-xs font-medium uppercase tracking-wide text-slate-500">Minimum<input type="number" value={Number(selectedConfig.min ?? 1)} onChange={(event) => updateSelectedConfig({ min: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label><label className="text-xs font-medium uppercase tracking-wide text-slate-500">Maximum<input type="number" value={Number(selectedConfig.max ?? 5)} onChange={(event) => updateSelectedConfig({ max: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label></div>
                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><input type="checkbox" checked={Boolean(selectedConfig.showTotals)} onChange={(event) => updateSelectedConfig({ showTotals: event.target.checked })} />Show totals and averages</label>
                    </div>
                  )}

                  {selectedBlock.type === 'board' && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Start from a preset<select defaultValue="" onChange={(event) => { const preset = event.target.value as Parameters<typeof getBoardPresetColumns>[0]; if (!preset) return; const isBlank = boardColumns.map((column) => column.label).join('|') === 'Column 1|Column 2|Column 3'; if (!isBlank && !window.confirm('Replace the current board columns with this preset?')) { event.target.value = ''; return } updateSelectedConfig({ columns: getBoardPresetColumns(preset) }); event.target.value = '' }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case"><option value="">Choose preset…</option><option value="blank">Blank board</option><option value="pmi">PMI</option><option value="kwl">KWL</option><option value="start-stop-continue">Start / Stop / Continue</option><option value="pros-cons">Pros / Cons</option><option value="rose-bud-thorn">Rose / Bud / Thorn</option><option value="what-so-what-now-what">What? / So What? / Now What?</option></select></label>
                      <div><p className="text-sm font-semibold text-slate-800">Columns</p>{boardColumns.map((column, index) => <div key={column.id} className="mt-2 rounded-lg border border-slate-200 bg-white p-2"><div className="flex gap-1"><input value={column.label} onChange={(event) => { const next = [...boardColumns]; next[index] = { ...column, label: event.target.value }; updateSelectedConfig({ columns: next }) }} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={index === 0} onClick={() => { const next = [...boardColumns]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; updateSelectedConfig({ columns: next }) }} className="rounded border px-2 text-xs disabled:opacity-30">↑</button><button type="button" disabled={index === boardColumns.length - 1} onClick={() => { const next = [...boardColumns]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; updateSelectedConfig({ columns: next }) }} className="rounded border px-2 text-xs disabled:opacity-30">↓</button><button type="button" disabled={boardColumns.length <= 1} onClick={() => { if (boardColumns.length <= 1) return; updateSelectedConfig({ columns: boardColumns.filter((item) => item.id !== column.id) }) }} className="rounded border border-red-200 px-2 text-xs text-red-700 disabled:opacity-40">Remove</button></div><input value={column.description || ''} onChange={(event) => { const next = [...boardColumns]; next[index] = { ...column, description: event.target.value }; updateSelectedConfig({ columns: next }) }} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" placeholder="Optional column description" /></div>)}<button type="button" disabled={boardColumns.length >= 6} onClick={() => updateSelectedConfig({ columns: [...boardColumns, { id: `board-column-${Date.now()}`, label: `Column ${boardColumns.length + 1}` }] })} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium disabled:opacity-40">Add column</button></div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Entry placeholder<input value={selectedConfig.placeholder || ''} onChange={(event) => updateSelectedConfig({ placeholder: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>
                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><input type="checkbox" checked={selectedConfig.allowMultipleEntries !== false} onChange={(event) => updateSelectedConfig({ allowMultipleEntries: event.target.checked })} />Allow multiple entries</label>
                      {selectedConfig.allowMultipleEntries !== false && <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Maximum per column (0 = unlimited)<input type="number" min={0} value={Number(selectedConfig.maxEntriesPerColumn || 0)} onChange={(event) => updateSelectedConfig({ maxEntriesPerColumn: Math.max(0, Number(event.target.value)) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" /></label>}
                    </div>
                  )}

                  {selectedBlock.type === 'matrix' && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Matrix rows</p>
                      {matrixRows.map((row, index) => (
                        <div key={row.id} className="flex items-center gap-2">
                          <input
                            value={row.label}
                            onChange={(event) => {
                              const next = [...matrixRows]
                              next[index] = { ...row, label: event.target.value }
                              updateSelectedConfig({ rows: next })
                            }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = matrixRows.filter((_, rowIndex) => rowIndex !== index)
                              updateSelectedConfig({ rows: next })
                            }}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateSelectedConfig({ rows: [...matrixRows, { id: `row-${Date.now()}`, label: `Criteria ${matrixRows.length + 1}` }] })}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        Add row
                      </button>
                      <div className="grid grid-cols-3 gap-2 pt-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Min
                          <input type="number" value={Number(selectedConfig.min ?? 1)} onChange={(event) => updateSelectedConfig({ min: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Max
                          <input type="number" value={Number(selectedConfig.max ?? 5)} onChange={(event) => updateSelectedConfig({ max: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Default
                          <input type="number" value={Number(selectedConfig.defaultValue ?? 3)} onChange={(event) => updateSelectedConfig({ defaultValue: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                      </div>
                    </div>
                  )}

                  {(selectedBlock.type === 'imagePrompt' || selectedBlock.type === 'hotspot') && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Image URL
                        <input value={selectedConfig.imageUrl || ''} onChange={(event) => updateSelectedConfig({ imageUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Alt text
                        <input value={selectedConfig.altText || ''} onChange={(event) => updateSelectedConfig({ altText: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      {selectedBlock.type === 'imagePrompt' && <>
                        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Placeholder
                          <input value={selectedConfig.placeholder || ''} onChange={(event) => updateSelectedConfig({ placeholder: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                        </label>
                        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Image fit
                          <select value={selectedConfig.imageFit || 'contain'} onChange={(event) => updateSelectedConfig({ imageFit: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case">
                            <option value="contain">Fit whole image</option>
                            <option value="cover">Fill area / crop</option>
                          </select>
                        </label>
                        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Display size
                          <select value={selectedConfig.imageSize || 'large'} onChange={(event) => updateSelectedConfig({ imageSize: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case">
                            <option value="small">Small</option>
                            <option value="medium">Medium</option>
                            <option value="large">Large</option>
                            <option value="full">Full width</option>
                          </select>
                        </label>
                      </>}
                      {selectedBlock.type === 'hotspot' && <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><input type="checkbox" checked={Boolean(selectedConfig.allowMultiple)} onChange={(event) => updateSelectedConfig({ allowMultiple: event.target.checked })} />Allow multiple hotspots</label>}
                    </div>
                  )}

                  {(selectedBlock.type === 'video' || selectedBlock.type === 'youtube') && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Video URL
                        <input value={selectedConfig.videoUrl || ''} onChange={(event) => updateSelectedConfig({ videoUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Alt text
                        <input value={selectedConfig.altText || ''} onChange={(event) => updateSelectedConfig({ altText: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Prompt text
                        <input value={selectedConfig.placeholder || ''} onChange={(event) => updateSelectedConfig({ placeholder: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                    </div>
                  )}

                  {selectedBlock.type === 'section' && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Section title
                        <input value={selectedBlock.title || selectedConfig.title || ''} onChange={(event) => updateSelectedBlock({ title: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                    </div>
                  )}

                  {selectedBlock.type === 'radar' && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Radar dimensions</p>
                      {radarDimensions.map((dimension, index) => (
                        <div key={dimension.id} className="flex items-center gap-2">
                          <input
                            value={dimension.label}
                            onChange={(event) => {
                              const next = [...radarDimensions]
                              next[index] = { ...next[index], label: event.target.value }
                              updateSelectedConfig({ dimensions: next })
                            }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (radarDimensions.length <= 3) return
                              const next = radarDimensions.filter((_, dimensionIndex) => dimensionIndex !== index)
                              updateSelectedConfig({ dimensions: next })
                            }}
                            disabled={radarDimensions.length <= 3}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateSelectedConfig({
                          dimensions: [
                            ...radarDimensions,
                            { id: `radar-dimension-${Date.now()}`, label: `Dimension ${radarDimensions.length + 1}` },
                          ],
                        })}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        Add dimension
                      </button>
                    </div>
                  )}

                  {selectedBlock.type === 'quadrant' && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Quadrant labels</p>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Left axis label
                        <input value={selectedConfig.xLeft || ''} onChange={(event) => updateSelectedConfig({ xLeft: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Right axis label
                        <input value={selectedConfig.xRight || ''} onChange={(event) => updateSelectedConfig({ xRight: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Bottom axis label
                        <input value={selectedConfig.yBottom || ''} onChange={(event) => updateSelectedConfig({ yBottom: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Top axis label
                        <input value={selectedConfig.yTop || ''} onChange={(event) => updateSelectedConfig({ yTop: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Instructions
                        <textarea value={selectedConfig.instructions || ''} onChange={(event) => updateSelectedConfig({ instructions: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                    </div>
                  )}

                  {selectedBlock.type === 'swot' && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">SWOT categories</p>
                      {swotCategories.map((category, index) => (
                        <div key={category.id} className="flex items-center gap-2">
                          <input
                            value={category.label}
                            onChange={(event) => {
                              const next = [...swotCategories]
                              next[index] = { ...next[index], label: event.target.value }
                              updateSelectedConfig({ categories: next })
                            }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (swotCategories.length <= 1) return
                              const next = swotCategories.filter((_, categoryIndex) => categoryIndex !== index)
                              updateSelectedConfig({ categories: next })
                            }}
                            disabled={swotCategories.length <= 1}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateSelectedConfig({
                          categories: [
                            ...swotCategories,
                            { id: `swot-category-${Date.now()}`, label: `Category ${swotCategories.length + 1}` },
                          ],
                        })}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        Add category
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button type="button" onClick={duplicateSelectedBlock} className="h-9 w-full whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400">Duplicate</button>
                    <button onClick={deleteSelectedBlock} className="h-9 w-full whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:border-red-300">Delete</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

export default App
