// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderBlock } from './App'
import { aggregateContinuum, aggregateDecisionMatrix, buildStudentSynthesis } from './lib/aggregation'
import { getStoredSessionCreatedAt, loadSession, saveSession } from './lib/storage'
import { canNavigateToVisiblePage, formatQuizPercent, getAdjacentVisiblePageIndex, getBoardPresetColumns, getDefaultBlockConfig, getDefaultPageTimer, getFillBlankCorrectAnswerPatch, getImageDisplayConfig, getMissingRequiredBlockLocations, getMissingRequiredBlocks, getQuizSummary, getVisibleBlocks, getVisiblePages, isConditionMet, isRequiredBlockSatisfied, reconcileCategorizeResponse, reconcileRankingResponse, reconcileWorksheetResponses } from './lib/worksheetLogic'

describe('worksheet block defaults', () => {
  it('includes the media and analysis block types with sensible defaults', () => {
    expect(getDefaultBlockConfig('checklist', 1)).toMatchObject({
      options: ['Option 1', 'Option 2'],
    })
    expect(getDefaultBlockConfig('ranking', 1)).toMatchObject({
      options: ['Option 1', 'Option 2', 'Option 3'],
    })
    expect(getDefaultBlockConfig('matrix', 1)).toMatchObject({
      rows: ['Criteria 1', 'Criteria 2', 'Criteria 3'],
      min: 1,
      max: 5,
    })
    expect(getDefaultBlockConfig('imagePrompt', 1)).toMatchObject({
      imageUrl: expect.any(String),
      altText: 'Worksheet image prompt',
      imageFit: 'contain',
      imageSize: 'large',
    })
    expect(getDefaultBlockConfig('video', 1)).toMatchObject({
      videoUrl: expect.any(String),
      altText: 'Video prompt',
    })
    expect(getDefaultBlockConfig('youtube', 1)).toMatchObject({
      videoUrl: expect.stringContaining('youtube.com'),
      altText: 'YouTube video prompt',
    })
    expect(getDefaultBlockConfig('multipleChoice', 1)).toMatchObject({
      question: 'Which answer is correct?',
      options: ['Option A', 'Option B', 'Option C'],
      correctAnswer: 'Option A',
      multipleAnswers: false,
      showFeedback: true,
      points: 1,
    })
    expect(getDefaultBlockConfig('trueFalse', 1)).toMatchObject({
      question: 'Is this statement true?',
      correctAnswer: true,
      showFeedback: true,
      points: 1,
    })
    expect(getDefaultBlockConfig('shortAnswer', 1)).toMatchObject({
      question: 'Provide the correct term or phrase.',
      correctAnswer: 'answer',
      showFeedback: true,
      points: 1,
    })
    expect(getDefaultBlockConfig('matching', 1)).toMatchObject({
      pairs: expect.arrayContaining([
        expect.objectContaining({ prompt: 'Photosynthesis' }),
      ]),
      showFeedback: true,
      points: 1,
    })
    expect(getDefaultBlockConfig('fillBlank', 1)).toMatchObject({
      question: 'The capital of France is ______.',
      correctAnswer: 'Paris',
      showFeedback: true,
      points: 1,
    })
    expect(getDefaultBlockConfig('section', 1)).toMatchObject({
      title: 'Section heading',
    })
    expect(getDefaultBlockConfig('randomizer', 1)).toMatchObject({
      prompt: 'Generate a random item from this list.',
      items: ['Item 1', 'Item 2', 'Item 3'],
      shuffle: true,
      requireFirstGeneration: false,
      displayStyle: 'word-flicker',
      animationDurationMs: 1800,
    })
    expect(getDefaultBlockConfig('richText', 1)).toMatchObject({
      placeholder: 'Write and format your response here.',
      mode: 'response',
      contentHtml: '<p>Add rich text information for students here.</p>',
    })
    expect(getDefaultBlockConfig('url', 1)).toMatchObject({
      url: 'https://example.com',
      buttonText: 'Open link',
      audience: 'student',
    })
  })
})

describe('conditional visibility', () => {
  const definition = {
    id: 'branching', version: 1, title: 'Branching', description: '',
    settings: { navigation: 'sequential', allowPageJumping: false, autosave: true, showProgress: true, exports: { json: true, pdf: true } },
    pages: [
      { id: 'choice', title: 'Choose', blocks: [{ id: 'lms', type: 'singleSelect', label: 'Choose an LMS', config: { options: ['Teams', 'Moodle'] } }] },
      { id: 'teams', title: 'Teams', condition: { blockId: 'lms', operator: 'equals', value: 'Teams' }, blocks: [
        { id: 'teams-info', type: 'content', condition: { blockId: 'lms', operator: 'equals', value: 'Teams' } },
        { id: 'hidden-required', type: 'shortText', required: true, condition: { blockId: 'lms', operator: 'equals', value: 'Moodle' } },
      ] },
      { id: 'finish', title: 'Finish', blocks: [] },
    ],
  } as any

  it('updates page and block visibility when an earlier answer changes', () => {
    expect(getVisiblePages(definition, { lms: 'Teams' }).map((page) => page.id)).toEqual(['choice', 'teams', 'finish'])
    expect(getVisiblePages(definition, { lms: 'Moodle' }).map((page) => page.id)).toEqual(['choice', 'finish'])
    expect(getVisibleBlocks(definition.pages[1], { lms: 'Teams' }).map((block) => block.id)).toEqual(['teams-info'])
    expect(getVisibleBlocks(definition.pages[1], { lms: 'Moodle' }).map((block) => block.id)).toEqual(['hidden-required'])
  })

  it('supports equals, not equals, contains and does not contain', () => {
    expect(isConditionMet({ blockId: 'choice', operator: 'equals', value: 'Teams' }, { choice: 'teams' })).toBe(true)
    expect(isConditionMet({ blockId: 'choice', operator: 'notEquals', value: 'Moodle' }, { choice: 'Teams' })).toBe(true)
    expect(isConditionMet({ blockId: 'choice', operator: 'contains', value: 'Teams' }, { choice: ['Teams', 'Moodle'] })).toBe(true)
    expect(isConditionMet({ blockId: 'choice', operator: 'notContains', value: 'Canvas' }, { choice: ['Teams'] })).toBe(true)
  })

  it('ignores hidden required blocks and skips hidden pages in navigation and progress inputs', () => {
    expect(getMissingRequiredBlocks(definition.pages[1], { lms: 'Teams' })).toHaveLength(0)
    expect(getAdjacentVisiblePageIndex(definition, { lms: 'Moodle' }, 0, 1)).toBe(2)
    expect(getAdjacentVisiblePageIndex(definition, { lms: 'Moodle' }, 2, -1)).toBe(0)
    expect(getVisiblePages(definition, { lms: 'Moodle' })).toHaveLength(2)
  })

  it('only allows skipping ahead when free navigation and page jumping are both enabled', () => {
    expect(canNavigateToVisiblePage({ navigation: 'sequential', allowPageJumping: false }, 0, 2)).toBe(false)
    expect(canNavigateToVisiblePage({ navigation: 'free', allowPageJumping: false }, 0, 2)).toBe(false)
    expect(canNavigateToVisiblePage({ navigation: 'sequential', allowPageJumping: true }, 0, 2)).toBe(false)
    expect(canNavigateToVisiblePage({ navigation: 'free', allowPageJumping: true }, 0, 2)).toBe(true)
    expect(canNavigateToVisiblePage({ navigation: 'sequential', allowPageJumping: false }, 2, 0)).toBe(true)
    expect(canNavigateToVisiblePage({ navigation: 'sequential', allowPageJumping: false }, 0, 1)).toBe(true)
  })

  it('preserves conditions through JSON serialization', () => {
    const restored = JSON.parse(JSON.stringify(definition))
    expect(restored.pages[1].condition).toEqual({ blockId: 'lms', operator: 'equals', value: 'Teams' })
    expect(restored.pages[1].blocks[0].condition).toEqual({ blockId: 'lms', operator: 'equals', value: 'Teams' })
  })
})

describe('image prompt display configuration', () => {
  it('defaults existing image prompts safely to contain and large', () => {
    expect(getImageDisplayConfig({ id: 'image', type: 'imagePrompt', config: { imageUrl: '/diagram.png' } })).toEqual({ imageFit: 'contain', imageSize: 'large' })
  })

  it('preserves configured fit and size through serialization', () => {
    const block = { id: 'image', type: 'imagePrompt', config: { imageFit: 'cover', imageSize: 'medium' } } as any
    const restored = JSON.parse(JSON.stringify(block))
    expect(getImageDisplayConfig(restored)).toEqual({ imageFit: 'cover', imageSize: 'medium' })
  })
})

describe('visual thinking blocks', () => {
  it('creates continuum defaults and requires intentional completion plus configured rationale', () => {
    const config = getDefaultBlockConfig('continuum', 10)
    expect(config).toMatchObject({ leftLabel: 'Low', rightLabel: 'High', defaultValue: 50 })
    const block = { id: 'continuum', type: 'continuum', required: true, config: { ...config, rationaleRequired: true } } as any
    expect(isRequiredBlockSatisfied(block, {})).toBe(false)
    expect(isRequiredBlockSatisfied(block, { continuum: { rationale: 'Not positioned yet.' } })).toBe(false)
    expect(isRequiredBlockSatisfied(block, { continuum: { position: 50 } })).toBe(false)
    expect(isRequiredBlockSatisfied(block, { continuum: { position: 50, rationale: 'Evidence.' } })).toBe(true)
  })

  it('updates a continuum value through its accessible range control', () => {
    const update = vi.fn()
    render(renderBlock({ id: 'continuum', type: 'continuum', label: 'Confidence', config: getDefaultBlockConfig('continuum', 1) }, {}, update))
    const range = screen.getByRole('slider', { name: 'Confidence' })
    expect(range.getAttribute('min')).toBe('0')
    expect(range.getAttribute('max')).toBe('100')
    fireEvent.change(range, { target: { value: '72' } })
    expect(update).toHaveBeenCalledWith('continuum', { position: 72 })
  })

  it('requires every stable-ID decision matrix cell and aggregates valid ratings', () => {
    const config = getDefaultBlockConfig('decisionMatrix', 20) as any
    const block = { id: 'decision', type: 'decisionMatrix', required: true, config } as any
    const complete = Object.fromEntries(config.options.map((option: any) => [option.id, Object.fromEntries(config.criteria.map((criterion: any) => [criterion.id, 4]))]))
    expect(isRequiredBlockSatisfied(block, { decision: { [config.options[0].id]: { [config.criteria[0].id]: 4 } } })).toBe(false)
    expect(isRequiredBlockSatisfied(block, { decision: complete })).toBe(true)
    const responses = [complete, complete].map((matrix, index) => ({ responseSchema: 'interactive-worksheet-response', schemaVersion: 1, worksheetId: 'w', worksheetVersion: 1, responseId: String(index), createdAt: '', updatedAt: '', responses: { decision: matrix } })) as any
    const summary = aggregateDecisionMatrix(responses, 'decision', config.options, config.criteria)
    expect(summary[0].criteria[0]).toMatchObject({ average: 4, count: 2 })
  })

  it('renders all decision matrix cells and persists a selected rating', () => {
    const update = vi.fn()
    const config = getDefaultBlockConfig('decisionMatrix', 30)
    render(renderBlock({ id: 'decision', type: 'decisionMatrix', label: 'Compare', config }, {}, update))
    expect(screen.getAllByRole('radiogroup')).toHaveLength(4)
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(update).toHaveBeenCalled()
  })

  it('stores duplicate choice and checklist labels by stable option id', () => {
    const update = vi.fn()
    render(renderBlock({ id: 'choice', type: 'singleSelect', label: 'Choose', config: { options: [{ id: 'first', label: 'Agree' }, { id: 'second', label: 'Agree' }] } }, {}, update))
    fireEvent.click(screen.getAllByLabelText('Agree')[1])
    expect(update).toHaveBeenLastCalledWith('choice', 'second')

    update.mockClear()
    cleanup()
    render(renderBlock({ id: 'checks', type: 'checklist', label: 'Check', config: { options: [{ id: 'a', label: 'Same' }, { id: 'b', label: 'Same' }] } }, {}, update))
    fireEvent.click(screen.getAllByLabelText('Same')[1])
    expect(update).toHaveBeenLastCalledWith('checks', ['b'])
  })

  it('stores duplicate categorize, matrix, and radar labels by stable ids', () => {
    const update = vi.fn()
    render(renderBlock({ id: 'cat', type: 'categorize', label: 'Sort', config: { items: [{ id: 'item-a', label: 'Repeat' }, { id: 'item-b', label: 'Repeat' }], categories: ['One'] } }, {}, update))
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'One' } })
    expect(update).toHaveBeenLastCalledWith('cat', { 'item-a': '', 'item-b': 'One' })

    update.mockClear()
    cleanup()
    const { container } = render(renderBlock({ id: 'matrix', type: 'matrix', label: 'Rate', config: { rows: [{ id: 'row-a', label: 'Repeat' }, { id: 'row-b', label: 'Repeat' }], min: 1, max: 5 } }, {}, update))
    fireEvent.change(container.querySelectorAll('input[type="range"]')[1], { target: { value: '4' } })
    expect(update).toHaveBeenLastCalledWith('matrix', { 'row-b': 4 })

    update.mockClear()
    cleanup()
    render(renderBlock({ id: 'radar', type: 'radar', label: 'Radar', config: { dimensions: [{ id: 'dim-a', label: 'Repeat' }, { id: 'dim-b', label: 'Repeat' }] } }, {}, update))
    fireEvent.change(screen.getAllByRole('slider')[1], { target: { value: '8' } })
    expect(update).toHaveBeenLastCalledWith('radar', { 'dim-b': 8 })
  })

  it('reconciles ranking responses against the configured options', () => {
    const options = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]

    expect(reconcileRankingResponse(options, ['B', 'removed', 'a']).map((item) => item.id)).toEqual(['b', 'a', 'c'])
    expect(isRequiredBlockSatisfied({ id: 'rank', type: 'ranking', required: true, config: { options } } as any, {})).toBe(false)
    expect(isRequiredBlockSatisfied({ id: 'rank', type: 'ranking', required: true, config: { options } } as any, { rank: ['b'] })).toBe(true)

    const update = vi.fn()
    render(renderBlock({ id: 'rank', type: 'ranking', label: 'Rank', required: true, config: { options } }, {}, update, { showRequiredError: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep this order' }))
    expect(update).toHaveBeenLastCalledWith('rank', ['a', 'b', 'c'])
    expect(screen.getByText('Rank the items or choose “Keep this order” to continue.')).toBeTruthy()
  })

  it('drops stale categorize assignments from saved and exported responses', () => {
    const block = { id: 'cat', type: 'categorize', config: { items: [{ id: 'keep', label: 'Keep' }, { id: 'new', label: 'New' }], categories: ['One'] } } as any
    expect(reconcileCategorizeResponse(block, { old: 'Two', Keep: 'One', new: 'Removed' })).toEqual({ keep: 'One', new: '' })
    expect(reconcileWorksheetResponses({ pages: [{ blocks: [block] }] } as any, { cat: { old: 'One', keep: 'One' } })).toEqual({ cat: { keep: 'One', new: '' } })
  })

  it('falls back to stable decision matrix ids when imported cells lack ids', () => {
    const update = vi.fn()
    render(renderBlock({ id: 'decision', type: 'decisionMatrix', label: 'Compare', config: { options: [{ label: 'Option' }, { label: 'Option' }], criteria: [{ label: 'Cost' }, { label: 'Cost' }], min: 1, max: 2 } }, {}, update))
    fireEvent.click(screen.getAllByRole('radio')[7])
    expect(update).toHaveBeenLastCalledWith('decision', { 'option-2': { 'criterion-2': 2 } })
  })

  it('builds every board preset and validates meaningful entries', () => {
    expect(getBoardPresetColumns('pmi').map((column) => column.label)).toEqual(['Plus', 'Minus', 'Interesting'])
    expect(getBoardPresetColumns('kwl').map((column) => column.label)).toEqual(['Know', 'Want to know', 'Learned'])
    expect(getBoardPresetColumns('start-stop-continue').map((column) => column.label)).toEqual(['Start', 'Stop', 'Continue'])
    expect(getBoardPresetColumns('pros-cons').map((column) => column.label)).toEqual(['Pros', 'Cons'])
    expect(getBoardPresetColumns('rose-bud-thorn').map((column) => column.label)).toEqual(['Rose', 'Bud', 'Thorn'])
    expect(getBoardPresetColumns('what-so-what-now-what').map((column) => column.label)).toEqual(['What?', 'So What?', 'Now What?'])
    const block = { id: 'board', type: 'board', required: true, config: getDefaultBlockConfig('board', 40) } as any
    expect(isRequiredBlockSatisfied(block, {})).toBe(false)
    expect(isRequiredBlockSatisfied(block, { board: { anything: [{ id: 'entry', text: 'An idea' }] } })).toBe(true)
  })

  it('adds, edits, and deletes stable-ID board entries', () => {
    const update = vi.fn()
    const config = { columns: [{ id: 'plus', label: 'Plus' }], allowMultipleEntries: true, placeholder: 'Idea' }
    const { rerender } = render(renderBlock({ id: 'board', type: 'board', label: 'PMI', config }, {}, update))
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    const added = update.mock.calls[0][1]
    expect(added.plus[0].id).toMatch(/^board-entry-/)
    rerender(renderBlock({ id: 'board', type: 'board', label: 'PMI', config }, { board: added }, update))
    fireEvent.change(screen.getByPlaceholderText('Idea'), { target: { value: 'Useful' } })
    expect(update.mock.calls.at(-1)?.[1].plus[0].text).toBe('Useful')
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry from Plus' }))
    expect(update.mock.calls.at(-1)?.[1].plus).toEqual([])
  })

  it('calculates continuum mean and median', () => {
    const responses = [10, 40, 90].map((position, index) => ({ responseSchema: 'interactive-worksheet-response', schemaVersion: 1, worksheetId: 'w', worksheetVersion: 1, responseId: String(index), createdAt: '', updatedAt: '', responses: { continuum: { position } } })) as any
    expect(aggregateContinuum(responses, 'continuum')).toMatchObject({ count: 3, mean: 140 / 3, median: 40 })
  })

  it('preserves all visual-thinking configuration through JSON serialization', () => {
    for (const type of ['continuum', 'decisionMatrix', 'board']) {
      const block = { id: type, type, config: getDefaultBlockConfig(type, 50) }
      expect(JSON.parse(JSON.stringify(block))).toEqual(block)
    }
  })
})

describe('worksheet page timer defaults', () => {
  it('keeps page timers optional and off by default', () => {
    const timer = getDefaultPageTimer()

    expect(timer).toMatchObject({
      enabled: false,
      durationSeconds: 300,
      behaviour: 'advisory',
    })
  })
})

describe('student synthesis summary', () => {
  it('creates an evidence-based synthesis without claiming a lone group is strongest', () => {
    const synthesis = buildStudentSynthesis([
      { key: 'diffit', label: 'Diffit', responses: [
        { responses: { 'radar-eval': { 'Ease of use': 9, 'Pedagogical value': 8, 'Reliability': 7 } } },
        { responses: { 'radar-eval': { 'Ease of use': 8, 'Pedagogical value': 7, 'Reliability': 8 } } },
      ] as any },
    ])

    expect(synthesis.headline).toBe('Class response overview')
    expect(synthesis.summary).toContain('2 submitted responses')
    expect(synthesis.topGroup).toBe('')
    expect(synthesis.highlights.length).toBeGreaterThan(0)
    expect(synthesis.highlights[0]).toContain('highest recorded radar average')
    expect(synthesis.recommendations).toEqual([])
  })

  it('omits unsupported insights when responses contain no measurable aggregate', () => {
    const synthesis = buildStudentSynthesis([{ key: 'all-responses', label: 'All responses', responses: [{ responses: { notes: 'A reflection' } }] as any }])
    expect(synthesis.headline).toBe('Class response overview')
    expect(synthesis.highlights).toEqual([])
    expect(synthesis.summary).not.toContain('strongest')
  })
})

describe('worksheet quiz summary', () => {
  it('calculates score totals across quiz blocks in the worksheet', () => {
    const definition = {
      id: 'quiz-test',
      version: 1,
      title: 'Quiz test',
      description: 'A short quiz',
      settings: {
        navigation: 'sequential',
        allowPageJumping: false,
        autosave: true,
        showProgress: true,
        exports: { json: true, pdf: true },
      },
      pages: [
        {
          id: 'page-1',
          title: 'Quiz page',
          blocks: [
            {
              id: 'q-1',
              type: 'multipleChoice',
              label: 'First question',
              config: { question: 'A?', options: ['A', 'B'], correctAnswer: 'A', points: 2 },
            },
            {
              id: 'q-2',
              type: 'multipleChoice',
              label: 'Second question',
              config: { question: 'B?', options: ['A', 'B'], correctAnswer: 'B', points: 3 },
            },
          ],
        },
      ],
    } as any

    const summary = getQuizSummary(definition, { 'q-1': 'A', 'q-2': 'A' })

    expect(summary.totalQuestions).toBe(2)
    expect(summary.totalScore).toBe(2)
    expect(summary.totalMax).toBe(5)
    expect(summary.percent).toBeCloseTo(40)
    expect(summary.items[0].isCorrect).toBe(true)
    expect(summary.items[1].isCorrect).toBe(false)
  })

  it('scores matching pairs without ids using the rendered pair keys', () => {
    const definition = {
      id: 'matching-test',
      version: 1,
      title: 'Matching test',
      description: 'A matching quiz',
      settings: {
        navigation: 'sequential',
        allowPageJumping: false,
        autosave: true,
        showProgress: true,
        exports: { json: true, pdf: true },
      },
      pages: [
        {
          id: 'page-1',
          title: 'Quiz page',
          blocks: [
            {
              id: 'matching-1',
              type: 'matching',
              label: 'Match the terms',
              config: {
                pairs: [
                  { prompt: 'Photosynthesis', answer: 'Light energy' },
                  { prompt: 'Mitochondria', answer: 'Cellular respiration' },
                ],
                options: ['Light energy', 'Cellular respiration'],
                points: 4,
              },
            },
          ],
        },
      ],
    } as any

    const summary = getQuizSummary(definition, {
      'matching-1': {
        'Photosynthesis-0': 'Light energy',
        'Mitochondria-1': 'Cellular respiration',
      },
    })

    expect(summary.totalScore).toBe(4)
    expect(summary.percent).toBe(100)
    expect(summary.items[0].isCorrect).toBe(true)
  })

  it('does not round partial quiz scores up to 100 percent', () => {
    expect(formatQuizPercent(99.5)).toBe('99')
    expect(formatQuizPercent(100)).toBe('100')
  })

  it('uses the edited fill-in-the-blank answer after clearing imported alternatives', () => {
    const importedConfig = { correctAnswer: 'Paris', answers: ['Paris', 'PARIS'] as string[] | undefined }
    const editedConfig = {
      ...importedConfig,
      ...getFillBlankCorrectAnswerPatch('Lyon'),
    }
    const definition = {
      id: 'fill-blank-test',
      version: 1,
      title: 'Fill blank test',
      description: 'A fill-in-the-blank quiz',
      settings: {
        navigation: 'sequential',
        allowPageJumping: false,
        autosave: true,
        showProgress: true,
        exports: { json: true, pdf: true },
      },
      pages: [
        {
          id: 'page-1',
          title: 'Quiz page',
          blocks: [
            {
              id: 'capital',
              type: 'fillBlank',
              label: 'Capital',
              config: {
                question: 'The capital of France is ______.',
                ...editedConfig,
                points: 1,
              },
            },
          ],
        },
      ],
    } as any

    const summary = getQuizSummary(definition, { capital: 'Lyon' })
    const oldAnswerSummary = getQuizSummary(definition, { capital: 'Paris' })

    expect(editedConfig.answers).toBeUndefined()
    expect(summary.totalScore).toBe(1)
    expect(summary.items[0].isCorrect).toBe(true)
    expect(oldAnswerSummary.items[0].isCorrect).toBe(false)
  })
})

describe('stored worksheet sessions', () => {
  it('persists the response creation timestamp with the draft', () => {
    const session = {
      responseId: 'response-1',
      createdAt: '2026-01-01T10:00:00.000Z',
      pageIndex: 1,
      responses: { notes: 'Saved answer' },
      updatedAt: '2026-01-01T10:05:00.000Z',
    }

    saveSession(session, 'worksheet-1', 1, session.responseId)

    expect(loadSession('worksheet-1', 1, session.responseId)).toEqual(session)
    expect(getStoredSessionCreatedAt(session, 'fallback')).toBe(session.createdAt)
  })

  it('uses an older draft update timestamp when no creation timestamp was stored', () => {
    expect(getStoredSessionCreatedAt({ updatedAt: '2026-01-02T10:05:00.000Z' }, 'fallback')).toBe('2026-01-02T10:05:00.000Z')
    expect(getStoredSessionCreatedAt(null, 'fallback')).toBe('fallback')
  })
})

describe('required page completion', () => {
  it('finds missing required blocks across every visible page before completion', () => {
    const definition = {
      id: 'multi-page-required',
      version: 1,
      title: 'Multi-page required',
      description: '',
      settings: {
        navigation: 'sequential',
        allowPageJumping: false,
        autosave: true,
        showProgress: true,
        exports: { json: true, pdf: true },
      },
      pages: [
        {
          id: 'page-1',
          title: 'Page 1',
          blocks: [{ id: 'name', type: 'shortText', label: 'Name', required: true }],
        },
        {
          id: 'page-2',
          title: 'Page 2',
          blocks: [{ id: 'reflection', type: 'longText', label: 'Reflection', required: true }],
        },
        {
          id: 'page-3',
          title: 'Page 3',
          blocks: [{ id: 'confirm', type: 'singleSelect', label: 'Confirm', required: true, config: { options: ['Yes'] } }],
        },
        {
          id: 'hidden',
          title: 'Hidden',
          condition: { blockId: 'confirm', operator: 'equals', value: 'No' },
          blocks: [{ id: 'hidden-required', type: 'shortText', label: 'Hidden', required: true }],
        },
      ],
    } as any

    expect(getMissingRequiredBlockLocations(definition, { name: 'Learner', confirm: 'Yes' }).map((location) => ({
      pageIndex: location.pageIndex,
      blockId: location.block.id,
    }))).toEqual([{ pageIndex: 1, blockId: 'reflection' }])
  })

  it('renders an idle randomizer without triggering a nested update loop', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      render(renderBlock({
        id: 'tool-spin',
        type: 'randomizer',
        label: 'Spin for a tool',
        config: { items: ['Diffit', 'NotebookLM'], displayStyle: 'word-flicker' },
      } as any, {}, vi.fn()))

      expect(screen.getByText('Click Generate to start')).toBeTruthy()
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('Maximum update depth exceeded'))
    } finally {
      consoleError.mockRestore()
    }
  })

  it('treats required response blocks as incomplete until they have meaningful values', () => {
    const page = {
      id: 'page-1',
      title: 'Required page',
      blocks: [
        {
          id: 'group-name',
          type: 'shortText',
          label: 'Group name',
          required: true,
        },
        {
          id: 'tool-spin',
          type: 'randomizer',
          label: 'Spin for a tool',
          required: true,
          config: { items: ['Diffit', 'NotebookLM'] },
        },
        {
          id: 'notes',
          type: 'longText',
          label: 'Notes',
          required: false,
        },
      ],
    } as any

    expect(isRequiredBlockSatisfied(page.blocks[0], {})).toBe(false)
    expect(isRequiredBlockSatisfied(page.blocks[1], {})).toBe(false)
    expect(getMissingRequiredBlocks(page, {})).toHaveLength(2)

    const partialResponses = { 'group-name': 'Group 1' }
    expect(isRequiredBlockSatisfied(page.blocks[0], partialResponses)).toBe(true)
    expect(getMissingRequiredBlocks(page, partialResponses).map((block) => block.id)).toEqual(['tool-spin'])

    const completeResponses = { 'group-name': 'Group 1', 'tool-spin': 'Diffit' }
    expect(isRequiredBlockSatisfied(page.blocks[1], completeResponses)).toBe(true)
    expect(getMissingRequiredBlocks(page, completeResponses)).toHaveLength(0)
  })

  it('uses block-specific completeness rules for structured required responses', () => {
    const page = {
      id: 'page-2',
      title: 'Structured required page',
      blocks: [
        {
          id: 'rating',
          type: 'rating',
          label: 'Confidence',
          required: true,
          config: { min: 1, max: 5, defaultValue: 3 },
        },
        {
          id: 'matrix',
          type: 'matrix',
          label: 'Criteria ratings',
          required: true,
          config: { rows: ['Clarity', 'Accuracy'], min: 1, max: 5, defaultValue: 2 },
        },
        {
          id: 'radar',
          type: 'radar',
          label: 'Tool profile',
          required: true,
          config: { dimensions: ['Ease', 'Impact'] },
        },
        {
          id: 'quadrant',
          type: 'quadrant',
          label: 'Positioning',
          required: true,
          config: { rationaleRequired: true },
        },
        {
          id: 'swot',
          type: 'swot',
          label: 'SWOT',
          required: true,
          config: { categories: [{ id: 'strengths', label: 'Strengths' }] },
        },
      ],
    } as any

    expect(getMissingRequiredBlocks(page, {}).map((block) => block.id)).toEqual(['rating', 'matrix', 'radar', 'quadrant', 'swot'])

    const responses = {
      rating: 3,
      matrix: { Clarity: 2, Accuracy: 4 },
      radar: { Ease: 5, Impact: 7 },
      quadrant: { x: 60, y: 40, rationale: 'Useful but risky.' },
      swot: { strengths: [{ id: 'note-1', text: 'Clear outputs' }] },
    }

    expect(isRequiredBlockSatisfied(page.blocks[0], responses)).toBe(true)
    expect(isRequiredBlockSatisfied(page.blocks[1], responses)).toBe(true)
    expect(isRequiredBlockSatisfied(page.blocks[2], responses)).toBe(true)
    expect(isRequiredBlockSatisfied(page.blocks[3], responses)).toBe(true)
    expect(isRequiredBlockSatisfied(page.blocks[4], responses)).toBe(true)
    expect(getMissingRequiredBlocks(page, responses)).toHaveLength(0)
  })
})
