import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { submitGalleryTask, type GallerySubmissionDependencies } from './gallerySubmission'

function createDeps(overrides: Partial<GallerySubmissionDependencies> = {}) {
  const profile = createDefaultOpenAIProfile({ id: 'gallery-profile', apiKey: 'test-key' })
  const state: ReturnType<GallerySubmissionDependencies['getState']> = {
    settings: {
      ...DEFAULT_SETTINGS,
      profiles: [profile],
      activeProfileId: profile.id,
      reuseTaskApiProfileTemporarily: false,
    },
    prompt: '  a product image  ',
    inputImages: [],
    maskDraft: null,
    params: DEFAULT_PARAMS,
    reusedTaskApiProfileId: null,
    reusedTaskApiProfileName: null,
    reusedTaskApiProfileMissing: false,
    pendingTaskCategory: null,
  }
  const submitPrepared = vi.fn(async () => true)
  const deps: GallerySubmissionDependencies = {
    getState: () => state,
    setReusedTaskApiProfile: vi.fn(),
    setShowSettings: vi.fn(),
    setConfirmDialog: vi.fn(),
    clearMaskDraft: vi.fn(),
    showToast: vi.fn(),
    ensureImageCached: vi.fn(async () => null),
    storeImage: vi.fn(async () => 'stored-mask'),
    cacheImage: vi.fn(),
    submitPrepared,
    ...overrides,
  }
  return { deps, state, submitPrepared, profile }
}

describe('gallery submission preflight', () => {
  it('rejects an empty prompt before dispatching a task', async () => {
    const { deps, state, submitPrepared } = createDeps()
    state.prompt = '  '

    await expect(submitGalleryTask(deps)).resolves.toBe(false)
    expect(submitPrepared).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith('请输入提示词', 'error')
  })

  it('delegates a valid gallery request with the normalized category', async () => {
    const { deps, submitPrepared, profile } = createDeps()

    await expect(submitGalleryTask(deps)).resolves.toBe(true)
    expect(submitPrepared).toHaveBeenCalledWith(
      expect.objectContaining({
        profile,
        prompt: 'a product image',
        category: { workflow: 'gallery' },
        maskImageId: null,
        maskTargetImageId: null,
      }),
    )
  })

  it('reserves a slot for a separate style reference without counting a duplicate twice', async () => {
    const { deps, state, submitPrepared } = createDeps()
    state.settings.profiles[0] = {
      ...state.settings.profiles[0],
      model: 'qwen-image-2.0-pro',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    }
    state.inputImages = ['a', 'b', 'c'].map((id) => ({ id, dataUrl: 'image' }))
    state.pendingTaskCategory = {
      mode: 'next-submit',
      category: { workflow: 'gallery', styleReferenceImageId: 'separate-style' },
    }

    await expect(submitGalleryTask(deps)).resolves.toBe(false)
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('参考图和风格板合计不能超过 3 张'), 'error')
    expect(deps.ensureImageCached).not.toHaveBeenCalled()
    expect(submitPrepared).not.toHaveBeenCalled()

    state.pendingTaskCategory.category.styleReferenceImageId = 'b'
    await expect(submitGalleryTask(deps)).resolves.toBe(true)
    expect(submitPrepared).toHaveBeenCalledWith(expect.objectContaining({ inputImages: state.inputImages }))
  })

  it('opens a confirmation when the temporarily reused profile no longer exists', async () => {
    const { deps, state, submitPrepared } = createDeps()
    state.reusedTaskApiProfileId = 'deleted-profile'
    state.reusedTaskApiProfileName = '已删除配置'
    state.settings.reuseTaskApiProfileTemporarily = true

    await expect(submitGalleryTask(deps)).resolves.toBe(false)
    expect(submitPrepared).not.toHaveBeenCalled()
    expect(deps.setConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: '找不到 API 配置', confirmText: '使用当前配置提交' }),
    )
  })
})
