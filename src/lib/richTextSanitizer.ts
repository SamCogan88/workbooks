const ALLOWED_RICH_TEXT_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
])

const DISCARD_WITH_CONTENTS_TAGS = new Set([
  'base',
  'embed',
  'iframe',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'style',
  'svg',
  'template',
])

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_TEXT_ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify'])

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isSafeHref(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true

  try {
    return SAFE_URL_PROTOCOLS.has(new URL(trimmed, window.location.origin).protocol)
  } catch {
    return false
  }
}

function unwrapElement(element: Element) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function sanitizeElementAttributes(element: HTMLElement) {
  const tagName = element.tagName.toLowerCase()
  const href = tagName === 'a' ? element.getAttribute('href') || '' : ''
  const textAlign = element.style.textAlign.trim().toLowerCase()

  Array.from(element.attributes).forEach((attribute) => {
    element.removeAttribute(attribute.name)
  })

  if (tagName === 'a') {
    if (isSafeHref(href)) {
      element.setAttribute('href', href.trim())
    }
    element.setAttribute('rel', 'noopener noreferrer')
  }

  if (SAFE_TEXT_ALIGN_VALUES.has(textAlign)) {
    element.style.textAlign = textAlign
  }
}

function sanitizeNode(node: Node) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.parentNode?.removeChild(child)
      return
    }

    if (child.nodeType !== Node.ELEMENT_NODE) return

    const element = child as HTMLElement
    const tagName = element.tagName.toLowerCase()

    if (DISCARD_WITH_CONTENTS_TAGS.has(tagName)) {
      element.remove()
      return
    }

    if (!ALLOWED_RICH_TEXT_TAGS.has(tagName)) {
      sanitizeNode(element)
      unwrapElement(element)
      return
    }

    sanitizeElementAttributes(element)
    sanitizeNode(element)
  })
}

export function sanitizeRichTextHtml(value: string) {
  if (!value) return ''
  if (typeof document === 'undefined' || typeof Node === 'undefined') {
    return escapeHtml(value)
  }

  const template = document.createElement('template')
  template.innerHTML = value
  sanitizeNode(template.content)
  return template.innerHTML
}
