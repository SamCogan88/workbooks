export function getPdfLineCapacity(availableHeight: number, lineHeight: number) {
  if (!Number.isFinite(availableHeight) || !Number.isFinite(lineHeight) || lineHeight <= 0) return 0
  return Math.max(0, Math.floor(availableHeight / lineHeight))
}

