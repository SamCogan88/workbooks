// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeRichTextHtml } from './richTextSanitizer'

describe('sanitizeRichTextHtml', () => {
  it('removes script-capable markup from learner rich text', () => {
    const sanitized = sanitizeRichTextHtml('<p onclick="alert(1)">Hi<script>alert(2)</script><img src=x onerror="alert(3)"><iframe src="https://evil.example"></iframe></p>')

    expect(sanitized).toBe('<p>Hi</p>')
  })

  it('removes unsafe rich-text links and keeps safe formatting', () => {
    const sanitized = sanitizeRichTextHtml('<h2 style="text-align: center; background: url(javascript:alert(1))"><a href="javascript:alert(1)" target="_blank">Bad</a> <strong>safe</strong></h2><p><a href="https://example.com/page">Good</a></p>')

    expect(sanitized).toBe('<h2 style="text-align: center;"><a rel="noopener noreferrer">Bad</a> <strong>safe</strong></h2><p><a href="https://example.com/page" rel="noopener noreferrer">Good</a></p>')
  })
})
