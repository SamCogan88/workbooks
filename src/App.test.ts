// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, Fragment, useState } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ModalOverlay, OnlineJoinPageRoute, QuadrantMiniChart, renderBlock } from './App'
import { getPublishCardState } from './lib/builderPublishState'
import { aggregateContinuum, aggregateDecisionMatrix, buildStudentSynthesis } from './lib/aggregation'
import { createBuilderId } from './lib/builderIds'
import { clearConditionsReferencingBlocks, getFirstConditionOrderViolation, remapBlockConditions } from './lib/conditionIntegrity'
import { updateBlockConfigWithOptionReferences } from './lib/optionReferenceIntegrity'
import { isResponseJsonExportEnabled, isResponsePdfExportEnabled, shouldAutosaveOnlineResponse } from './lib/worksheetSettings'
import { loadPublishedWorksheet } from './lib/onlineRepository'
import { getStoredSessionCreatedAt, loadSession, saveSession } from './lib/storage'
import { addMatchingPairConfig, canNavigateToVisiblePage, formatQuizPercent, getAdjacentVisiblePageIndex, getBoardPresetColumns, getConditionOptions, getDefaultBlockConfig, getDefaultPageTimer, getFillBlankCorrectAnswerPatch, getImageDisplayConfig, getMissingRequiredBlockLocations, getMissingRequiredBlocks, getQuizSummary, getUnanswerableRequiredBlocks, getVisibleBlocks, getVisiblePages, getVisiblePagesWithBlocks, getWorksheetResponseImportError, hasMeaningfulResponseValue, isConditionMet, isConditionSourceBlock, isRequiredBlockSatisfied, isWorksheetDefinition, normalizeRichTextResponse, reconcileCategorizeResponse, reconcileRankingResponse, reconcileWorksheetResponses, reorderBlocks, sanitizeWorksheetDefinition } from './lib/worksheetLogic'

vi.mock('./lib/onlineRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/onlineRepository')>()
  return {
    ...actual,
    loadPublishedWorksheet: vi.fn(),
  }
})

const mockedLoadPublishedWorksheet = vi.mocked(loadPublishedWorksheet)

function workbook(publicCode: string, title: string) {
  return {
    id: `worksheet-${publicCode.toLowerCase()}`,
    public_code: publicCode,
    definition: {
      id: `definition-${publicCode.toLowerCase()}`,
      version: 1,
      title,
      description: '',
      settings: {
        navigation: 'sequential',
        allowPageJumping: false,
        autosave: false,
        showProgress: true,
        exports: { json: true, pdf: true },
      },
      pages: [{ id: 'page-1', title: 'Page 1', blocks: [] }],
    },
  } as any
}

function JoinRouteHarness() {
  const navigate = useNavigate()
  return createElement(
    Fragment,
    null,
    createElement('button', { type: 'button', onClick: () => navigate('/join/CODE2') }, 'Open CODE2'),
    createElement(Routes, null, createElement(Route, { path: '/join/:publicCode', element: createElement(OnlineJoinPageRoute) })),
  )
}

describe('online workbook join routing', () => {
  it('clears the previous workbook when the join code changes in the same tab', async () => {
    mockedLoadPublishedWorksheet.mockImplementation((publicCode: string) => {
      if (publicCode === 'CODE1') return Promise.resolve(workbook('CODE1', 'First workbook'))
      return Promise.reject(new Error('not found'))
    })

    render(createElement(
      MemoryRouter,
      { initialEntries: ['/join/CODE1'] },
      createElement(JoinRouteHarness),
    ))

    expect(await screen.findByRole('heading', { name: 'First workbook' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open CODE2' }))

    expect((await screen.findByRole('alert')).textContent).toContain('We could not find a published workbook with that code.')
    expect(screen.queryByRole('heading', { name: 'First workbook' })).toBeNull()

    await waitFor(() => expect(mockedLoadPublishedWorksheet).toHaveBeenLastCalledWith('CODE2'))
  })
})

describe('modal overlay accessibility', () => {
  it('traps focus, makes siblings inert, closes with Escape and restores focus', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Open dialog'),
        createElement(ModalOverlay, { isOpen: open, onClose: () => setOpen(false), labelledBy: 'test-dialog-title' },
          createElement('div', null,
            createElement('h2', { id: 'test-dialog-title' }, 'Test dialog'),
            createElement('button', { type: 'button' }, 'First action'),
            createElement('button', { type: 'button', 'data-modal-initial-focus': true }, 'Close dialog'),
          ),
        ),
      )
    }

    render(createElement(Harness))
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    trigger.focus()
    fireEvent.click(trigger)

    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toBeTruthy()
    expect(trigger.getAttribute('inert')).toBe('')
    expect(trigger.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }))

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First action' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Test dialog' })).toBeNull()
    expect(trigger.getAttribute('inert')).toBeNull()
    expect(trigger.getAttribute('aria-hidden')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('worksheet block defaults', () => {
  it('rejects imported responses for a different worksheet version', () => {
    const definition = { id: 'worksheet-a', version: 2 } as any
    const response = {
      responseSchema: 'interactive-worksheet-response',
      worksheetId: 'worksheet-a',
      worksheetVersion: 1,
    } as any

    expect(getWorksheetResponseImportError(definition, response)).toBe('worksheet version must match 2.')
    expect(getWorksheetResponseImportError(definition, { ...response, worksheetVersion: 2 })).toBe('')
  })

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
    expect(getDefaultBlockConfig('verdict', 1)).toMatchObject({
      options: ['Recommend', 'Use with caution', 'Do not recommend'],
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
    expect((getDefaultBlockConfig('radar', 1).dimensions as unknown[])).toHaveLength(3)
  })

  it('keeps new matching pairs answerable from the choices list', () => {
    expect(addMatchingPairConfig({ pairs: [], options: ['Existing'] }, 42)).toMatchObject({
      pairs: [{ id: 'pair-42', prompt: 'New prompt', answer: 'Match 1' }],
      options: ['Existing', 'Match 1'],
    })
  })
})

describe('quadrant summary chart', () => {
  it('renders configured axis labels', () => {
    render(createElement(QuadrantMiniChart, {
      x: 52,
      y: 74,
      xLeft: 'Cost',
      xRight: 'Impact',
      yBottom: 'Lower confidence',
      yTop: 'Higher confidence',
    }))

    expect(screen.getByText('Cost')).toBeTruthy()
    expect(screen.getByText('Impact')).toBeTruthy()
    expect(screen.getByText('Lower confidence')).toBeTruthy()
    expect(screen.getByText('Higher confidence')).toBeTruthy()
  })
})

describe('builder ids', () => {
  it('uses crypto UUIDs for new page and block identifiers', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')

    expect(createBuilderId('page')).toBe('page-11111111-1111-4111-8111-111111111111')
    expect(createBuilderId('block')).toBe('block-22222222-2222-4222-8222-222222222222')
    expect(randomUUID).toHaveBeenCalledTimes(2)

    randomUUID.mockRestore()
  })
})

describe('builder publish card state', () => {
  const workbook = { id: 'online-1', title: 'Published title', public_code: 'ABC123' } as any

  it('marks a published workbook stale after definition edits', () => {
    const publishedDefinition = JSON.stringify({ title: 'Published title', pages: [{ id: 'page-1' }] })
    const editedDefinition = JSON.stringify({ title: 'Edited title', pages: [{ id: 'page-1' }] })

    expect(getPublishCardState('', workbook, publishedDefinition, publishedDefinition)).toBe('published')
    expect(getPublishCardState('', workbook, publishedDefinition, editedDefinition)).toBe('unpublished')
  })

  it('shows current publish errors once the previous result is cleared', () => {
    const currentDefinition = JSON.stringify({ title: '', pages: [{ id: 'page-1' }] })
    expect(getPublishCardState('Add a title and at least one page before publishing.', null, null, currentDefinition)).toBe('error')
  })
})

describe('worksheet settings', () => {
  const baseDefinition = {
    id: 'settings-test',
    version: 1,
    title: 'Settings test',
    description: '',
    settings: {
      navigation: 'sequential',
      allowPageJumping: false,
      autosave: true,
      showProgress: true,
      exports: { json: true, pdf: true },
    },
    pages: [],
  } as any

  it('honours disabled response export formats', () => {
    const definition = {
      ...baseDefinition,
      settings: { ...baseDefinition.settings, exports: { json: false, pdf: false } },
    }

    expect(isResponseJsonExportEnabled(definition)).toBe(false)
    expect(isResponsePdfExportEnabled(definition)).toBe(false)
  })

  it('keeps legacy response exports enabled when omitted', () => {
    const definition = {
      ...baseDefinition,
      settings: { ...baseDefinition.settings, exports: undefined },
    }

    expect(isResponseJsonExportEnabled(definition)).toBe(true)
    expect(isResponsePdfExportEnabled(definition)).toBe(true)
  })

  it('uses the worksheet autosave setting for online responses', () => {
    const definition = {
      ...baseDefinition,
      settings: { ...baseDefinition.settings, autosave: false },
    }

    expect(shouldAutosaveOnlineResponse(definition)).toBe(false)
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

  it('matches numeric and nested structured response values', () => {
    expect(isConditionMet({ blockId: 'score', operator: 'equals', value: 10 }, { score: 10 })).toBe(true)
    expect(isConditionMet({ blockId: 'score', operator: 'equals', value: '10' }, { score: 10 })).toBe(true)
    expect(isConditionMet({ blockId: 'matrix', operator: 'contains', value: 4 }, { matrix: { clarity: 3, accuracy: 4 } })).toBe(true)
    expect(isConditionMet({ blockId: 'board', operator: 'contains', value: 'risk' }, { board: { risks: [{ text: 'Schedule risk' }] } })).toBe(true)
  })

  it('maps configured condition labels to stable option ids', () => {
    const source = { id: 'lms', type: 'singleSelect', config: { options: [{ id: 'teams-id', label: 'Teams' }] } } as any
    expect(getConditionOptions(source)).toEqual([{ label: 'Teams', value: 'teams-id' }])
    expect(isConditionMet({ blockId: 'lms', operator: 'equals', value: 'Teams' }, { lms: 'teams-id' }, source)).toBe(true)
    const stableDefinition = { ...definition, pages: [{ id: 'choice', title: 'Choose', blocks: [source] }, definition.pages[1]] } as any
    expect(getVisiblePages(stableDefinition, { lms: 'teams-id' }).map((page) => page.id)).toEqual(['choice', 'teams'])
  })

  it('filters unsupported hotspot blocks from conditional sources', () => {
    expect(isConditionSourceBlock({ id: 'spot', type: 'hotspot' } as any)).toBe(false)
    expect(isConditionSourceBlock({ id: 'rating', type: 'rating' } as any)).toBe(true)
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

  it('returns only visible pages and blocks for exports', () => {
    const sections = getVisiblePagesWithBlocks(definition, { lms: 'Teams' })

    expect(sections.map(({ page }) => page.id)).toEqual(['choice', 'teams', 'finish'])
    expect(sections.find(({ page }) => page.id === 'teams')?.blocks.map((block) => block.id)).toEqual(['teams-info'])
  })

  it('preserves conditions through JSON serialization', () => {
    const restored = JSON.parse(JSON.stringify(definition))
    expect(restored.pages[1].condition).toEqual({ blockId: 'lms', operator: 'equals', value: 'Teams' })
    expect(restored.pages[1].blocks[0].condition).toEqual({ blockId: 'lms', operator: 'equals', value: 'Teams' })
  })

  it('clears page and block conditions that reference deleted blocks', () => {
    const cleaned = clearConditionsReferencingBlocks(definition, ['lms'])

    expect(cleaned.pages[1].condition).toBeUndefined()
    expect(cleaned.pages[1].blocks[0].condition).toBeUndefined()
    expect(cleaned.pages[1].blocks[1].condition).toBeUndefined()
  })

  it('remaps duplicated page block conditions to duplicated source blocks', () => {
    const blocks = remapBlockConditions([
      { id: 'copy-source', type: 'singleSelect' },
      { id: 'copy-dependent', type: 'content', condition: { blockId: 'source', operator: 'equals', value: 'Yes' } },
    ], { source: 'copy-source', dependent: 'copy-dependent' })

    expect(blocks[1].condition).toEqual({ blockId: 'copy-source', operator: 'equals', value: 'Yes' })
  })

  it('detects conditions moved before their source question', () => {
    const reordered = {
      ...definition,
      pages: [definition.pages[1], definition.pages[0], definition.pages[2]],
    }

    expect(getFirstConditionOrderViolation(reordered)).toMatchObject({
      kind: 'page',
      ownerId: 'teams',
      sourceBlockId: 'lms',
    })
  })
})

describe('builder option reference integrity', () => {
  const definition = {
    id: 'options-test',
    version: 1,
    title: 'Options test',
    description: '',
    settings: { navigation: 'sequential', allowPageJumping: false, autosave: true, showProgress: true, exports: { json: true, pdf: true } },
    pages: [
      {
        id: 'quiz',
        title: 'Quiz',
        blocks: [
          {
            id: 'question',
            type: 'multipleChoice',
            config: {
              options: ['Option A', 'Option B', 'Option C'],
              correctAnswer: 'Option A',
              multipleAnswers: false,
            },
          },
        ],
      },
      {
        id: 'branch',
        title: 'Branch',
        condition: { blockId: 'question', operator: 'equals', value: 'Option A' },
        blocks: [
          { id: 'follow-up', type: 'content', condition: { blockId: 'question', operator: 'equals', value: 'Option B' } },
        ],
      },
    ],
  } as any

  it('renames option references in answers and dependent conditions', () => {
    const updated = updateBlockConfigWithOptionReferences(definition, 'question', {
      options: ['Renamed A', 'Renamed B', 'Option C'],
    })

    expect(updated.pages[0]?.blocks[0]?.config?.correctAnswer).toBe('Renamed A')
    expect(updated.pages[1].condition?.value).toBe('Renamed A')
    expect(updated.pages[1]?.blocks[0]?.condition?.value).toBe('Renamed B')
  })

  it('clears references to removed options', () => {
    const updated = updateBlockConfigWithOptionReferences(definition, 'question', {
      options: ['Option B', 'Option C'],
    })

    expect(updated.pages[0]?.blocks[0]?.config?.correctAnswer).toBe('')
    expect(updated.pages[1].condition).toBeUndefined()
    expect(updated.pages[1]?.blocks[0]?.condition?.value).toBe('Option B')
  })

  it('keeps correct answer shape aligned with multiple answer mode', () => {
    const multiple = updateBlockConfigWithOptionReferences(definition, 'question', { multipleAnswers: true })
    expect(multiple.pages[0]?.blocks[0]?.config?.correctAnswer).toEqual(['Option A'])

    const single = updateBlockConfigWithOptionReferences(multiple, 'question', { multipleAnswers: false })
    expect(single.pages[0]?.blocks[0]?.config?.correctAnswer).toBe('Option A')
  })

  it('renames matching pair answers when choices change', () => {
    const matchingDefinition = {
      ...definition,
      pages: [{
        id: 'matching',
        title: 'Matching',
        blocks: [{
          id: 'match',
          type: 'matching',
          config: {
            options: ['Light energy', 'Cellular respiration'],
            pairs: [{ id: 'pair-1', prompt: 'Photosynthesis', answer: 'Light energy' }],
          },
        }],
      }],
    } as any

    const updated = updateBlockConfigWithOptionReferences(matchingDefinition, 'match', {
      options: ['Sunlight', 'Cellular respiration'],
    })

    expect(updated.pages[0]?.blocks[0]?.config?.pairs[0]?.answer).toBe('Sunlight')
  })
})

describe('builder block ordering', () => {
  const blocks = [
    { id: 'intro', type: 'content', title: 'Intro' },
    { id: 'question', type: 'shortText', label: 'Question' },
    { id: 'follow-up', type: 'longText', label: 'Follow up' },
  ] as any

  it('moves a block up using the shared insert-index reorder helper', () => {
    expect(reorderBlocks(blocks, 'question', 0).map((block) => block.id)).toEqual(['question', 'intro', 'follow-up'])
  })

  it('moves a block down using the same insert-index semantics as drag-and-drop', () => {
    expect(reorderBlocks(blocks, 'question', 3).map((block) => block.id)).toEqual(['intro', 'follow-up', 'question'])
  })

  it('returns the same list when a move would not change order', () => {
    expect(reorderBlocks(blocks, 'intro', 0)).toBe(blocks)
    expect(reorderBlocks(blocks, 'missing', 1)).toBe(blocks)
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
  it('names learner-facing sliders and matching controls from their prompts', () => {
    const update = vi.fn()

    render(createElement('div', null,
      renderBlock({ id: 'matrix', type: 'matrix', label: 'Evaluate criteria', config: { rows: ['Clarity', 'Accuracy'], min: 1, max: 5 } }, {}, update),
      renderBlock({ id: 'rating', type: 'rating', label: 'Overall confidence', config: { min: 0, max: 10, defaultValue: 5 } }, {}, update),
      renderBlock({ id: 'radar', type: 'radar', label: 'Tool profile', config: { dimensions: ['Ease', 'Impact'] } }, {}, update),
      renderBlock({ id: 'matching', type: 'matching', label: 'Match terms', config: { pairs: [{ id: 'term-a', prompt: 'Photosynthesis' }], options: ['Plants make food'] } }, {}, update),
    ))

    expect(screen.getByRole('slider', { name: 'Evaluate criteria: Clarity' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Evaluate criteria: Accuracy' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Overall confidence' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Tool profile: Ease' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Tool profile: Impact' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Match terms: Photosynthesis' })).toBeTruthy()
  })

  it('names rich text response editors from the block prompt', async () => {
    const update = vi.fn()

    render(renderBlock({ id: 'reflection', type: 'richText', label: 'Reflection', config: { mode: 'response' } }, {}, update))

    expect(await screen.findByRole('textbox', { name: 'Reflection' })).toBeTruthy()
  })

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

  it('places hotspot answers with the keyboard', () => {
    const update = vi.fn()
    render(renderBlock({ id: 'hotspot', type: 'hotspot', label: 'Find the valve', config: { imageUrl: '/diagram.png' } }, {}, update))

    const target = screen.getByRole('button', { name: 'Find the valve hotspot image' })
    target.focus()
    fireEvent.keyDown(target, { key: 'ArrowRight' })
    fireEvent.keyDown(target, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(target, { key: 'Enter' })

    expect(update).toHaveBeenCalledWith('hotspot', [{ x: 51, y: 60 }])
  })

  it('requires every stable-ID decision matrix cell and aggregates valid ratings', () => {
    const config = getDefaultBlockConfig('decisionMatrix', 20) as any
    const block = { id: 'decision', type: 'decisionMatrix', required: true, config } as any
    const complete = Object.fromEntries(config.options.map((option: any) => [option.id, Object.fromEntries(config.criteria.map((criterion: any) => [criterion.id, 4]))]))
    expect(isRequiredBlockSatisfied(block, { decision: { [config.options[0].id]: { [config.criteria[0].id]: 4 } } })).toBe(false)
    expect(isRequiredBlockSatisfied(block, { decision: { ...complete, [config.options[0].id]: { ...complete[config.options[0].id], [config.criteria[0].id]: 999 } } })).toBe(false)
    expect(isRequiredBlockSatisfied(block, { decision: complete })).toBe(true)
    const invalid = { ...complete, [config.options[0].id]: { ...complete[config.options[0].id], [config.criteria[0].id]: 999 } }
    const responses = [complete, invalid].map((matrix, index) => ({ responseSchema: 'interactive-worksheet-response', schemaVersion: 1, worksheetId: 'w', worksheetVersion: 1, responseId: String(index), createdAt: '', updatedAt: '', responses: { decision: matrix } })) as any
    const summary = aggregateDecisionMatrix(responses, 'decision', config.options, config.criteria)
    expect(summary[0].criteria[0]).toMatchObject({ average: 4, count: 1 })
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

describe('worksheet quiz summary numeric sanitization', () => {
  it('ignores invalid numeric answers and clamps quiz point values', () => {
    const definition = {
      pages: [{
        blocks: [
          { id: 'numeric', type: 'numeric', label: 'Estimate', config: { correctAnswer: '', points: -4 } },
          { id: 'quiz', type: 'quiz', label: 'Choice', config: { options: ['A'], correctAnswer: 'A', points: 'bad' } },
        ],
      }],
    } as any

    const sanitized = sanitizeWorksheetDefinition(definition)
    const summary = getQuizSummary(sanitized, { numeric: 0, quiz: 'A' })
    const numericConfig = sanitized.pages[0]?.blocks[0]?.config || {}

    expect(numericConfig.correctAnswer).toBeUndefined()
    expect(summary.items[0]).toMatchObject({ isCorrect: false, points: 0, achievedPoints: 0 })
    expect(summary.items[1]).toMatchObject({ isCorrect: true, points: 1, achievedPoints: 1 })
    expect(summary.totalMax).toBe(1)
  })
})

describe('builder numeric config sanitization', () => {
  it('rejects imported pages and blocks that would crash the builder', () => {
    expect(isWorksheetDefinition({
      id: 'missing-blocks',
      version: 1,
      title: 'Missing blocks',
      pages: [{ id: 'page-1', title: 'Page 1' }],
    })).toBe(false)

    expect(isWorksheetDefinition({
      id: 'bad-block',
      version: 1,
      title: 'Bad block',
      pages: [{ id: 'page-1', title: 'Page 1', blocks: [{ id: 'block-1', config: {} }] }],
    })).toBe(false)
  })

  it('normalizes imported option and true false config shapes', () => {
    const definition = {
      id: 'bad-config',
      version: 1,
      title: 'Bad config',
      description: '',
      settings: { navigation: 'sequential', allowPageJumping: false, autosave: true, showProgress: true, exports: { json: true, pdf: true } },
      pages: [{
        id: 'page',
        title: 'Page',
        blocks: [
          { id: 'choice', type: 'multipleChoice', config: { options: { a: 'A' }, correctAnswer: ['A'] } },
          { id: 'tf', type: 'trueFalse', config: { correctAnswer: 'true' } },
          { id: 'match', type: 'matching', config: { options: ['A'], pairs: [{ answer: 'A' }] } },
        ],
      }],
    } as any

    const blocks = sanitizeWorksheetDefinition(definition).pages[0].blocks

    expect(blocks[0].config).toMatchObject({ options: [], correctAnswer: '' })
    expect(blocks[1].config?.correctAnswer).toBe(true)
    expect(blocks[2].config?.pairs).toEqual([{ id: 'pair-1', prompt: '', answer: 'A' }])
  })

  it('clamps bounded numeric block settings imported from JSON', () => {
    const definition = {
      id: 'bad-numbers',
      version: 1,
      title: 'Bad numbers',
      description: '',
      settings: { navigation: 'sequential', allowPageJumping: false, autosave: true, showProgress: true, exports: { json: true, pdf: true } },
      pages: [{
        id: 'page',
        title: 'Page',
        blocks: [
          { id: 'cloud', type: 'wordCloud', config: { maxEntries: 1_000_000_000 } },
          { id: 'rating', type: 'rating', config: { min: 1, max: 5, defaultValue: 99 } },
          { id: 'matrix', type: 'matrix', config: { min: 5, max: 1, defaultValue: -10 } },
          { id: 'decision', type: 'decisionMatrix', config: { min: '', max: 0 } },
        ],
      }],
    } as any

    const blocks = sanitizeWorksheetDefinition(definition).pages[0].blocks
    expect(blocks[0].config).toMatchObject({ maxEntries: 10 })
    expect(blocks[1].config).toMatchObject({ min: 1, max: 5, defaultValue: 5 })
    expect(blocks[2].config).toMatchObject({ min: 5, max: 5, defaultValue: 5 })
    expect(blocks[3].config).toMatchObject({ min: 1, max: 1 })
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

  it('treats angle-bracket plain text as meaningful but empty rich text as blank', () => {
    const shortText = { id: 'plain', type: 'shortText', required: true } as any
    const richText = { id: 'rich', type: 'richText', required: true } as any

    expect(hasMeaningfulResponseValue('<3>')).toBe(true)
    expect(isRequiredBlockSatisfied(shortText, { plain: '<x>' })).toBe(true)
    expect(isRequiredBlockSatisfied(richText, { rich: '<p></p>' })).toBe(false)
    expect(isRequiredBlockSatisfied(richText, { rich: '<p>&nbsp;</p>' })).toBe(false)
    expect(isRequiredBlockSatisfied(richText, { rich: '<p><strong>Done</strong></p>' })).toBe(true)
    expect(normalizeRichTextResponse('<p></p>')).toBe('')
  })

  it('flags required blocks that learners cannot answer before publishing', () => {
    const definition = {
      pages: [{
        blocks: [
          { id: 'empty-verdict', type: 'verdict', label: 'Verdict', required: true, config: { options: [] } },
          { id: 'bad-match', type: 'matching', label: 'Match', required: true, config: { options: ['Choice'], pairs: [{ id: 'pair-1', answer: 'Missing choice' }] } },
          { id: 'flat-radar', type: 'radar', label: 'Radar', required: true, config: { dimensions: ['Ease', 'Impact'] } },
          { id: 'optional-empty', type: 'singleSelect', required: false, config: { options: [] } },
          { id: 'usable-board', type: 'board', required: true, config: { columns: [{ id: 'column-1', label: 'Column' }] } },
        ],
      }],
    } as any
    expect(getUnanswerableRequiredBlocks(definition).map((block) => block.id)).toEqual(['empty-verdict', 'bad-match', 'flat-radar'])
    expect(getUnanswerableRequiredBlocks(definition).map((block) => block.id)).toEqual(['empty-verdict', 'bad-match', 'flat-radar'])
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
    expect(isRequiredBlockSatisfied(page.blocks[0], { ...responses, rating: 99 })).toBe(false)
    expect(isRequiredBlockSatisfied(page.blocks[1], { ...responses, matrix: { Clarity: 2, Accuracy: -1 } })).toBe(false)
    expect(isRequiredBlockSatisfied(page.blocks[2], { ...responses, radar: { Ease: 5, Impact: Number.POSITIVE_INFINITY } })).toBe(false)
    expect(isRequiredBlockSatisfied(page.blocks[3], responses)).toBe(true)
    expect(isRequiredBlockSatisfied(page.blocks[4], responses)).toBe(true)
    expect(getMissingRequiredBlocks(page, responses)).toHaveLength(0)
  })
})
