import { HashRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExtension from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { Wheel as CanvasWheel } from 'spin-wheel'
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  ExternalLink,
  FileUp,
  FileText,
  GraduationCap,
  Home,
  Plus,
  Play,
  Trash2,
  Upload,
  User,
  Wrench,
} from 'lucide-react'
import type { GroupedResponseSet, WorksheetBlock, WorksheetDefinition, WorksheetPage, WorksheetResponse, WorksheetSynthesisSettings } from './lib/types'
import {
  aggregateQuadrantMean,
  aggregateRadarValues,
  getResponseLabel,
  groupResponsesByKey,
  mapCanvasPointToQuadrant,
} from './lib/aggregation'
import { exportResponseJson, getDefaultResponseId, loadSession, saveSession } from './lib/storage'

const BASE_RESPONSE_KEY = 'worksheet-session-id'
const ACTIVE_DEFINITION_KEY = 'worksheet-active-definition'
const WHEEL_SEGMENT_COLORS = ['#0ea5e9', '#ec4899', '#8b5cf6', '#f59e0b', '#ef4444', '#d946ef', '#22c55e', '#facc15']
const NON_RESPONSE_BLOCK_TYPES = new Set(['content', 'section', 'url'])
const TEXT_RESPONSE_BLOCK_TYPES = new Set(['shortText', 'longText', 'richText'])
const RESPONSE_SUMMARY_BLOCK_TYPES = new Set(['shortText', 'longText', 'richText', 'singleSelect', 'randomizer', 'multipleChoice', 'trueFalse', 'shortAnswer', 'checklist', 'ranking', 'verdict', 'rating'])

function getBlockDisplayLabel(block: WorksheetBlock) {
  return block.label || block.title || block.id
}

function isResponseProducingBlock(block: WorksheetBlock) {
  if (NON_RESPONSE_BLOCK_TYPES.has(block.type)) return false
  if (block.type === 'richText' && block.config?.mode === 'information') return false
  return true
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
    exports: {
      json: true,
      pdf: true,
    },
  },
  pages: [],
}

type WorksheetBuilderSetter = (value: WorksheetDefinition | ((previous: WorksheetDefinition) => WorksheetDefinition)) => void

function isWorksheetDefinition(value: unknown): value is WorksheetDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorksheetDefinition>
  return typeof candidate.id === 'string'
    && typeof candidate.version === 'number'
    && typeof candidate.title === 'string'
    && Array.isArray(candidate.pages)
}

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

export function getQuizSummary(definition: WorksheetDefinition, responses: Record<string, any>) {
  const quizTypes = new Set(['quiz', 'multipleChoice', 'trueFalse', 'shortAnswer', 'matching', 'fillBlank'])

  const items = definition.pages.flatMap((page) => page.blocks)
    .filter((block) => quizTypes.has(block.type))
    .map((block) => {
      const answer = responses[block.id]
      const points = Number(block.config?.points ?? 1)
      const type = block.type
      let isCorrect = false

      if (type === 'trueFalse') {
        isCorrect = answer !== undefined && String(answer) === String(block.config?.correctAnswer)
      } else if (type === 'shortAnswer') {
        const expected = typeof block.config?.correctAnswer === 'string' ? block.config.correctAnswer.trim().toLowerCase() : ''
        const actual = typeof answer === 'string' ? answer.trim().toLowerCase() : ''
        isCorrect = actual !== '' && actual === expected
      } else if (type === 'matching') {
        const pairs = Array.isArray(block.config?.pairs) ? block.config.pairs : []
        const selections = answer && typeof answer === 'object' ? answer : {}
        isCorrect = pairs.length > 0 && pairs.every((pair: any) => {
          const selected = selections[pair.id] ?? selections[pair.prompt]
          return String(selected ?? '').trim().toLowerCase() === String(pair.answer ?? '').trim().toLowerCase()
        })
      } else if (type === 'fillBlank') {
        const acceptedAnswers = Array.isArray(block.config?.answers)
          ? block.config.answers
          : [block.config?.correctAnswer ?? block.config?.answer].filter((value) => typeof value === 'string' && value.trim())
        const actual = typeof answer === 'string' ? answer.trim().toLowerCase() : ''
        isCorrect = actual !== '' && acceptedAnswers.some((option: string) => String(option).trim().toLowerCase() === actual)
      } else {
        const expected = block.config?.correctAnswer
        const selected = Array.isArray(answer) ? answer : [answer].filter((value) => value !== undefined)
        if (block.config?.multipleAnswers) {
          const normalizedExpected = Array.isArray(expected) ? expected : [expected].filter((value) => value !== undefined)
          isCorrect = JSON.stringify([...selected].sort()) === JSON.stringify([...normalizedExpected].sort())
        } else {
          isCorrect = answer !== undefined && answer === expected
        }
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

  return {
    totalQuestions: items.length,
    totalScore,
    totalMax,
    percent: totalMax === 0 ? 0 : (totalScore / totalMax) * 100,
    items,
  }
}

function App() {
  const [activeDefinition, setActiveDefinition] = useState<WorksheetDefinition>(() => {
    const raw = localStorage.getItem(ACTIVE_DEFINITION_KEY)
    if (!raw) return EMPTY_WORKSHEET_DEFINITION

    try {
      const parsed = JSON.parse(raw) as unknown
      return isWorksheetDefinition(parsed) ? parsed : EMPTY_WORKSHEET_DEFINITION
    } catch {
      return EMPTY_WORKSHEET_DEFINITION
    }
  })
  const [definitionStatus, setDefinitionStatus] = useState('Import a worksheet JSON to replace the current active definition.')

  useEffect(() => {
    localStorage.setItem(ACTIVE_DEFINITION_KEY, JSON.stringify(activeDefinition))
  }, [activeDefinition])

  const importWorksheetDefinition = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (!isWorksheetDefinition(parsed)) {
        setDefinitionStatus('Import failed: file is not a valid worksheet definition.')
        return
      }
      setActiveDefinition(parsed)
      setDefinitionStatus(`Loaded ${parsed.title} (${parsed.id} v${parsed.version}) from ${file.name}.`)
    } catch {
      setDefinitionStatus('Import failed: malformed JSON file.')
    } finally {
      event.target.value = ''
    }
  }

  const importAndOpenWorksheet = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (!isWorksheetDefinition(parsed)) {
        setDefinitionStatus('Import failed: file is not a valid worksheet definition.')
        return
      }
      setActiveDefinition(parsed)
      setDefinitionStatus(`Loaded ${parsed.title} (${parsed.id} v${parsed.version}) from ${file.name}.`)
      window.location.hash = '#/worksheet'
    } catch {
      setDefinitionStatus('Import failed: malformed JSON file.')
    } finally {
      event.target.value = ''
    }
  }

  const clearWorksheetDefinition = () => {
    setActiveDefinition(EMPTY_WORKSHEET_DEFINITION)
    setDefinitionStatus('Cleared active worksheet. Load a worksheet JSON to continue.')
  }

  return (
    <HashRouter>
      <div className="min-h-screen bg-slate-100 text-slate-900">
        <GlobalBreadcrumb />
        <Routes>
          <Route
            path="/"
            element={(
              <HomeScreen
                definition={activeDefinition}
                definitionStatus={definitionStatus}
                importAndOpenWorksheet={importAndOpenWorksheet}
                clearWorksheetDefinition={clearWorksheetDefinition}
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
          <Route
            path="/builder"
            element={(
              <BuilderPage
                definition={activeDefinition}
                setDefinition={setActiveDefinition}
                importWorksheetDefinition={importWorksheetDefinition}
              />
            )}
          />
          <Route path="/preview" element={<WorksheetPlayer definition={activeDefinition} previewMode />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

function GlobalBreadcrumb() {
  const location = useLocation()

  const routeLabel =
    location.pathname === '/builder'
      ? 'Worksheet builder'
      : location.pathname === '/system-guide'
        ? 'System guide'
        : location.pathname === '/synthesis' || location.pathname === '/synthesis/ai-tool-lab'
          ? 'Student synthesis'
          : location.pathname === '/report' || location.pathname === '/report/ai-tool-lab'
            ? 'Teacher report'
            : location.pathname === '/worksheet' || location.pathname === '/worksheet/ai-tool-lab'
              ? 'Worksheet player'
              : location.pathname === '/preview'
                ? 'Worksheet preview'
                : 'Start'

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm text-slate-600">
        <Link to="/" className="inline-flex items-center gap-1.5 font-medium text-slate-800 hover:text-blue-700">
          <Home className="h-4 w-4" />
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <span>{routeLabel}</span>
      </div>
    </div>
  )
}

function HomeScreen({
  definition,
  definitionStatus,
  importAndOpenWorksheet,
  clearWorksheetDefinition,
}: {
  definition: WorksheetDefinition
  definitionStatus: string
  importAndOpenWorksheet: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  clearWorksheetDefinition: () => void
}) {
  const hasLoadedWorksheet = definition.pages.length > 0

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-8 px-6 py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Interactive worksheet platform</p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Central Worksheet Hub</h1>
        <p className="mt-4 max-w-2xl text-slate-600">
          Use the student and teacher entry points below to quickly get to the right tools.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Active worksheet</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{definition.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{definition.id} · version {definition.version} · {definition.pages.length} pages</p>
          <p className="mt-2 text-sm text-slate-600">{definitionStatus}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={clearWorksheetDefinition} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400">
              <Trash2 className="h-4 w-4" />
              Clear active worksheet
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">
              <User className="h-4 w-4" />
              Student
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">Complete worksheet</h3>
            <p className="mt-1 text-sm text-slate-600">Open the active worksheet and submit your response.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {hasLoadedWorksheet ? (
                <Link to="/worksheet" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-500">
                  <Play className="h-4 w-4" />
                  Continue worksheet
                </Link>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-500">
                  <Upload className="h-4 w-4" />
                  Load worksheet
                  <input type="file" accept="application/json" className="hidden" onChange={importAndOpenWorksheet} />
                </label>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">
              <GraduationCap className="h-4 w-4" />
              Teacher
            </p>
            <h3 className="mt-1 text-lg font-bold text-slate-900">Create and analyze</h3>
            <p className="mt-1 text-sm text-slate-600">Build worksheets and combine class response files into one synthesis report.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/builder" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400">
                <Wrench className="h-4 w-4" />
                Worksheet builder
              </Link>
              <Link to="/synthesis" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400">
                <BarChart3 className="h-4 w-4" />
                Student synthesis
              </Link>
              <Link to="/report" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400">
                <FileText className="h-4 w-4" />
                Teacher report
              </Link>
            </div>
          </section>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Reference</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link to="/system-guide" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400">
              <FileText className="h-4 w-4" />
              Open system guide
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
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
    { type: 'matrix', summary: 'Rate multiple rows against a shared numeric rubric.' },
    { type: 'imagePrompt', summary: 'Display an image and capture a written response beneath it.' },
    { type: 'video', summary: 'Direct media URL rendered with a native video player.' },
    { type: 'youtube', summary: 'YouTube embed derived from a share or watch URL.' },
    { type: 'section', summary: 'Divider or heading to visually group worksheet content.' },
    { type: 'rating', summary: 'Slider-based numeric scale with min, max, and step values.' },
    { type: 'radar', summary: 'Multi-dimension chart for scoring and comparison.' },
    { type: 'quadrant', summary: 'Two-axis placement activity for value/risk or similar dimensions.' },
    { type: 'swot', summary: 'Board for strengths, weaknesses, opportunities, and threats.' },
    { type: 'verdict', summary: 'Single pick among recommendation or decision choices.' },
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
        'Multi-file response import and aggregated synthesis',
        'Configurable synthesis grouping and response labels',
        'Shared filtering across student synthesis and teacher report',
        'Teacher reporting with radar, quadrant, and SWOT analysis',
        'Student-facing summaries and recommendations',
        'Optional page timers and progress tracking',
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
            config: 'optional object',
          },
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
        quiz: ['multipleChoice', 'trueFalse', 'shortAnswer', 'matching', 'fillBlank'],
        choiceAndSelection: ['singleSelect', 'randomizer', 'checklist', 'ranking', 'verdict'],
        analysisAndAssessment: ['rating', 'matrix', 'radar', 'quadrant', 'swot'],
        mediaAndEvidence: ['imagePrompt', 'video', 'youtube', 'url'],
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
        imagePrompt: {
          purpose: 'Display an image prompt with optional response placeholder.',
          fields: ['label', 'description'],
          config: {
            imageUrl: 'string',
            altText: 'string',
            placeholder: 'string',
          },
          responseShape: 'string',
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
      chartTypes: ['radar', 'quadrant', 'summary badges', 'verdict distribution', 'matrix averages'],
      sharedFilters: ['grouping key', 'response label', 'verdict', 'free-text search'],
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
    <main className="mx-auto max-w-6xl px-6 py-10">
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
            <li>• Builds interactive worksheets from structured JSON.</li>
            <li>• Supports sequential or free navigation through pages.</li>
            <li>• Captures student responses and persists autosave sessions.</li>
            <li>• Exports worksheet definitions and response JSON.</li>
            <li>• Generates synthesis views for class aggregation with configurable grouping and response labels.</li>
            <li>• Applies the same group, response label, verdict, and keyword filters in student synthesis and teacher report views.</li>
            <li>• Supports radar, quadrant, SWOT, and media-based prompts.</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">AI authoring guidance</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li>• Keep each page in a clear learning sequence.</li>
            <li>• Use descriptive IDs like block-intro or block-matrix-1.</li>
            <li>• Prefer stable labels and simple option arrays for choice blocks.</li>
            <li>• Put media URLs in config.videoUrl or config.imageUrl.</li>
            <li>• Configure `synthesis.groupByBlockId` and `synthesis.responseLabelBlockId` when you want grouped synthesis output.</li>
            <li>• For synthesis, use radar, quadrant, matrix, SWOT, or verdict blocks where possible.</li>
            <li>• Keep definitions versioned for future schema updates.</li>
          </ul>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Synthesis configuration</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Builder settings</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>• Group responses by: selects the response-producing block used as the synthesis grouping key.</li>
              <li>• Group label: sets the human-readable name used across synthesis and report views.</li>
              <li>• Label individual responses by: chooses the block used to name each submission inside a synthesis group.</li>
              <li>• If a referenced block is deleted, the builder warns first and clears the broken synthesis setting if deletion proceeds.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Import behavior</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>• Multiple responses with the same grouping value stay separate and also generate an aggregate view.</li>
              <li>• Grouping values are normalized by trimming and collapsing whitespace and comparing case-insensitively.</li>
              <li>• Missing grouping values are placed under Unspecified.</li>
              <li>• If no grouping is configured, synthesis falls back to a neutral All responses group.</li>
              <li>• Student synthesis and teacher report share the same filter controls for group, response label, verdict, and keyword search.</li>
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
            <li>• Worksheet: public/worksheets/ai-tool-lab.json</li>
            <li>• Responses: public/sample-responses/tool-comparison/ai-tool-lab-diffit-group-1.json</li>
            <li>• Responses: public/sample-responses/tool-comparison/ai-tool-lab-diffit-group-4.json</li>
            <li>• Responses: public/sample-responses/tool-comparison/ai-tool-lab-notebooklm-group-2.json</li>
            <li>• Responses: public/sample-responses/tool-comparison/ai-tool-lab-notebooklm-group-5.json</li>
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

function WorksheetPlayer({ definition, previewMode = false }: { definition: WorksheetDefinition; previewMode?: boolean }) {
  const navigate = useNavigate()
  const [pageIndex, setPageIndex] = useState(0)
  const [responseId, setResponseId] = useState(() => {
    const saved = localStorage.getItem(`${BASE_RESPONSE_KEY}:${definition.id}:${definition.version}`)
    return saved || getDefaultResponseId()
  })
  const [responses, setResponses] = useState<Record<string, any>>({})
  const [status, setStatus] = useState('In progress')
  const [isSessionHydrated, setIsSessionHydrated] = useState(false)

  useEffect(() => {
    setIsSessionHydrated(false)
    const saved = localStorage.getItem(`${BASE_RESPONSE_KEY}:${definition.id}:${definition.version}`)
    if (saved) {
      setResponseId(saved)
      return
    }
    const next = getDefaultResponseId()
    localStorage.setItem(`${BASE_RESPONSE_KEY}:${definition.id}:${definition.version}`, next)
    setResponseId(next)
  }, [definition.id, definition.version])

  useEffect(() => {
    if (!responseId) return
    localStorage.setItem(`${BASE_RESPONSE_KEY}:${definition.id}:${definition.version}`, responseId)
    const saved = loadSession(definition.id, definition.version, responseId)
    if (saved) {
      setResponses(saved.responses || {})
      setPageIndex(saved.pageIndex || 0)
      setStatus('In progress')
    } else {
      setResponses({})
      setPageIndex(0)
      setStatus('In progress')
    }
    setIsSessionHydrated(true)
  }, [definition.id, definition.version, responseId])

  useEffect(() => {
    if (definition.settings.autosave && responseId && isSessionHydrated) {
      saveSession(
        { responseId, pageIndex, responses, updatedAt: new Date().toISOString() },
        definition.id,
        definition.version,
        responseId,
      )
    }
  }, [definition, isSessionHydrated, pageIndex, responseId, responses])

  const totalPages = definition.pages.length
  const currentPage = definition.pages[pageIndex]
  const visibleBlocks = currentPage?.blocks.filter((block) => previewMode || getBlockAudience(block) === 'student') || []
  const currentTimer = currentPage?.timer ?? null
  const [pageRemainingSeconds, setPageRemainingSeconds] = useState<number | null>(null)
  const quizSummary = useMemo(() => getQuizSummary(definition, responses), [definition, responses])

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
      if (pageIndex < totalPages - 1) {
        setPageIndex((value) => value + 1)
        return
      }
      setStatus('Time expired')
      return
    }

    setStatus('Time expired')
  }, [currentPage?.id, currentTimer, pageIndex, pageRemainingSeconds, totalPages])

  const updateResponse = (blockId: string, value: any) => {
    setResponses((previous) => ({ ...previous, [blockId]: value }))
  }

  const buildDocument = (): WorksheetResponse => ({
    responseSchema: 'interactive-worksheet-response',
    schemaVersion: 1,
    worksheetId: definition.id,
    worksheetVersion: definition.version,
    responseId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    group: String(responses['group-name'] || ''),
    subject: String(responses['tool-name'] || responses['subject-name'] || ''),
    responses,
  })

  const goToPage = (index: number) => {
    if (index < 0 || index > totalPages - 1) return
    setPageIndex(index)
  }

  const handleNext = () => {
    if (pageIndex < totalPages - 1) {
      setPageIndex((value) => value + 1)
      return
    }
    setStatus('Complete')
  }

  const handleBack = () => {
    if (pageIndex > 0) {
      setPageIndex((value) => value - 1)
    }
  }

  const handleStartNew = () => {
    if (!window.confirm('Start a new response? This will clear the current saved version.')) return
    const nextId = getDefaultResponseId()
    setResponseId(nextId)
    setResponses({})
    setPageIndex(0)
    setStatus('New response started')
    localStorage.setItem(`${BASE_RESPONSE_KEY}:${definition.id}:${definition.version}`, nextId)
  }

  const handleExportJson = () => {
    exportResponseJson(buildDocument())
  }

  const handleExportPdf = () => {
    const document = buildDocument()
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    let y = 52
    pdf.setFontSize(21)
    pdf.text(definition.title, 52, y)
    y += 30
    pdf.setFontSize(11)
    pdf.text(`Worksheet: ${definition.id} v${definition.version}`, 52, y)
    y += 18
    pdf.text(`Subject: ${document.subject || 'Not recorded'}`, 52, y)
    y += 18
    pdf.text(`Group: ${document.group || 'Not recorded'}`, 52, y)
    y += 18
    pdf.text(`Generated: ${new Date().toLocaleString()}`, 52, y)
    y += 24

    definition.pages.forEach((page) => {
      if (y > 700) {
        pdf.addPage()
        y = 52
      }
      pdf.setFontSize(14)
      pdf.text(page.title, 52, y)
      y += 18
      pdf.setFontSize(10)
      page.blocks.filter((block) => getBlockAudience(block) === 'student').forEach((block) => {
        const value = document.responses[block.id]
        const text = formatBlockValue(block, value)
        if (!text) return
        const lines = pdf.splitTextToSize(text, 500)
        pdf.text(lines, 52, y)
        y += lines.length * 12
        if (y > 760) {
          pdf.addPage()
          y = 52
        }
      })
      y += 10
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

  if (!currentPage) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12 text-slate-700">
        This worksheet has no pages.
      </main>
    )
  }

  const progress = ((pageIndex + 1) / totalPages) * 100

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{definition.id}</p>
          <h1 className="text-3xl font-bold text-slate-900">{definition.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><ArrowLeft className="h-4 w-4" />Back to start</Link>
          {previewMode && (
            <button type="button" onClick={handleBackToBuilder} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><ArrowLeft className="h-4 w-4" />Back to builder</button>
          )}
          {!previewMode && (
            <>
              <button onClick={handleStartNew} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><Play className="h-4 w-4" />Start New</button>
              <button onClick={handleExportJson} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"><FileUp className="h-4 w-4" />Download JSON</button>
              <button onClick={handleExportPdf} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"><FileText className="h-4 w-4" />Download PDF</button>
            </>
          )}
          {previewMode && <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">Preview mode</span>}
        </div>
      </header>

      {definition.settings.showProgress && (
        <div className="mb-6">
          <div className="mb-2 flex justify-between text-sm text-slate-600">
            <span>Page {pageIndex + 1} of {totalPages}</span>
            <span>{status}</span>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(260px,1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold text-slate-900">{currentPage.title}</h2>
          <div className="space-y-6">
            {visibleBlocks.map((block) => (
              <div key={block.id}>{renderBlock(block, responses, updateResponse)}</div>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4">
            <button onClick={handleBack} disabled={pageIndex === 0} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Back</button>
            <button onClick={handleNext} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              {pageIndex === totalPages - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </section>

        <aside className="space-y-5 rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          {quizSummary.totalQuestions > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">Quiz score</p>
              <p className="mt-2 text-2xl font-bold text-emerald-900">{quizSummary.totalScore}/{quizSummary.totalMax}</p>
              <p className="text-sm text-emerald-700">{quizSummary.percent.toFixed(0)}% correct</p>
            </div>
          )}

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-900">Progress snapshot</h3>
            <ul className="space-y-2 text-sm text-slate-700">
              {definition.pages.map((page, index) => (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => goToPage(index)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 ${index === pageIndex ? 'bg-blue-100 text-blue-900' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {page.title}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs">
                      {index + 1}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  )
}

function RadarBlock({ block, responses, updateResponse }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void }) {
  const dimensions = block.config?.dimensions || []
  const valueMap: Record<string, number> = responses[block.id] || {}
  const radius = 100
  const center = 150
  const scores = dimensions.map((dimension: any) => {
    const index = dimensions.indexOf(dimension)
    const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
    const label = typeof dimension === 'string' ? dimension : dimension.label
    const value = Number(valueMap[label] ?? 5)
    const distance = (value / 10) * radius
    return `${center + Math.cos(angle) * distance},${center + Math.sin(angle) * distance}`
  })

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-900">{block.label}</h3>
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

        {dimensions.map((dimension: any, index: number) => {
          const label = typeof dimension === 'string' ? dimension : dimension.label
          const key = typeof dimension === 'string' ? `${label}-${index}` : dimension.id
          const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
          const x = center + Math.cos(angle) * 120
          const y = center + Math.sin(angle) * 120
          return (
            <g key={key}>
              <line x1={center} y1={center} x2={x} y2={y} stroke="#cbd5e1" strokeWidth="1" />
              <text x={center + Math.cos(angle) * 138} y={center + Math.sin(angle) * 138} textAnchor="middle" fontSize="9" fill="#334155">{label}</text>
            </g>
          )
        })}
        <polygon points={scores.join(' ')} fill="rgba(59,130,246,0.35)" stroke="#2563eb" strokeWidth="2" />
      </svg>

      <div className="space-y-3">
        {dimensions.map((dimension: any, index: number) => {
          const label = typeof dimension === 'string' ? dimension : dimension.label
          const key = typeof dimension === 'string' ? `${label}-${index}` : dimension.id
          return (
            <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">{label}</span>
                <span className="font-bold text-slate-900">{valueMap[label] ?? 5}/10</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={valueMap[label] ?? 5}
                onChange={(event) => {
                  const next = { ...(responses[block.id] || {}), [label]: Number(event.target.value) }
                  updateResponse(block.id, next)
                }}
                className="w-full"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SwotBoard({ block, responses, updateResponse }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void }) {
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
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-900">{block.label}</h3>
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
    </div>
  )
}

function QuadrantBoard({ block, responses, updateResponse }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void }) {
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
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-900">{block.label}</h3>
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
            <input type="range" min={0} max={100} value={x} onChange={(event) => updateResponse(block.id, { ...defaultValue, x: Number(event.target.value) })} className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Vertical position</span>
            <input type="range" min={0} max={100} value={y} onChange={(event) => updateResponse(block.id, { ...defaultValue, y: Number(event.target.value) })} className="w-full" />
          </label>
          <textarea
            value={defaultValue.rationale || ''}
            onChange={(event) => updateResponse(block.id, { ...defaultValue, rationale: event.target.value })}
            className="min-h-28 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
            placeholder="Why did you place the tool here?"
          />
        </div>
      </div>
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

export function getDefaultPageTimer() {
  return {
    enabled: false,
    durationSeconds: 300,
    behaviour: 'advisory' as const,
  }
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

    return { label: group.label, score: group.responses.length ? total / group.responses.length : 0, responseCount: group.responses.length }
  }).sort((left, right) => right.score - left.score)

  const topGroup = rankedGroups[0]
  const headline = `${topGroup?.label || 'This response set'} stands out as the strongest overall result for the class.`
  const summary = `Across the current responses, students most often highlight the strongest patterns associated with ${topGroup?.label || 'the current grouping'}, while also identifying a few areas to improve.`

  return {
    headline,
    summary,
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

export function getDefaultBlockConfig(type: string, timestamp: number): Record<string, any> {
  switch (type) {
    case 'singleSelect':
      return {
        options: ['Option 1', 'Option 2'],
      }
    case 'richText':
      return {
        placeholder: 'Write and format your response here.',
        mode: 'response',
        contentHtml: '<p>Add rich text information for students here.</p>',
      }
    case 'url':
      return {
        url: 'https://example.com',
        buttonText: 'Open link',
        audience: 'student',
      }
    case 'randomizer':
      return {
        prompt: 'Generate a random item from this list.',
        items: ['Item 1', 'Item 2', 'Item 3'],
        shuffle: true,
        requireFirstGeneration: false,
        displayStyle: 'word-flicker',
        animationDurationMs: 1800,
      }
    case 'multipleChoice':
      return {
        question: 'Which answer is correct?',
        options: ['Option A', 'Option B', 'Option C'],
        correctAnswer: 'Option A',
        multipleAnswers: false,
        showFeedback: true,
        points: 1,
        explanation: 'Explain why the correct answer is right.',
      }
    case 'trueFalse':
      return {
        question: 'Is this statement true?',
        correctAnswer: true,
        showFeedback: true,
        points: 1,
        explanation: 'Explain the reasoning behind the correct answer.',
      }
    case 'shortAnswer':
      return {
        question: 'Provide the correct term or phrase.',
        correctAnswer: 'answer',
        showFeedback: true,
        points: 1,
        explanation: 'Explain the correct answer briefly.',
      }
    case 'matching':
      return {
        pairs: [
          { id: 'pair-1', prompt: 'Photosynthesis', answer: 'Light energy' },
          { id: 'pair-2', prompt: 'Mitochondria', answer: 'Cellular respiration' },
        ],
        options: ['Light energy', 'Cellular respiration', 'DNA replication'],
        showFeedback: true,
        points: 1,
      }
    case 'fillBlank':
      return {
        question: 'The capital of France is ______.',
        correctAnswer: 'Paris',
        showFeedback: true,
        points: 1,
        explanation: 'Paris is the capital city of France.',
      }
    case 'checklist':
      return {
        options: ['Option 1', 'Option 2'],
      }
    case 'ranking':
      return {
        options: ['Option 1', 'Option 2', 'Option 3'],
      }
    case 'matrix':
      return {
        rows: ['Criteria 1', 'Criteria 2', 'Criteria 3'],
        min: 1,
        max: 5,
        defaultValue: 3,
      }
    case 'imagePrompt':
      return {
        imageUrl: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
        altText: 'Worksheet image prompt',
      }
    case 'video':
    case 'youtube':
      return {
        videoUrl: type === 'youtube' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        altText: type === 'youtube' ? 'YouTube video prompt' : 'Video prompt',
      }
    case 'quiz':
      return {
        question: 'Which answer is correct?',
        options: ['Option A', 'Option B', 'Option C'],
        correctAnswer: 'Option A',
        showFeedback: true,
        points: 1,
        explanation: 'Explain why the correct answer is right.',
      }
    case 'section':
      return {
        title: 'Section heading',
      }
    case 'radar':
      return {
        dimensions: [
          { id: `radar-dimension-${timestamp}`, label: 'Dimension 1' },
          { id: `radar-dimension-${timestamp + 1}`, label: 'Dimension 2' },
        ],
      }
    case 'quadrant':
      return { xLeft: 'Left', xRight: 'Right', yBottom: 'Bottom', yTop: 'Top', rationaleRequired: true }
    case 'swot':
      return {
        categories: [
          { id: 'strengths', label: 'Strengths' },
          { id: 'weaknesses', label: 'Weaknesses' },
          { id: 'opportunities', label: 'Opportunities' },
          { id: 'threats', label: 'Threats' },
        ],
      }
    default:
      return {}
  }
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
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  editable?: boolean
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
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
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
    { label: 'Bullet list', shortLabel: '• List', run: () => editor.chain().focus().toggleBulletList().run(), isActive: editor.isActive('bulletList'), canRun: editor.can().chain().focus().toggleBulletList().run() },
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

function RichTextEditorBlock({ block, responses, updateResponse }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void }) {
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

  const currentValue = typeof responses[block.id] === 'string' ? responses[block.id] : ''

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <p className="text-sm font-medium text-slate-700">{block.label}</p>
        {block.description && <p className="mt-1 text-xs text-slate-500">{block.description}</p>}
      </div>
      <RichTextSurface
        value={currentValue}
        onChange={(value) => updateResponse(block.id, value)}
        placeholder={block.config?.placeholder || 'Write and format your response here.'}
        editable
      />
    </div>
  )
}

function RandomizerBlock({ block, responses, updateResponse }: { block: WorksheetBlock; responses: Record<string, any>; updateResponse: (blockId: string, value: any) => void }) {
  const items = Array.isArray(block.config?.items) ? block.config.items.filter((item: unknown) => typeof item === 'string' && item.trim()) : []
  const prompt = block.config?.prompt || 'Generate a random item from this list.'
  const currentValue = responses[block.id]
  const requireFirstGeneration = Boolean(block.config?.requireFirstGeneration)
  const configuredDisplayStyle = block.config?.displayStyle as 'word-flicker' | 'wheel' | 'card-shuffle' | undefined
  const displayStyle: 'word-flicker' | 'wheel' | 'card-shuffle' = configuredDisplayStyle === 'wheel' || configuredDisplayStyle === 'card-shuffle' || configuredDisplayStyle === 'word-flicker'
    ? configuredDisplayStyle
    : 'word-flicker'
  const animationDurationMs = Math.max(300, Number(block.config?.animationDurationMs ?? 1800))
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

  const getShuffledItems = () => {
    if (block.config?.shuffle === false) return [...items]
    return [...items].sort(() => Math.random() - 0.5)
  }

  const cardCanPick = cardPhase === 'choosing'
  const cardHasGenerated = cardPhase !== 'preview'

  const generateAnimatedValue = useCallback(() => {
    if (!items.length) return

    const nextValue = getShuffledItems()[0]
    const rollingIntervalMs = Math.max(80, Math.min(140, Math.round(animationDurationMs / 14)))

    setIsAnimating(true)
    const timer = window.setInterval(() => {
      const rollingItem = getShuffledItems()[Math.floor(Math.random() * getShuffledItems().length)] || nextValue
      setDisplayValue(rollingItem)
    }, rollingIntervalMs)

    window.setTimeout(() => {
      window.clearInterval(timer)
      setDisplayValue(nextValue)
      setIsAnimating(false)
      updateResponse(block.id, nextValue)
    }, animationDurationMs)
  }, [animationDurationMs, block.config?.shuffle, block.id, items, updateResponse])

  const generateWheelValue = useCallback(() => {
    if (!items.length) return

    const nextValue = getShuffledItems()[0]
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

    setCardPhase('flipping')
    setRevealedCardIndex(null)
    setDisplayValue('')
    setCardDeckItems(getShuffledItems())
    setIsAnimating(true)

    window.setTimeout(() => {
      setIsAnimating(false)
      setCardPhase('choosing')
    }, animationDurationMs)
  }, [animationDurationMs, block.config?.shuffle, items])

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
      setDisplayValue('')
      setIsAnimating(false)
      setWheelTargetIndex(null)
      setPendingWheelValue(null)
      setCardDeckItems([])
      setCardPhase('preview')
      setRevealedCardIndex(null)
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
  }, [currentValue, displayStyle, items])

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
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-700">{block.label || prompt}</p>
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
            <div className="min-h-12 min-w-48 rounded-xl border border-white/60 bg-white/80 px-4 py-2 text-center text-sm font-semibold text-blue-900 shadow-inner">
              {displayValue || (isAnimating ? 'Generating...' : 'Click Generate to spin')}
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
    </div>
    </>
  )
}

function renderBlock(block: WorksheetBlock, responses: Record<string, any>, updateResponse: (blockId: string, value: any) => void) {
  switch (block.type) {
    case 'content':
      return (
        <div className="rounded-2xl bg-slate-50 p-4">
          {block.title && <h3 className="text-lg font-semibold text-slate-900">{block.title}</h3>}
          {block.description && <p className="mt-2 text-sm text-slate-600">{block.description}</p>}
        </div>
      )
    case 'richText':
      return <RichTextEditorBlock block={block} responses={responses} updateResponse={updateResponse} />
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
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">{block.label}</span>
          {block.description && <p className="mb-2 text-xs text-slate-500">{block.description}</p>}
          <input
            value={responses[block.id] || ''}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-800 outline-none ring-0 transition focus:border-blue-500"
            placeholder={block.config?.placeholder || 'Type here'}
          />
        </label>
      )
    case 'longText':
      return (
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">{block.label}</span>
          {block.description && <p className="mb-2 text-xs text-slate-500">{block.description}</p>}
          <textarea
            value={responses[block.id] || ''}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            className="min-h-28 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500"
            placeholder={block.config?.placeholder || 'Write your response'}
          />
        </label>
      )
    case 'singleSelect':
      return (
        <fieldset className="space-y-3">
          <legend className="mb-2 block text-sm font-medium text-slate-700">{block.label}</legend>
          {(block.config?.options || []).map((option: string) => (
            <label key={option} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <input type="radio" name={block.id} checked={responses[block.id] === option} onChange={() => updateResponse(block.id, option)} />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      )
    case 'randomizer': {
      return <RandomizerBlock block={block} responses={responses} updateResponse={updateResponse} />
    }
    case 'multipleChoice':
    case 'quiz': {
      const allowMultiple = Boolean(block.config?.multipleAnswers)
      const selectedValues = allowMultiple ? (Array.isArray(responses[block.id]) ? responses[block.id] : []) : responses[block.id]
      const correctAnswer = block.config?.correctAnswer
      const showFeedback = block.config?.showFeedback !== false

      return (
        <fieldset className="space-y-3">
          <legend className="mb-2 block text-sm font-medium text-slate-700">{block.label || block.config?.question || 'Quiz question'}</legend>
          {block.config?.question && <p className="text-sm text-slate-600">{block.config.question}</p>}
          {allowMultiple ? (
            (block.config?.options || []).map((option: string) => {
              const checked = Array.isArray(selectedValues) && selectedValues.includes(option)
              const isCorrect = Array.isArray(correctAnswer) && correctAnswer.includes(option)
              const isSelected = checked
              const showState = selectedValues !== undefined && isSelected
              return (
                <label key={option} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${showState && isCorrect ? 'border-emerald-300 bg-emerald-50' : showState && !isCorrect ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const nextValues = Array.isArray(selectedValues) ? [...selectedValues] : []
                      const index = nextValues.indexOf(option)
                      if (index >= 0) nextValues.splice(index, 1)
                      else nextValues.push(option)
                      updateResponse(block.id, nextValues)
                    }}
                  />
                  <span>{option}</span>
                </label>
              )
            })
          ) : (
            (block.config?.options || []).map((option: string) => {
              const isCorrect = option === correctAnswer
              const isSelected = selectedValues === option
              const showState = selectedValues !== undefined && isSelected
              return (
                <label key={option} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${showState && isCorrect ? 'border-emerald-300 bg-emerald-50' : showState && !isCorrect ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                  <input type="radio" name={block.id} checked={selectedValues === option} onChange={() => updateResponse(block.id, option)} />
                  <span>{option}</span>
                </label>
              )
            })
          )}
          {selectedValues !== undefined && showFeedback && (
            <div className={`rounded-xl border px-3 py-2 text-sm ${allowMultiple ? (JSON.stringify((Array.isArray(selectedValues) ? selectedValues : []).sort()) === JSON.stringify((Array.isArray(correctAnswer) ? correctAnswer : []).sort()) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700') : (selectedValues === correctAnswer ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700')}`}>
              {allowMultiple ? (JSON.stringify((Array.isArray(selectedValues) ? selectedValues : []).sort()) === JSON.stringify((Array.isArray(correctAnswer) ? correctAnswer : []).sort()) ? 'Correct.' : `Incorrect. Correct answer: ${String((Array.isArray(correctAnswer) ? correctAnswer : []).join(', ') || 'Not set')}.`) : (selectedValues === correctAnswer ? 'Correct.' : `Incorrect. Correct answer: ${String(correctAnswer || 'Not set')}.`)}
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
        <fieldset className="space-y-3">
          <legend className="mb-2 block text-sm font-medium text-slate-700">{block.label || block.config?.question || 'True or false'}</legend>
          {block.config?.question && <p className="text-sm text-slate-600">{block.config.question}</p>}
          {['True', 'False'].map((option) => {
            const boolValue = option === 'True'
            const isCorrect = boolValue === correctAnswer
            const isSelected = selectedAnswer === boolValue
            const showState = selectedAnswer !== undefined && isSelected
            return (
              <label key={option} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${showState && isCorrect ? 'border-emerald-300 bg-emerald-50' : showState && !isCorrect ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <input type="radio" name={block.id} checked={selectedAnswer === boolValue} onChange={() => updateResponse(block.id, boolValue)} />
                <span>{option}</span>
              </label>
            )
          })}
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
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">{block.label || block.config?.question || 'Short answer'}</span>
          {block.config?.question && <p className="mb-2 text-xs text-slate-500">{block.config.question}</p>}
          <input
            value={selectedAnswer}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500"
            placeholder={block.config?.placeholder || 'Type your answer'}
          />
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
      const correctAnswerMap = Object.fromEntries(pairs.map((pair: any) => [String(pair.id ?? pair.prompt), String(pair.answer ?? '')]))
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">{block.label}</p>
          {pairs.map((pair: any, index: number) => {
            const pairKey = String(pair.id ?? `${pair.prompt}-${index}`)
            const selected = currentSelection[pairKey] ?? ''
            return (
              <div key={pairKey} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_210px]">
                <div className="text-sm font-medium text-slate-700">{pair.prompt || pair.left || `Item ${index + 1}`}</div>
                <select
                  value={selected}
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
      return (
        <fieldset className="space-y-3">
          <legend className="mb-2 block text-sm font-medium text-slate-700">{block.label}</legend>
          {(block.config?.options || []).map((option: string) => {
            const checked = selectedValues.includes(option)
            return (
              <label key={option} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selectedValues.filter((entry: string) => entry !== option)
                      : [...selectedValues, option]
                    updateResponse(block.id, next)
                  }}
                />
                <span>{option}</span>
              </label>
            )
          })}
        </fieldset>
      )
    }
    case 'ranking': {
      const currentOrder = Array.isArray(responses[block.id]) ? responses[block.id] : (block.config?.options || [])
      const moveOption = (index: number, direction: -1 | 1) => {
        const next = [...currentOrder]
        const targetIndex = index + direction
        if (targetIndex < 0 || targetIndex >= next.length) return
        const [moved] = next.splice(index, 1)
        next.splice(targetIndex, 0, moved)
        updateResponse(block.id, next)
      }
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{block.label}</p>
          {currentOrder.map((option: string, index: number) => (
            <div key={`${block.id}-${option}-${index}`} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{index + 1}</span>
              <span className="flex-1 text-sm text-slate-700">{option}</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => moveOption(index, -1)} disabled={index === 0} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-40">↑</button>
                <button type="button" onClick={() => moveOption(index, 1)} disabled={index === currentOrder.length - 1} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-40">↓</button>
              </div>
            </div>
          ))}
        </div>
      )
    }
    case 'matrix': {
      const rows = Array.isArray(block.config?.rows) ? block.config.rows : []
      const values = responses[block.id] || {}
      const min = Number(block.config?.min ?? 1)
      const max = Number(block.config?.max ?? 5)
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">{block.label}</p>
          {rows.map((row: string) => (
            <div key={`${block.id}-${row}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{row}</span>
                <span className="rounded-full bg-blue-100 px-2 py-1 text-sm font-semibold text-blue-700">{values[row] ?? block.config?.defaultValue ?? min}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={Number(values[row] ?? block.config?.defaultValue ?? min)}
                onChange={(event) => updateResponse(block.id, { ...values, [row]: Number(event.target.value) })}
                className="w-full"
              />
            </div>
          ))}
        </div>
      )
    }
    case 'imagePrompt':
      return (
        <div className="space-y-3">
          {block.config?.imageUrl && (
            <img src={block.config.imageUrl} alt={block.config.altText || block.label || 'Worksheet image'} className="h-56 w-full rounded-2xl object-cover" />
          )}
          {block.label && <p className="text-sm font-medium text-slate-700">{block.label}</p>}
          {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
          <textarea
            value={responses[block.id] || ''}
            onChange={(event) => updateResponse(block.id, event.target.value)}
            className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-800 outline-none transition focus:border-blue-500"
            placeholder={block.config?.placeholder || 'Add your notes here'}
          />
        </div>
      )
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
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{block.label}</span>
            <span className="rounded-full bg-blue-100 px-2 py-1 text-sm font-semibold text-blue-700">{responses[block.id] ?? '—'}</span>
          </div>
          {block.description && <p className="text-xs text-slate-500">{block.description}</p>}
          <input
            type="range"
            min={block.config?.min ?? 0}
            max={block.config?.max ?? 10}
            step={block.config?.step ?? 1}
            value={responses[block.id] ?? block.config?.defaultValue ?? 5}
            onChange={(event) => updateResponse(block.id, Number(event.target.value))}
            className="w-full"
          />
        </div>
      )
    case 'radar':
      return <RadarBlock block={block} responses={responses} updateResponse={updateResponse} />
    case 'swot':
      return <SwotBoard block={block} responses={responses} updateResponse={updateResponse} />
    case 'quadrant':
      return <QuadrantBoard block={block} responses={responses} updateResponse={updateResponse} />
    case 'verdict':
      return (
        <fieldset className="space-y-3">
          <legend className="mb-2 block text-sm font-medium text-slate-700">{block.label}</legend>
          {(block.config?.options || []).map((option: string) => (
            <label key={option} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <input type="radio" name={block.id} checked={responses[block.id] === option} onChange={() => updateResponse(block.id, option)} />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      )
    default:
      return null
  }
}

function formatBlockValue(block: WorksheetBlock, value: any) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (block.type === 'radar') return `Radar: ${Object.entries(value as Record<string, number>).map(([label, score]) => `${label}: ${score}`).join(', ')}`
  if (block.type === 'quadrant') return `Quadrant: x=${value.x}, y=${value.y}. Rationale: ${value.rationale || 'No rationale recorded'}`
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
    const value = Number(values[index] ?? 0)
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

function QuadrantMiniChart({ x, y }: { x: number; y: number }) {
  return (
    <svg viewBox="0 0 220 220" className="h-48 w-full max-w-[260px]">
      <rect x="0" y="0" width="220" height="220" fill="#f8fafc" rx="18" />
      <line x1="110" y1="0" x2="110" y2="220" stroke="#cbd5e1" strokeWidth="2" />
      <line x1="0" y1="110" x2="220" y2="110" stroke="#cbd5e1" strokeWidth="2" />
      <circle cx={(x / 100) * 220} cy={220 - (y / 100) * 220} r="7" fill="#f59e0b" stroke="#fff" strokeWidth="2" />
      <text x="18" y="112" fontSize="11" fill="#475569">Time</text>
      <text x="160" y="112" fontSize="11" fill="#475569">Learning</text>
      <text x="92" y="210" fontSize="11" fill="#475569">Low risk</text>
      <text x="92" y="18" fontSize="11" fill="#475569">High risk</text>
    </svg>
  )
}

function drawPdfRadar(pdf: jsPDF, centreX: number, centreY: number, radius: number, data: Record<string, number>) {
  const dimensions = Object.keys(data)
  const values = Object.values(data)
  if (!dimensions.length) return

  const points = dimensions.map((_, index) => {
    const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / dimensions.length
    const value = Number(values[index] ?? 0)
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

function SynthesisViewer({ definition, initialMode = 'student' }: { definition: WorksheetDefinition; initialMode?: 'student' | 'teacher' }) {
  const [responses, setResponses] = useState<WorksheetResponse[]>([])
  const [error, setError] = useState('')
  const [importInfo, setImportInfo] = useState('')
  const [mode, setMode] = useState<'student' | 'teacher'>(initialMode)
  const [groupingFilter, setGroupingFilter] = useState('all')
  const [responseLabelFilter, setResponseLabelFilter] = useState('all')
  const [verdictFilter, setVerdictFilter] = useState('all')
  const [searchFilter, setSearchFilter] = useState('')
  const structure = useMemo(() => getWorksheetStructure(definition), [definition])
  const responseLabelLookup = useMemo(
    () => Object.fromEntries(responses.map((response) => [response.responseId, getResponseLabel(response, definition)])),
    [definition, responses],
  )
  const synthesisResult = useMemo(() => groupResponsesByKey(definition, responses), [definition, responses])
  const groupings = synthesisResult.groups
  const synthesisConfig = synthesisResult.config
  const summaryBlocks = useMemo(
    () => structure.responseBlocks.filter((block) => RESPONSE_SUMMARY_BLOCK_TYPES.has(block.type) && block.id !== synthesisConfig.groupByBlockId && block.id !== synthesisConfig.responseLabelBlockId),
    [structure.responseBlocks, synthesisConfig.groupByBlockId, synthesisConfig.responseLabelBlockId],
  )
  const verdictBlocks = useMemo(
    () => structure.responseBlocks.filter((block) => block.type === 'verdict'),
    [structure.responseBlocks],
  )
  const matrixBlocks = useMemo(
    () => structure.responseBlocks.filter((block) => block.type === 'matrix'),
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
    () => buildStudentSynthesis(filteredGroupings, structure.radarBlockId, synthesisConfig.groupLabel),
    [filteredGroupings, structure.radarBlockId, synthesisConfig.groupLabel],
  )

  const clearFilters = () => {
    setGroupingFilter('all')
    setResponseLabelFilter('all')
    setVerdictFilter('all')
    setSearchFilter('')
  }

  const renderFilters = (title: string, description: string) => (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
        >
          Clear filters
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block text-sm font-medium text-slate-700">
          {synthesisConfig.groupLabel}
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

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    const parsed: WorksheetResponse[] = []
    let rejected = 0
    setError('')

    for (const file of files) {
      try {
        const text = await file.text()
        const json = JSON.parse(text) as WorksheetResponse
        if (json.worksheetId !== definition.id) {
          rejected += 1
          setError(`Rejected ${file.name}: worksheet ID must match ${definition.id}.`)
          continue
        }
        if (json.responseSchema !== 'interactive-worksheet-response') {
          rejected += 1
          setError(`Rejected ${file.name}: invalid response schema.`)
          continue
        }
        parsed.push(json)
      } catch {
        rejected += 1
        setError(`Rejected ${file.name}: malformed JSON.`)
      }
    }

    if (parsed.length > 0) {
      setResponses((current) => {
        const combined = [...current, ...parsed]
        const uniqueByResponseId = new Map<string, WorksheetResponse>()
        combined.forEach((response) => {
          uniqueByResponseId.set(response.responseId, response)
        })
        return Array.from(uniqueByResponseId.values())
      })
      setImportInfo(`Imported ${parsed.length} response file(s) for ${definition.title}.${rejected ? ` ${rejected} rejected.` : ''}`)
    } else if (files.length > 0) {
      setImportInfo(`No files imported.${rejected ? ` ${rejected} rejected.` : ''}`)
    }

    event.target.value = ''
  }

  const exportClassPdf = () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const groupingLabelPlural = pluralizeLabel(synthesisConfig.groupLabel, groupings.length)
    let y = 42

    pdf.setFillColor(15, 23, 42)
    pdf.rect(0, 0, pageWidth, 78, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(22)
    pdf.text(`${definition.title} — Class Evaluation Report`, 52, 40)
    pdf.setFontSize(10)
    pdf.setTextColor(191, 219, 254)
    pdf.text(`Worksheet: ${definition.id} v${definition.version}   •   Evaluations: ${responses.length}   •   ${groupingLabelPlural}: ${groupings.length}   •   Response labels: ${new Set(Object.values(responseLabelLookup)).size}`, 52, 60)

    y = 102
    pdf.setTextColor(15, 23, 42)
    pdf.setFontSize(14)
    pdf.text('Overview', 52, y)
    y += 18
    pdf.setFontSize(11)
    const cards = [
      `Total evaluations: ${responses.length}`,
      `${groupingLabelPlural}: ${groupings.length}`,
      `Response labels: ${new Set(Object.values(responseLabelLookup)).size}`,
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

    groupings.forEach((grouping) => {
      if (y > 560) {
        pdf.addPage()
        y = 52
      }
      pdf.setFillColor(255, 255, 255)
      pdf.roundedRect(52, y, 500, 120, 12, 12, 'FD')
      pdf.setTextColor(15, 23, 42)
      pdf.setFontSize(15)
      pdf.text(grouping.label, 68, y + 24)
      pdf.setFontSize(10)
      pdf.setTextColor(100, 116, 139)
      pdf.text(`${formatCountLabel(grouping.responses.length, 'evaluation')} in this ${synthesisConfig.groupLabel.toLowerCase()}`, 68, y + 38)

      const radarDimensions = structure.radarDimensions.length ? structure.radarDimensions : ['Score']
      const avgRadar = aggregateRadarValues(grouping.responses, radarDimensions, structure.radarBlockId)
      drawPdfRadar(pdf, 190, y + 80, 46, avgRadar)

      pdf.setTextColor(51, 65, 85)
      pdf.setFontSize(9)
      const metrics = Object.entries(avgRadar)
      metrics.forEach(([label, value], idx) => {
        const rowY = y + 52 + idx * 12
        pdf.text(label, 325, rowY)
        pdf.text(String(Number(value).toFixed(1)), 470, rowY)
        pdf.setDrawColor(226, 232, 240)
        pdf.line(325, rowY + 3, 470, rowY + 3)
      })

      y += 132
    })

    pdf.save(`${definition.id}-class-report.pdf`)
  }

  const renderStudentView = () => (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="bg-slate-900 px-6 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Student synthesis</h1>
            <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-400 px-3 py-2 text-sm font-medium text-slate-100 hover:border-slate-200"><ArrowLeft className="h-4 w-4" />Back to start</Link>
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
          <div className="text-sm text-slate-500">Top result</div>
          <div className="mt-3 text-2xl font-bold text-slate-900">{studentSynthesis.topGroup}</div>
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

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {studentSynthesis.highlights.map((highlight, index) => (
            <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Insight {index + 1}</p>
              <p className="mt-3 text-sm text-slate-700">{highlight}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h3 className="text-lg font-semibold text-emerald-900">What the class could do next</h3>
          <ul className="mt-3 space-y-2 text-sm text-emerald-800">
            {studentSynthesis.recommendations.map((recommendation, index) => (
              <li key={index} className="flex gap-2"><span className="mt-0.5 text-base">•</span><span>{recommendation}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-8 space-y-5">
        {filteredGroupings.map((grouping) => {
          const radarDimensions = structure.radarDimensions.length ? structure.radarDimensions : ['Score']
          const avgRadar = aggregateRadarValues(grouping.responses, radarDimensions, structure.radarBlockId)
          const avgPoint = aggregateQuadrantMean(grouping.responses, structure.quadrantBlockId)
          const swot = structure.swotBlockId
          const strengths = grouping.responses.flatMap((response) => ((response.responses[swot] as Record<string, any>)?.strengths || []).map((item: any) => ({ text: item.text, label: responseLabelLookup[response.responseId] })))
          const weaknesses = grouping.responses.flatMap((response) => ((response.responses[swot] as Record<string, any>)?.weaknesses || []).map((item: any) => ({ text: item.text, label: responseLabelLookup[response.responseId] })))
          const verdictSummaries = verdictBlocks.map((block) => {
            const counts = grouping.responses.reduce<Record<string, number>>((accumulator, response) => {
              const raw = response.responses?.[block.id]
              const verdict = typeof raw === 'string' ? raw.trim() : ''
              if (!verdict) return accumulator
              accumulator[verdict] = (accumulator[verdict] || 0) + 1
              return accumulator
            }, {})
            return { block, counts }
          }).filter(({ counts }) => Object.keys(counts).length > 0)
          const matrixSummaries = matrixBlocks.map((block) => {
            const rows = Array.isArray(block.config?.rows) ? block.config.rows : []
            const averages = Object.fromEntries(rows.map((row: string) => {
              const values = grouping.responses
                .map((response) => Number(response.responses?.[block.id]?.[row]))
                .filter((value) => Number.isFinite(value))
              const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
              return [row, average]
            })) as Record<string, number>
            return { block, averages }
          }).filter(({ averages }) => Object.keys(averages).length > 0)
          const topRanked = Object.entries(avgRadar).sort((left, right) => Number(right[1]) - Number(left[1]))[0]
          return (
            <article key={grouping.key} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">{grouping.label}</h3>
                  {grouping.isMissingValue && <p className="mt-1 text-sm text-amber-700">Grouping value missing for one or more imported responses.</p>}
                </div>
                <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{formatCountLabel(grouping.responses.length, 'evaluation')}</span>
              </div>
              <p className="mt-3 text-sm text-slate-600">The strongest pattern in this {synthesisConfig.groupLabel.toLowerCase()} was {topRanked ? topRanked[0] : 'overall response quality'} with an average score of {topRanked ? Number(topRanked[1]).toFixed(1) : 'n/a'}.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {grouping.responses.map((response) => (
                  <span key={response.responseId} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700">
                    {responseLabelLookup[response.responseId]}
                  </span>
                ))}
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">Aggregate</span>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Average radar</h3>
                    <span className="text-sm font-medium text-slate-700">Mean score</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <RadarSummaryChart data={avgRadar} />
                    <div className="flex-1 space-y-2 text-sm text-slate-700">
                      {Object.entries(avgRadar).map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between rounded-lg bg-white px-2.5 py-2 shadow-sm ring-1 ring-slate-200">
                          <span>{label}</span>
                          <span className="font-semibold text-slate-900">{Number(value).toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Quadrant position</h3>
                  <div className="mt-3 flex items-center justify-center gap-4">
                    <QuadrantMiniChart x={avgPoint.x} y={avgPoint.y} />
                  </div>
                  <div className="mt-3 flex justify-between text-sm text-slate-700">
                    <span>x: {avgPoint.x.toFixed(1)}</span>
                    <span>y: {avgPoint.y.toFixed(1)}</span>
                  </div>
                </div>
              </div>

              {(verdictSummaries.length > 0 || matrixSummaries.length > 0) && (
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {verdictSummaries.map(({ block, counts }) => (
                    <div key={block.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">{block.label || 'Verdict distribution'}</h3>
                      <div className="mt-3 space-y-2">
                        {Object.entries(counts).map(([verdict, count]) => (
                          <div key={verdict} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                            <span className="text-sm text-slate-700">{verdict}</span>
                            <span className="text-sm font-semibold text-slate-900">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {matrixSummaries.map(({ block, averages }) => (
                    <div key={block.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">{block.label || 'Matrix averages'}</h3>
                      <div className="mt-3 space-y-2">
                        {Object.entries(averages).map(([row, value]) => (
                          <div key={row} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                            <span className="text-sm text-slate-700">{row}</span>
                            <span className="text-sm font-semibold text-slate-900">{Number(value).toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-emerald-700">Strengths</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {strengths.slice(0, 5).map((item, index) => (
                      <li key={`${item.label}-${index}`} className="rounded-xl bg-white px-3 py-2 ring-1 ring-emerald-200">{item.text} <span className="text-slate-500">({item.label})</span></li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-red-700">Limitations</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {weaknesses.slice(0, 5).map((item, index) => (
                      <li key={`${item.label}-${index}`} className="rounded-xl bg-white px-3 py-2 ring-1 ring-red-200">{item.text} <span className="text-slate-500">({item.label})</span></li>
                    ))}
                  </ul>
                </div>
              </div>
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
            <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-400 px-3 py-2 text-sm font-medium text-slate-100 hover:border-slate-200"><ArrowLeft className="h-4 w-4" />Back to start</Link>
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
          const radarDimensions = structure.radarDimensions.length ? structure.radarDimensions : ['Score']
          const avgRadar = aggregateRadarValues(grouping.responses, radarDimensions, structure.radarBlockId)
          const avgPoint = aggregateQuadrantMean(grouping.responses, structure.quadrantBlockId)
          const swot = structure.swotBlockId
          const strengths = grouping.responses.flatMap((response) => ((response.responses[swot] as Record<string, any>)?.strengths || []).map((item: any) => ({ text: item.text, label: responseLabelLookup[response.responseId] })))
          const weaknesses = grouping.responses.flatMap((response) => ((response.responses[swot] as Record<string, any>)?.weaknesses || []).map((item: any) => ({ text: item.text, label: responseLabelLookup[response.responseId] })))
          const verdictSummaries = verdictBlocks.map((block) => {
            const counts = grouping.responses.reduce<Record<string, number>>((accumulator, response) => {
              const raw = response.responses?.[block.id]
              const verdict = typeof raw === 'string' ? raw.trim() : ''
              if (!verdict) return accumulator
              accumulator[verdict] = (accumulator[verdict] || 0) + 1
              return accumulator
            }, {})
            return { block, counts }
          }).filter(({ counts }) => Object.keys(counts).length > 0)
          const matrixSummaries = matrixBlocks.map((block) => {
            const rows = Array.isArray(block.config?.rows) ? block.config.rows : []
            const averages = Object.fromEntries(rows.map((row: string) => {
              const values = grouping.responses
                .map((response) => Number(response.responses?.[block.id]?.[row]))
                .filter((value) => Number.isFinite(value))
              const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
              return [row, average]
            })) as Record<string, number>
            return { block, averages }
          }).filter(({ averages }) => Object.keys(averages).length > 0)
          const responseCards = grouping.responses.map((response) => ({
            response,
            label: responseLabelLookup[response.responseId],
            entries: summaryBlocks
              .map((block) => ({ block, value: response.responses?.[block.id] }))
              .filter(({ value }) => value !== undefined && value !== null && value !== ''),
          }))
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
                {grouping.responses.map((response) => (
                  <span key={response.responseId} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700">{responseLabelLookup[response.responseId]}</span>
                ))}
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Average radar</h3>
                    <span className="text-sm font-medium text-slate-700">Mean score</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <RadarSummaryChart data={avgRadar} />
                    <div className="flex-1 space-y-2 text-sm text-slate-700">
                      {Object.entries(avgRadar).map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between rounded-lg bg-white px-2.5 py-2 shadow-sm ring-1 ring-slate-200">
                          <span>{label}</span>
                          <span className="font-semibold text-slate-900">{Number(value).toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Quadrant position</h3>
                  <div className="mt-3 flex items-center justify-center gap-4">
                    <QuadrantMiniChart x={avgPoint.x} y={avgPoint.y} />
                  </div>
                  <div className="mt-3 flex justify-between text-sm text-slate-700">
                    <span>x: {avgPoint.x.toFixed(1)}</span>
                    <span>y: {avgPoint.y.toFixed(1)}</span>
                  </div>
                </div>
              </div>

              {(verdictSummaries.length > 0 || matrixSummaries.length > 0) && (
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {verdictSummaries.map(({ block, counts }) => (
                    <div key={block.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">{block.label || 'Verdict distribution'}</h3>
                      <div className="mt-3 space-y-2">
                        {Object.entries(counts).map(([verdict, count]) => (
                          <div key={verdict} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                            <span className="text-sm text-slate-700">{verdict}</span>
                            <span className="text-sm font-semibold text-slate-900">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {matrixSummaries.map(({ block, averages }) => (
                    <div key={block.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">{block.label || 'Matrix averages'}</h3>
                      <div className="mt-3 space-y-2">
                        {Object.entries(averages).map(([row, value]) => (
                          <div key={row} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                            <span className="text-sm text-slate-700">{row}</span>
                            <span className="text-sm font-semibold text-slate-900">{Number(value).toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-emerald-700">Strengths</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {strengths.slice(0, 5).map((item, index) => (
                      <li key={`${item.label}-${index}`} className="rounded-xl bg-white px-3 py-2 ring-1 ring-emerald-200">{item.text} <span className="text-slate-500">({item.label})</span></li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-red-700">Limitations</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {weaknesses.slice(0, 5).map((item, index) => (
                      <li key={`${item.label}-${index}`} className="rounded-xl bg-white px-3 py-2 ring-1 ring-red-200">{item.text} <span className="text-slate-500">({item.label})</span></li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Individual responses</h3>
                  <span className="text-sm text-slate-600">Written responses stay separate from the aggregate.</span>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {responseCards.map(({ response, label, entries }) => (
                    <div key={response.responseId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-base font-semibold text-slate-900">{label}</h4>
                        <span className="text-xs uppercase tracking-[0.12em] text-slate-500">{response.responseId.slice(0, 8)}</span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {entries.length > 0 ? entries.map(({ block, value }) => (
                          <div key={`${response.responseId}-${block.id}`} className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{getBlockDisplayLabel(block)}</div>
                            {block.type === 'richText' && TEXT_RESPONSE_BLOCK_TYPES.has(block.type) ? (
                              <div className="prose prose-slate mt-2 max-w-none text-sm" dangerouslySetInnerHTML={{ __html: String(value) }} />
                            ) : (
                              <div className="mt-2 text-sm text-slate-700">{formatBlockValue(block, value)}</div>
                            )}
                          </div>
                        )) : <p className="text-sm text-slate-500">No additional written responses were recorded for this submission.</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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

function BuilderPage({
  definition,
  setDefinition,
  importWorksheetDefinition,
}: {
  definition: WorksheetDefinition
  setDefinition: WorksheetBuilderSetter
  importWorksheetDefinition: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
}) {
  const blockLibrary = [
    { type: 'content', description: 'Static instructional text, prompts, or section headings.' },
    { type: 'richText', description: 'Rich text response area with basic formatting controls.' },
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
    { type: 'matrix', description: 'Compare multiple rows against a common scale or rubric.' },
    { type: 'imagePrompt', description: 'Display an image and invite a written reflection or analysis.' },
    { type: 'video', description: 'Embed a generic video from a direct URL or media file.' },
    { type: 'youtube', description: 'Embed a YouTube clip using a YouTube share or watch URL.' },
    { type: 'section', description: 'Add a clear visual divider or section label to structure the worksheet.' },
    { type: 'rating', description: 'Numeric slider scale for confidence, usefulness, or score input.' },
    { type: 'radar', description: 'Multi-dimension scoring visualized as a radar/spider chart.' },
    { type: 'quadrant', description: 'Two-axis placement activity for value vs risk mapping.' },
    { type: 'swot', description: 'Card-based SWOT board with strengths, weaknesses, opportunities, threats.' },
    { type: 'verdict', description: 'Final recommendation/decision options for concluding judgement.' },
  ]

  const blockCategories = [
    { key: 'text', label: 'Text & prompts', types: ['content', 'richText', 'shortText', 'longText', 'section'] },
    { key: 'quiz', label: 'Quiz', types: ['multipleChoice', 'trueFalse', 'shortAnswer', 'matching', 'fillBlank'] },
    { key: 'choice', label: 'Choice & selection', types: ['singleSelect', 'randomizer', 'checklist', 'ranking', 'verdict'] },
    { key: 'analysis', label: 'Assessment & analysis', types: ['rating', 'matrix', 'radar', 'quadrant', 'swot'] },
    { key: 'media', label: 'Media & evidence', types: ['imagePrompt', 'video', 'youtube', 'url'] },
  ]

  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    text: true,
    quiz: true,
    choice: true,
    analysis: true,
    media: true,
  })

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

  const addPage = () => {
    const timestamp = Date.now()
    const nextPage: WorksheetPage = {
      id: `page-${timestamp}`,
      title: `Page ${definition.pages.length + 1}`,
      timer: getDefaultPageTimer(),
      blocks: [{ id: `block-${timestamp}`, type: 'content', title: 'New content block' }],
    }
    setDefinition((previous) => ({ ...previous, pages: [...previous.pages, nextPage] }))
    setSelectedPageId(nextPage.id)
    setSelectedBlockId(nextPage.blocks[0].id)
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
      return { ...previous, pages: nextPages }
    })
  }

  const duplicateSelectedPage = () => {
    if (!selectedPage) return
    const pageIndex = definition.pages.findIndex((page) => page.id === selectedPage.id)
    if (pageIndex < 0) return

    const baseTime = Date.now()
    const duplicatedBlocks = selectedPage.blocks.map((block, blockIndex) => ({
      ...JSON.parse(JSON.stringify(block)) as WorksheetBlock,
      id: `block-${baseTime}-${blockIndex + 1}`,
    }))

    const duplicatePage: WorksheetPage = {
      ...JSON.parse(JSON.stringify(selectedPage)) as WorksheetPage,
      id: `page-${baseTime}`,
      title: `${selectedPage.title} (Copy)`,
      blocks: duplicatedBlocks,
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
        id: `page-${Date.now()}`,
        title: 'Page 1',
        timer: getDefaultPageTimer(),
        blocks: [],
      }
      setDefinition((previous) => ({
        ...previous,
        synthesis: clearRemovedBlockReferences(previous.synthesis, selectedPage.blocks.map((block) => block.id)),
        pages: [replacementPage],
      }))
      setSelectedPageId(replacementPage.id)
      setSelectedBlockId('')
      return
    }

    if (!window.confirm('Delete this page and all of its blocks?')) return
    const currentIndex = definition.pages.findIndex((page) => page.id === selectedPage.id)
    const fallbackPage = definition.pages[Math.max(0, currentIndex - 1)]

    setDefinition((previous) => ({
      ...previous,
      synthesis: clearRemovedBlockReferences(previous.synthesis, selectedPage.blocks.map((block) => block.id)),
      pages: previous.pages.filter((page) => page.id !== selectedPage.id),
    }))
    if (fallbackPage) {
      setSelectedPageId(fallbackPage.id)
      setSelectedBlockId(fallbackPage.blocks[0]?.id || '')
    }
  }

  const createBlockFromType = (type: string): WorksheetBlock => {
    const timestamp = Date.now()
    return {
      id: `block-${timestamp}`,
      type,
      label: `New ${type} block`,
      title: type === 'content' ? 'New content block' : type === 'section' ? 'Section heading' : undefined,
      config: getDefaultBlockConfig(type, timestamp),
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
    if (!selectedPage) return
    const fromIndex = selectedPage.blocks.findIndex((block) => block.id === blockId)
    if (fromIndex < 0) return

    setDefinition((previous) => ({
      ...previous,
      pages: previous.pages.map((page) => {
        if (page.id !== selectedPage.id) return page
        const nextBlocks = [...page.blocks]
        const [moved] = nextBlocks.splice(fromIndex, 1)
        if (!moved) return page
        const adjustedIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex
        const boundedIndex = Math.max(0, Math.min(adjustedIndex, nextBlocks.length))
        nextBlocks.splice(boundedIndex, 0, moved)
        return { ...page, blocks: nextBlocks }
      }),
    }))
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

    if (synthesisEffects.length > 0) {
      const warningText = `This block is currently used to ${synthesisEffects.join(' and ')}. Deleting it will remove that synthesis setting.`
      if (!window.confirm(warningText)) return
    }

    setDefinition((previous) => ({
      ...previous,
      synthesis: clearRemovedBlockReferences(previous.synthesis, [selectedBlock.id]),
      pages: previous.pages.map((page) => (
        page.id === selectedPage.id
          ? { ...page, blocks: page.blocks.filter((block) => block.id !== selectedBlock.id) }
          : page
      )),
    }))
  }

  const duplicateBlockAtIndex = (pageId: string, blockId: string, index: number) => {
    const blockToDuplicate = definition.pages
      .find((page) => page.id === pageId)?.blocks.find((block) => block.id === blockId)

    if (!blockToDuplicate) return

    const duplicateBlock: WorksheetBlock = {
      ...JSON.parse(JSON.stringify(blockToDuplicate)) as WorksheetBlock,
      id: `block-${Date.now()}`,
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

  const selectedConfig = (selectedBlock?.config || {}) as Record<string, any>
  const optionList = Array.isArray(selectedConfig.options) ? (selectedConfig.options as string[]) : []
  const randomizerItems = Array.isArray(selectedConfig.items) ? (selectedConfig.items as string[]) : []
  const rankingOptions = Array.isArray(selectedConfig.options) ? (selectedConfig.options as string[]) : []
  const matrixRows = Array.isArray(selectedConfig.rows) ? (selectedConfig.rows as string[]) : []
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
    updateSelectedBlock({ config: { ...selectedConfig, ...partial } })
  }

  const synthesisBlockOptions = getResponseProducingBlocks(definition).map((block) => ({
    value: block.id,
    label: getBlockDisplayLabel(block),
  }))
  const synthesisSettings = definition.synthesis || {}

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

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Builder</p>
          <h1 className="text-3xl font-bold text-slate-900">Worksheet Builder</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"><ArrowLeft className="h-4 w-4" />Back to start</Link>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">
            <Upload className="h-4 w-4" />
            Load worksheet JSON
            <input type="file" accept="application/json" className="hidden" onChange={importWorksheetDefinition} />
          </label>
          <Link to="/preview" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"><Eye className="h-4 w-4" />Preview</Link>
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
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            <FileUp className="h-4 w-4" />
            Export worksheet
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[260px_1fr_360px]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Wrench className="h-5 w-5" />
            Block library
          </h2>
          <div className="space-y-3">
            {blockCategories.map((category) => {
              const categoryEntries = blockLibrary.filter((entry) => category.types.includes(entry.type))
              const isExpanded = expandedCategories[category.key] ?? true

              return (
                <div key={category.key} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setExpandedCategories((previous) => ({ ...previous, [category.key]: !isExpanded }))}
                    className="flex w-full items-center justify-between bg-slate-100 px-3 py-2 text-left text-sm font-semibold text-slate-700"
                  >
                    <span>{category.label}</span>
                    <span className="text-slate-500">{isExpanded ? '−' : '+'}</span>
                  </button>

                  {isExpanded && (
                    <div className="space-y-2 p-2">
                      {categoryEntries.map((entry) => (
                        <button
                          key={entry.type}
                          onClick={() => addBlock(entry.type)}
                          title={entry.description}
                          draggable
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
                          className={`flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-400 ${activeDrag?.kind === 'library' && activeDrag.id === entry.type ? 'border-blue-400 bg-blue-100 shadow-lg ring-2 ring-blue-200 opacity-100' : ''}`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            {entry.type}
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

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
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

          <div className="mb-4 flex items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {definition.pages.map((page) => (
                <button key={page.id} onClick={() => setSelectedPageId(page.id)} className={`rounded-xl px-3 py-2 text-sm font-medium ${page.id === selectedPageId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                  {page.title}
                </button>
              ))}
            </div>
            <button onClick={addPage} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Add page</button>
          </div>

          {selectedPage && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
                      className={`cursor-grab rounded-2xl border p-3 transition ${selectedBlockId === block.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50'} ${activeDrag?.kind === 'existing' && activeDrag.id === block.id ? 'border-blue-500 bg-blue-100 shadow-xl ring-2 ring-blue-200 opacity-100' : ''}`}
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
                            <FileText className="h-4 w-4" />
                            {block.label || block.title || block.type}
                          </span>
                          <span className="text-xs uppercase tracking-[0.15em] text-slate-500">{block.type}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            duplicateBlockAtIndex(selectedPage.id, block.id, index)
                          }}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-700 hover:border-slate-400"
                        >
                          Duplicate
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                        Drag block to reorder
                      </p>
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
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Selected block</h2>
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
                  {(selectedBlock.type === 'multipleChoice' || selectedBlock.type === 'singleSelect' || selectedBlock.type === 'verdict' || selectedBlock.type === 'checklist' || selectedBlock.type === 'ranking' || selectedBlock.type === 'quiz' || selectedBlock.type === 'trueFalse' || selectedBlock.type === 'matching') && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">{selectedBlock.type === 'ranking' ? 'Ranking options' : selectedBlock.type === 'trueFalse' ? 'True/false choices' : selectedBlock.type === 'matching' ? 'Matching choices' : selectedBlock.type === 'quiz' ? 'Quiz options' : 'Options'}</p>
                      {(selectedBlock.type === 'trueFalse' ? ['True', 'False'] : selectedBlock.type === 'matching' ? (selectedConfig.options || ['Option 1', 'Option 2']) : selectedBlock.type === 'ranking' ? rankingOptions : optionList).map((option: string, index: number) => (
                        <div key={`${selectedBlock.id}-option-${index}`} className="flex items-center gap-2">
                          <input
                            value={option}
                            onChange={(event) => {
                              const current = selectedBlock.type === 'ranking' ? rankingOptions : optionList
                              const next = [...current]
                              next[index] = event.target.value
                              updateSelectedConfig({ options: next })
                            }}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const current = selectedBlock.type === 'ranking' ? rankingOptions : optionList
                              const next = current.filter((_, optionIndex) => optionIndex !== index)
                              updateSelectedConfig({ options: next })
                            }}
                            className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateSelectedConfig({ options: [...(selectedBlock.type === 'ranking' ? rankingOptions : optionList), `Option ${(selectedBlock.type === 'ranking' ? rankingOptions : optionList).length + 1}`] })}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        Add option
                      </button>
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
                                {(selectedConfig.options || []).map((option: string) => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            ) : (
                              <select value={selectedConfig.correctAnswer || ''} onChange={(event) => updateSelectedConfig({ correctAnswer: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case">
                                <option value="">Select an answer</option>
                                {(selectedConfig.options || []).map((option: string) => (
                                  <option key={option} value={option}>{option}</option>
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
                                <button type="button" onClick={() => updateSelectedConfig({ pairs: (selectedConfig.pairs || []).filter((_: any, itemIndex: number) => itemIndex !== index) })} className="rounded-lg border border-red-300 bg-red-50 px-2 py-2 text-xs font-medium text-red-700">Remove</button>
                              </div>
                            </div>
                          ))}
                          <button type="button" onClick={() => updateSelectedConfig({ pairs: [...(selectedConfig.pairs || []), { id: `pair-${Date.now()}`, prompt: 'New prompt', answer: 'New match' }] })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700">Add pair</button>
                        </div>
                      ) : (
                        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Correct answer
                          <input value={selectedConfig.correctAnswer || ''} onChange={(event) => updateSelectedConfig({ correctAnswer: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
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

                  {selectedBlock.type === 'matrix' && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Matrix rows</p>
                      {matrixRows.map((row, index) => (
                        <div key={`${selectedBlock.id}-row-${index}`} className="flex items-center gap-2">
                          <input
                            value={row}
                            onChange={(event) => {
                              const next = [...matrixRows]
                              next[index] = event.target.value
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
                        onClick={() => updateSelectedConfig({ rows: [...matrixRows, `Criteria ${matrixRows.length + 1}`] })}
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

                  {selectedBlock.type === 'imagePrompt' && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Image URL
                        <input value={selectedConfig.imageUrl || ''} onChange={(event) => updateSelectedConfig({ imageUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Alt text
                        <input value={selectedConfig.altText || ''} onChange={(event) => updateSelectedConfig({ altText: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
                      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Placeholder
                        <input value={selectedConfig.placeholder || ''} onChange={(event) => updateSelectedConfig({ placeholder: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm normal-case" />
                      </label>
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
                              const next = radarDimensions.filter((_, dimensionIndex) => dimensionIndex !== index)
                              updateSelectedConfig({ dimensions: next })
                            }}
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
                              const next = swotCategories.filter((_, categoryIndex) => categoryIndex !== index)
                              updateSelectedConfig({ categories: next })
                            }}
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
                    <button type="button" onClick={duplicateSelectedBlock} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Duplicate selected block</button>
                    <button onClick={deleteSelectedBlock} className="w-full rounded-xl bg-red-100 px-3 py-2 text-sm font-medium text-red-700">Delete selected block</button>
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
