import { describe, expect, it } from 'vitest'
import { buildStudentSynthesis, getDefaultBlockConfig, getDefaultPageTimer, getMissingRequiredBlocks, getQuizSummary, isRequiredBlockSatisfied } from './App'

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
  it('creates a student-friendly synthesis from grouped responses', () => {
    const synthesis = buildStudentSynthesis([
      { key: 'diffit', label: 'Diffit', responses: [
        { responses: { 'radar-eval': { 'Ease of use': 9, 'Pedagogical value': 8, 'Reliability': 7 } } },
        { responses: { 'radar-eval': { 'Ease of use': 8, 'Pedagogical value': 7, 'Reliability': 8 } } },
      ] as any },
    ])

    expect(synthesis.headline).toContain('Diffit')
    expect(synthesis.topGroup).toBe('Diffit')
    expect(synthesis.highlights.length).toBeGreaterThan(0)
    expect(synthesis.recommendations.length).toBeGreaterThan(0)
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
})

describe('required page completion', () => {
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
