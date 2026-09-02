import type { AppSettings } from '../types'
import { normalizeSettings } from './apiProfiles'

export const SESSION_SECRETS_KEY = 'amazon-image-studio-secrets'

export interface AppSecrets {
  vocApiKey: string
  apiKey: string
  profiles: Record<string, string>
}

export function emptySecrets(): AppSecrets {
  return { vocApiKey: '', apiKey: '', profiles: {} }
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
    vocApiKey: typeof record.vocApiKey === 'string' ? record.vocApiKey : '',
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    profiles,
  }
}

export function hasSecretValues(secrets: AppSecrets): boolean {
  return Boolean(secrets.apiKey || secrets.vocApiKey || Object.values(secrets.profiles).some((value) => Boolean(value)))
}

export function mergeSecretRecords(...records: AppSecrets[]): AppSecrets {
  const merged = emptySecrets()
  for (const record of records) {
    if (record.apiKey) merged.apiKey = record.apiKey
    if (record.vocApiKey) merged.vocApiKey = record.vocApiKey
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
    vocApiKey: settings.vocApiKey || '',
    apiKey: settings.apiKey || '',
    profiles,
  }
}

export function stripSecretsFromSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    apiKey: '',
    vocApiKey: '',
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
    vocApiKey: secrets.vocApiKey || settings.vocApiKey || '',
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
  storage.setItem(SESSION_SECRETS_KEY, JSON.stringify(normalizeSecrets(secrets)))
}

let cachedSecrets = readSessionSecrets()

export function getCachedSecrets(): AppSecrets {
  return cachedSecrets
}

export function rememberSecrets(secrets: AppSecrets) {
  cachedSecrets = normalizeSecrets(secrets)
}

export function resetSecretStoreForTests() {
  cachedSecrets = emptySecrets()
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
    try {
      return normalizeSecrets(await window.imageStudioDesktop!.getSecrets!())
    } catch {
      return readSessionSecrets()
    }
  }
  return readSessionSecrets()
}

export async function persistSecrets(secrets: AppSecrets): Promise<void> {
  const normalized = normalizeSecrets(secrets)
  rememberSecrets(normalized)
  writeSessionSecrets(normalized)
  if (!isDesktopSecretsRuntime()) return
  try {
    await window.imageStudioDesktop!.setSecrets!(normalized)
  } catch {
    // Keep the in-memory and session copies even if OS storage is unavailable.
  }
}
