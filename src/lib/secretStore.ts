import type { AppSettings } from '../types'
import { normalizeSettings } from './apiProfiles'

export const SESSION_SECRETS_KEY = 'amazon-image-studio-secrets'

export interface AppSecrets {
  apiKey: string
  profiles: Record<string, string>
}

export function emptySecrets(): AppSecrets {
  return { apiKey: '', profiles: {} }
}

export function normalizeSecrets(input: unknown): AppSecrets {
  if (!input || typeof input !== 'object') return emptySecrets()
  const record = input as Record<string, unknown>
  const profiles =
    record.profiles && typeof record.profiles === 'object' && !Array.isArray(record.profiles)
      ? Object.fromEntries(
          Object.entries(record.profiles as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string')
            .map(([id, apiKey]) => [id, apiKey]),
        )
      : {}
  return {
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    profiles,
  }
}

export function hasSecretValues(secrets: AppSecrets): boolean {
  return Boolean(secrets.apiKey || Object.values(secrets.profiles).some((value) => Boolean(value)))
}

export function mergeSecretRecords(...records: AppSecrets[]): AppSecrets {
  const merged = emptySecrets()
  for (const record of records) {
    if (record.apiKey) merged.apiKey = record.apiKey
    for (const [id, apiKey] of Object.entries(record.profiles)) {
      if (apiKey) merged.profiles[id] = apiKey
    }
  }
  return merged
}

export function extractSecretsFromSettings(settings: AppSettings): AppSecrets {
  const profiles: Record<string, string> = {}
  for (const profile of settings.profiles) {
    if (profile.apiKey) profiles[profile.id] = profile.apiKey
  }
  return {
    apiKey: settings.apiKey || '',
    profiles,
  }
}

export function stripSecretsFromSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    apiKey: '',
    profiles: settings.profiles.map((profile) => ({ ...profile, apiKey: '' })),
  }
}

export function mergeSecretsIntoSettings(settings: AppSettings, secrets: AppSecrets): AppSettings {
  const profiles = settings.profiles.map((profile) => ({
    ...profile,
    apiKey:
      secrets.profiles[profile.id] ||
      (profile.id === settings.activeProfileId ? secrets.apiKey : '') ||
      profile.apiKey ||
      '',
  }))
  const active = profiles.find((profile) => profile.id === settings.activeProfileId) ?? profiles[0]
  return {
    ...settings,
    profiles,
    apiKey: active?.apiKey || secrets.apiKey || '',
  }
}

function hostnameFromConfiguredUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const hostname = url.hostname.trim().toLowerCase()
    return hostname || null
  } catch {
    return null
  }
}

export function collectApiHostnamesFromSettings(settings: Partial<AppSettings> | unknown): string[] {
  const normalized = normalizeSettings(settings)
  const hosts = new Set<string>()
  const urls = [
    normalized.baseUrl,
    ...normalized.profiles.map((profile) => profile.baseUrl),
    ...normalized.profiles.flatMap((profile) =>
      Object.values(profile.providerDrafts ?? {}).map((draft) => draft?.baseUrl ?? ''),
    ),
  ]
  for (const value of urls) {
    const hostname = hostnameFromConfiguredUrl(value)
    if (hostname) hosts.add(hostname)
  }
  return [...hosts]
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    return null
  }
}

export function readSessionSecrets(): AppSecrets {
  const storage = getSessionStorage()
  if (!storage) return emptySecrets()
  try {
    const raw = storage.getItem(SESSION_SECRETS_KEY)
    return raw ? normalizeSecrets(JSON.parse(raw)) : emptySecrets()
  } catch {
    return emptySecrets()
  }
}

export function writeSessionSecrets(secrets: AppSecrets) {
  const storage = getSessionStorage()
  if (!storage) return
  try {
    storage.setItem(SESSION_SECRETS_KEY, JSON.stringify(normalizeSecrets(secrets)))
  } catch {
    // Restricted or full session storage must not prevent saving to the OS vault.
  }
}

let cachedSecrets = readSessionSecrets()
let desktopSecretsLoaded = false
let pendingSecretWrite = Promise.resolve()

export function getCachedSecrets(): AppSecrets {
  return cachedSecrets
}

export function rememberSecrets(secrets: AppSecrets) {
  cachedSecrets = normalizeSecrets(secrets)
}

export function resetSecretStoreForTests() {
  cachedSecrets = emptySecrets()
  desktopSecretsLoaded = false
  pendingSecretWrite = Promise.resolve()
  const storage = getSessionStorage()
  storage?.removeItem(SESSION_SECRETS_KEY)
}

function isDesktopSecretsRuntime() {
  return Boolean(
    typeof window !== 'undefined' &&
    window.imageStudioDesktop?.isDesktop &&
    window.imageStudioDesktop.getSecrets &&
    window.imageStudioDesktop.setSecrets,
  )
}

export async function loadPersistedSecrets(): Promise<AppSecrets> {
  if (isDesktopSecretsRuntime()) {
    // Let the caller retain its pending edits and retry hydration on failure.
    // A session fallback must not be mistaken for a successfully read vault.
    const secrets = normalizeSecrets(await window.imageStudioDesktop!.getSecrets!())
    desktopSecretsLoaded = true
    return secrets
  }
  return readSessionSecrets()
}

export async function persistSecrets(secrets: AppSecrets): Promise<boolean> {
  const normalized = normalizeSecrets(secrets)
  rememberSecrets(normalized)
  writeSessionSecrets(normalized)
  if (!isDesktopSecretsRuntime()) return true
  // Never overwrite a vault that has not been read successfully. In particular,
  // a failed IPC read must not turn an empty renderer snapshot into a vault reset.
  if (!desktopSecretsLoaded) return false
  const write = pendingSecretWrite.then(async () => {
    try {
      return (await window.imageStudioDesktop!.setSecrets!(normalized)) !== false
    } catch {
      // Keep the in-memory and session copies even if OS storage is unavailable.
      return false
    }
  })
  pendingSecretWrite = write.then(() => {})
  return write
}
