export function getSafeBoundingClientRect(element: Element | null | undefined): DOMRect | null {
  if (!element || !element.isConnected || typeof element.getBoundingClientRect !== 'function') return null
  try {
    return element.getBoundingClientRect()
  } catch {
    return null
  }
}
