import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { createTaskSubmissionService } from './taskSubmissionService'

function createState() {
  const profile = createDefaultOpenAIProfile({ id: 'profile-1', apiKey: 'test-key' })
  return {
    settings: { ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id },
    tasks: [],
    setTasks: vi.fn(),
    showToast: vi.fn(),
  }
}

describe('task submission service', () => {
  it('rejects an empty editor prompt before accessing storage', async () => {
    const state = createState()
    const getImage = vi.fn()
    const service = createTaskSubmissionService({
      getState: () => state,
      createId: () => 'task-1',
      ensureImageCached: async () => null,
      getImage,
      putImage: async () => undefined,
      storeInputImage: async () => undefined,
      cacheImage: () => undefined,
      putTask: async () => undefined,
      executeTask: () => undefined,
    })

    await expect(
      service.submitWithInput({ apiProfileId: 'profile-1', prompt: ' ', inputImages: [], params: DEFAULT_PARAMS }),
    ).resolves.toBeNull()
    expect(getImage).not.toHaveBeenCalled()
    expect(state.showToast).toHaveBeenCalledWith('请输入编辑要求', 'error')
  })

  it('persists editor input then dispatches the created task', async () => {
    const state = createState()
    const putTask = vi.fn(async () => undefined)
    const executeTask = vi.fn()
    const service = createTaskSubmissionService({
      getState: () => state,
      createId: () => 'task-1',
      ensureImageCached: async () => 'data:image/png;base64,input',
      getImage: async () => undefined,
      putImage: async () => undefined,
      storeInputImage: async () => undefined,
      cacheImage: () => undefined,
      putTask,
      executeTask,
      now: () => 123,
    })

    const taskId = await service.submitWithInput({
      apiProfileId: 'profile-1',
      prompt: '  edit image  ',
      inputImages: [{ id: 'input-1', dataUrl: '' }],
      params: {
        size: '1024x1024',
        quality: 'auto',
        output_format: 'jpeg',
        output_compression: 70,
        moderation: 'auto',
        n: 1,
      },
    })

    expect(taskId).toBe('task-1')
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1', prompt: 'edit image' }))
    expect(state.setTasks).toHaveBeenCalledWith([expect.objectContaining({ id: 'task-1' })])
    expect(executeTask).toHaveBeenCalledWith('task-1')
  })

  it('persists a prepared gallery task and clears the submitted draft when configured', async () => {
    const state = createState()
    const putTask = vi.fn(async () => undefined)
    const storeInputImage = vi.fn(async () => undefined)
    const executeTask = vi.fn()
    const service = createTaskSubmissionService({
      getState: () => state,
      createId: () => 'gallery-1',
      ensureImageCached: async () => null,
      getImage: async () => undefined,
      putImage: async () => undefined,
      storeInputImage,
      cacheImage: () => undefined,
      putTask,
      executeTask,
      now: () => 789,
    })

    const result = await service.submitPrepared({
      profile: state.settings.profiles[0],
      requestSettings: state.settings,
      prompt: 'gallery prompt',
      inputImages: [{ id: 'gallery-input', dataUrl: 'data:image/png;base64,input' }],
      params: DEFAULT_PARAMS,
      category: { workflow: 'gallery' },
      maskTargetImageId: null,
      maskImageId: null,
      clearInputAfterSubmit: true,
    })

    expect(result).toBe(true)
    expect(storeInputImage).toHaveBeenCalledWith('data:image/png;base64,input')
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gallery-1', category: { workflow: 'gallery' } }),
    )
    expect(executeTask).toHaveBeenCalledWith('gallery-1')
  })
})
