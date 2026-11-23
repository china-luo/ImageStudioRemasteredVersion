export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'image-studio-theme'
export const THEME_CHANGE_EVENT = 'image-studio-theme-change'

const darkQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(preference: ThemePreference = readThemePreference()): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return darkQuery()?.matches ? 'dark' : 'light'
}

/** Applies the override classes on <html>. `system` removes both and lets CSS media queries decide. */
export function applyThemePreference(preference: ThemePreference = readThemePreference()) {
  const root = document.documentElement
  root.classList.toggle('dark', preference === 'dark')
  root.classList.toggle('light', preference === 'light')
  root.style.colorScheme = preference === 'system' ? 'light dark' : preference
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', resolveTheme(preference) === 'dark' ? '#0b0b10' : '#f4f5fa')
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    /* Preference still applies for this session. */
  }
  applyThemePreference(preference)
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }))
}

export function cycleThemePreference(current: ThemePreference): ThemePreference {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
}

export function installThemeSync() {
  applyThemePreference()
  darkQuery()?.addEventListener?.('change', () => applyThemePreference())
}
