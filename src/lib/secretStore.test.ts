import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import {
  collectApiHostnamesFromSettings,
  extractSecretsFromSettings,
  mergeSecretRecords,
  mergeSecretsIntoSettings,
  resetSecretStoreForTests,
  stripSecretsFromSettings,
} from './secretStore'

afterEach(() => {
  resetSecretStoreForTests()
})

describe('secretStore', () => {
  it('strips API keys from persisted settings while keeping them in memory', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      apiKey: 'top-level-key',
      vocApiKey: 'shulex-key',
      profiles: [
        createDefaultOpenAIProfile({ id: 'image-profile', apiKey: 'image-key' }),
        createDefaultOpenAIProfile({ id: 'planner-profile', apiKey: 'planner-key', apiMode: 'responses' }),
      ],
      activeProfileId: 'image-profile',
    })

    const stripped = stripSecretsFromSettings(settings)
    expect(stripped.apiKey).toBe('')
    expect(stripped.vocApiKey).toBe('')
    expect(stripped.profiles.map((profile) => profile.apiKey)).toEqual(['', ''])
    expect(settings.apiKey).toBe('image-key')

    const restored = mergeSecretsIntoSettings(stripped, extractSecretsFromSettings(settings))
    expect(restored.apiKey).toBe('image-key')
    expect(restored.vocApiKey).toBe('shulex-key')
    expect(restored.profiles.find((profile) => profile.id === 'planner-profile')?.apiKey).toBe('planner-key')
  })

  it('collects user-configured API hostnames for the desktop allowlist', () => {
    const hosts = collectApiHostnamesFromSettings({
      ...DEFAULT_SETTINGS,
      profiles: [
        createDefaultOpenAIProfile({
          id: 'custom-profile',
          baseUrl: 'https://llm.internal-partner.com/v1',
          apiKey: 'custom-key',
        }),
      ],
      activeProfileId: 'custom-profile',
    })

    expect(hosts).toContain('llm.internal-partner.com')
  })

  it('merges leftover persisted keys over empty stored secrets', () => {
    const merged = mergeSecretRecords(
      { apiKey: '', vocApiKey: '', profiles: {} },
      { apiKey: 'legacy-key', vocApiKey: 'voc-legacy', profiles: { 'image-profile': 'image-legacy' } },
    )

    expect(merged).toEqual({
      apiKey: 'legacy-key',
      vocApiKey: 'voc-legacy',
      profiles: { 'image-profile': 'image-legacy' },
    })
  })
})
