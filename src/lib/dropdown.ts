const DROPDOWN_GAP_PX = 8
const OVERFLOW_BOUNDARY_RE = /(auto|scroll|hidden|clip)/

export const DEFAULT_DROPDOWN_MAX_HEIGHT = 240

export function getDropdownMaxHeight(trigger: HTMLElement, maxHeight = DEFAULT_DROPDOWN_MAX_HEIGHT) {
  const rect = trigger.getBoundingClientRect()
  let availableHeight = window.innerHeight - rect.bottom - DROPDOWN_GAP_PX
  let parent = trigger.parentElement

  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent)
    if (OVERFLOW_BOUNDARY_RE.test(`${style.overflow} ${style.overflowY}`)) {
      const parentRect = parent.getBoundingClientRect()
      availableHeight = Math.min(availableHeight, parentRect.bottom - rect.bottom - DROPDOWN_GAP_PX)
    }
    parent = parent.parentElement
  }

  return Math.max(0, Math.min(maxHeight, Math.floor(availableHeight)))
}
