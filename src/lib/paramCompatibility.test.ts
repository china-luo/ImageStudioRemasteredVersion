import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import {
  createApiProfileRequestSettings,
  createDefaultFalProfile,
  createDefaultOpenAIProfile,
  createDefaultVolcengineProfile,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from './apiProfiles'
import {
  getInputImageLimitForSettings,
  getOutputImageLimitForSettings,
  normalizeParamsForSettings,
} from './paramCompatibility'

describe('parameter compatibility', () => {
  it('limits OpenAI output count to 10', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('limits fal.ai output count to 4', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(4)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 8 }, settings).n).toBe(4)
  })

  it('limits Volcengine Lite output count to 14', () => {
    const volcengineProfile = createDefaultVolcengineProfile({
      apiKey: 'ark-key',
      model: 'doubao-seedream-5-0-260128',
    })
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [volcengineProfile],
      activeProfileId: volcengineProfile.id,
    })
    const settings = createApiProfileRequestSettings(normalized, volcengineProfile.id)!

    expect(getOutputImageLimitForSettings(settings)).toBe(14)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 20 }, settings).n).toBe(14)
  })

  it('limits Volcengine Seedream Pro output count to 1', () => {
    const volcengineProfile = createDefaultVolcengineProfile({
      apiKey: 'ark-key',
      model: 'doubao-seedream-5-0-pro-260628',
    })
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [volcengineProfile],
      activeProfileId: volcengineProfile.id,
    })
    const settings = createApiProfileRequestSettings(normalized, volcengineProfile.id)!

    expect(getOutputImageLimitForSettings(settings)).toBe(1)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, settings).n).toBe(1)
  })

  it('detects Alibaba image URLs without exposing another provider and applies Qwen limits', () => {
    const aliyunProfile = createDefaultOpenAIProfile({
      apiKey: 'dashscope-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-image-3.0-pro',
    })
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [aliyunProfile],
      activeProfileId: aliyunProfile.id,
    })
    const settings = createApiProfileRequestSettings(normalized, aliyunProfile.id)!

    expect(settings.profiles[0]?.provider).toBe('openai')
    expect(getOutputImageLimitForSettings(settings)).toBe(6)
    expect(getInputImageLimitForSettings(settings)).toBe(3)
    expect(
      normalizeParamsForSettings(
        {
          ...DEFAULT_PARAMS,
          size: '4096x4096',
          output_format: 'jpeg',
          quality: 'high',
          moderation: 'low',
          output_compression: 70,
          n: 10,
        },
        settings,
      ),
    ).toMatchObject({
      size: '2048x2048',
      output_format: 'png',
      quality: 'auto',
      moderation: 'auto',
      output_compression: null,
      n: 6,
    })
  })

  it('only replaces fal.ai auto size in text-to-image mode', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings).size).toBe('1360x1024')
    expect(
      normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto' }, settings, { hasInputImages: true }).size,
    ).toBe('auto')
  })

  it('defaults JPEG/WebP output compression to 70 for OpenAI requests', () => {
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(
      normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: null }, settings)
        .output_compression,
    ).toBe(70)
    expect(
      normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'webp', output_compression: null }, settings)
        .output_compression,
    ).toBe(70)
  })

  it('clears unsupported output compression for PNG and fal.ai', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const falSettings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })
    const openAIProfile = createDefaultOpenAIProfile({ apiKey: 'test-key' })
    const openAISettings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [openAIProfile],
      activeProfileId: openAIProfile.id,
    })

    expect(
      normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'png', output_compression: 70 }, openAISettings)
        .output_compression,
    ).toBeNull()
    expect(
      normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: 70 }, falSettings)
        .output_compression,
    ).toBeNull()
  })

  it('normalizes unsupported Volcengine parameters', () => {
    const volcengineProfile = createDefaultVolcengineProfile({ apiKey: 'ark-key' })
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [volcengineProfile],
      activeProfileId: volcengineProfile.id,
    })
    const settings = createApiProfileRequestSettings(normalized, volcengineProfile.id)!

    expect(
      normalizeParamsForSettings(
        {
          ...DEFAULT_PARAMS,
          size: 'auto',
          output_format: 'webp',
          output_compression: 70,
          quality: 'high',
          moderation: 'low',
        },
        settings,
      ),
    ).toMatchObject({
      size: '2048x2048',
      output_format: 'jpeg',
      output_compression: null,
      quality: 'auto',
      moderation: 'auto',
    })
  })
})
