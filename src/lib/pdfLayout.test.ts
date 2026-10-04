import { describe, expect, it } from 'vitest'
import { getPdfLineCapacity } from './pdfLayout'

describe('PDF layout helpers', () => {
  it('counts only complete text lines that fit available space', () => {
    expect(getPdfLineCapacity(60, 12)).toBe(5)
    expect(getPdfLineCapacity(59, 12)).toBe(4)
  })

  it('returns zero when no positive line height or space is available', () => {
    expect(getPdfLineCapacity(0, 12)).toBe(0)
    expect(getPdfLineCapacity(-1, 12)).toBe(0)
    expect(getPdfLineCapacity(60, 0)).toBe(0)
  })
})

