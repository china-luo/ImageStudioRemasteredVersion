import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { createDefaultOpenAIProfile, createDefaultVolcengineProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { createTaskSubmissionService } from './taskSubmissionService'

function createState() {
  const profile = createDefaultOpenAIProfile({ id: 'profile-1', apiKey: 'test-key' })
  return {
    settings: { ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id },
    tasks: [],
    setTasks: vi.fn(),
    showToast: vi.fn(),
    clearInputImages: vi.fn(),
    setPrompt: vi.fn(),
  }
}

function retryFixture(isCurrent?: () => boolean) {
  const state = createState()
  const seedream = createDefaultVolcengineProfile({ id: 'seedream-original', apiKey: 'seedream-key' })
  state.settings.profiles.push(seedream)
  const putTask = vi.fn(async (_task: TaskRecord) => undefined)
  const executeTask = vi.fn()
  const service = createTaskSubmissionService({
    getState: () => state,
    createId: () => 'retry',
    isCurrent,
    ensureImageCached: async () => null,
    getImage: async () => undefined,
    putImage: async () => undefined,
    storeInputImage: async () => undefined,
    cacheImage: () => undefined,
    putTask,
    executeTask,
  })
  const task: TaskRecord = {
    id: 'original',
    prompt: 'edit prompt',
    params: { ...DEFAULT_PARAMS, size: '4K' },
    apiProfileId: seedream.id,
    apiProvider: seedream.provider,
    apiMode: seedream.apiMode,
    apiModel: seedream.model,
    inputImageIds: ['source', 'guide', 'reference'],
    maskImageId: 'mask',
    maskTargetImageId: 'source',
    outputImages: [],
    status: 'error',
    error: 'temporary',
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    category: { workflow: 'seedream-edit' },
    imageEditContext: {
      engine: 'seedream',
      sourceImageId: 'source',
      visualGuideImageId: 'guide',
      referenceImageIds: ['reference'],
      userInstruction: 'remove text',
    },
  }
  return { state, seedream, task, putTask, executeTask, service }
}

it('不发布在落盘期间因清空而失效的重试任务', async () => {
  let current = true
  const { service, task, state, putTask, executeTask } = retryFixture(() => current)
  let finish!: () => void
  putTask.mockReturnValueOnce(
    new Promise<undefined>((resolve) => {
      finish = () => resolve(undefined)
    }),
  )
  const result = service.retry(task)
  expect(putTask).toHaveBeenCalledTimes(1)
  current = false
  finish()
  await expect(result).resolves.toEqual({ status: 'cancelled' })
  expect(state.setTasks).not.toHaveBeenCalled()
  expect(executeTask).not.toHaveBeenCalled()
})

describe('editor retry configuration', () => {
  it('keeps the original Seedream profile and complete edit context after switching the active profile', async () => {
    const { service, task, putTask, seedream } = retryFixture()
    await expect(service.retry(task)).resolves.toEqual({ status: 'submitted', taskId: 'retry' })
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        apiProfileId: seedream.id,
        apiProvider: 'volcengine',
        apiModel: seedream.model,
        params: expect.objectContaining({ size: '4K' }),
        imageEditContext: task.imageEditContext,
        inputImageIds: task.inputImageIds,
        maskImageId: 'mask',
        maskTargetImageId: 'source',
      }),
    )
  })

  it.each(['missing', 'wrong-provider', 'wrong-model', 'incomplete', 'missing-id'] as const)(
    'rejects %s original editor configuration without dispatching or falling back',
    async (reason) => {
      const { service, state, task, seedream, putTask, executeTask } = retryFixture()
      if (reason === 'missing') state.settings.profiles = [state.settings.profiles[0]]
      if (reason === 'wrong-provider')
        state.settings.profiles[1] = createDefaultOpenAIProfile({ id: seedream.id, apiKey: 'other-key' })
      if (reason === 'wrong-model') state.settings.profiles[1] = { ...seedream, model: 'doubao-seedream-4-0-250828' }
      if (reason === 'incomplete') state.settings.profiles[1] = { ...seedream, apiKey: '' }
      if (reason === 'missing-id') task.apiProfileId = undefined
      await expect(service.retry(task)).resolves.toMatchObject({
        status: 'original-profile-error',
        message: expect.any(String),
      })
      expect(putTask).not.toHaveBeenCalled()
      expect(executeTask).not.toHaveBeenCalled()
      expect(state.setTasks).not.toHaveBeenCalled()
    },
  )

  it('keeps ordinary gallery retries on the current image configuration', async () => {
    const { service, task, state, putTask } = retryFixture()
    await service.retry({ ...task, category: { workflow: 'gallery' }, imageEditContext: undefined })
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({ apiProfileId: state.settings.activeProfileId, apiProvider: 'openai' }),
    )
  })

  it('preserves the separate style board alongside 16 uploaded references on retry', async () => {
    const { service, task, putTask } = retryFixture()
    const inputImageIds = [...Array.from({ length: 16 }, (_, i) => `product-${i}`), 'style-board']
    await expect(
      service.retry({
        ...task,
        category: { workflow: 'amazon-aplus', styleReferenceImageId: 'style-board' },
        imageEditContext: undefined,
        maskTargetImageId: null,
        maskImageId: null,
        inputImageIds,
      }),
    ).resolves.toMatchObject({ status: 'submitted' })
    expect(putTask).toHaveBeenCalledWith(expect.objectContaining({ inputImageIds }))
  })

  it('rejects an ordinary retry with too many references for the current model before persistence', async () => {
    const { service, task, state, putTask, executeTask } = retryFixture()
    const qwen = createDefaultOpenAIProfile({
      id: 'qwen-current',
      name: 'Qwen current',
      apiKey: 'qwen-test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      model: 'qwen-image-edit-plus',
    })
    state.settings.profiles.push(qwen)
    state.settings.activeProfileId = qwen.id
    const galleryTask: TaskRecord = {
      ...task,
      category: { workflow: 'gallery' },
      imageEditContext: undefined,
      maskImageId: null,
      maskTargetImageId: null,
    }
    await expect(
      service.retry({ ...galleryTask, inputImageIds: [...galleryTask.inputImageIds, 'ref-4'] }),
    ).resolves.toEqual({
      status: 'cancelled',
    })
    expect(state.showToast).toHaveBeenCalledWith(expect.stringContaining('最多支持 3 张参考图，此任务有 4 张'), 'error')
    expect(putTask).not.toHaveBeenCalled()
    expect(executeTask).not.toHaveBeenCalled()
    expect(state.setTasks).not.toHaveBeenCalled()

    await expect(service.retry(galleryTask)).resolves.toEqual({ status: 'submitted', taskId: 'retry' })
    expect(putTask).toHaveBeenCalledOnce()
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        apiProfileId: qwen.id,
        apiModel: qwen.model,
        inputImageIds: galleryTask.inputImageIds,
      }),
    )
    expect(state.showToast).toHaveBeenCalledWith(`重试将使用配置「${qwen.name}」的当前模型「${qwen.model}」。`, 'info')
    expect(executeTask).toHaveBeenCalledWith('retry')
  })

  it('also pins home-engine editor retries to the original profile', async () => {
    const { service, task, state, putTask, seedream } = retryFixture()
    const original = state.settings.profiles[0]
    state.settings.activeProfileId = seedream.id
    await service.retry({
      ...task,
      apiProfileId: original.id,
      apiProvider: original.provider,
      imageEditContext: { ...task.imageEditContext!, engine: 'home' },
    })
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({
        apiProfileId: original.id,
        imageEditContext: expect.objectContaining({ engine: 'home' }),
      }),
    )
  })

  it('pins legacy categorized editor tasks even without edit context', async () => {
    const { service, task, putTask, seedream } = retryFixture()
    await service.retry({ ...task, imageEditContext: undefined })
    expect(putTask).toHaveBeenCalledWith(
      expect.objectContaining({ apiProfileId: seedream.id, apiProvider: 'volcengine' }),
    )
  })
})

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
    expect(state.clearInputImages).toHaveBeenCalledOnce()
    expect(state.setPrompt).toHaveBeenCalledWith('')
  })

  it.each(['editor', 'gallery'] as const)(
    'retains concurrent task updates while %s images are stored',
    async (mode) => {
      const state = createState()
      const running = { id: 'running', status: 'running', outputImages: [] } as unknown as TaskRecord
      const done: TaskRecord = { ...running, status: 'done', outputImages: ['output'] }
      const other = { ...running, id: 'new-task' }
      let tasks = [running]
      let finishImage!: () => void
      const imageReady = new Promise<void>((resolve) => {
        finishImage = resolve
      })
      const service = createTaskSubmissionService({
        getState: () => ({
          ...state,
          tasks,
          setTasks: (next) => {
            tasks = next
          },
        }),
        createId: () => 'submission',
        ensureImageCached: async () => null,
        getImage: async () => undefined,
        putImage: () => imageReady,
        storeInputImage: () => imageReady,
        cacheImage: () => undefined,
        putTask: async () => undefined,
        executeTask: () => undefined,
      })
      const input = { prompt: 'edit image', inputImages: [{ id: 'input', dataUrl: 'image' }], params: DEFAULT_PARAMS }
      const pending =
        mode === 'editor'
          ? service.submitWithInput({ ...input, apiProfileId: 'profile-1' })
          : service.submitPrepared({
              ...input,
              profile: state.settings.profiles[0],
              requestSettings: state.settings,
              category: { workflow: 'gallery' },
              maskTargetImageId: null,
              maskImageId: null,
              clearInputAfterSubmit: false,
            })
      tasks = [other, done]
      finishImage()
      await pending
      expect(tasks).toEqual([expect.objectContaining({ id: 'submission' }), other, done])
    },
  )

  it('preserves project reference inputs and project/slot identity through submit and retry', async () => {
    const state = createState()
    const saved: TaskRecord[] = []
    const service = createTaskSubmissionService({
      getState: () => state,
      createId: () => `task-${saved.length}`,
      ensureImageCached: async () => null,
      getImage: async () => undefined,
      putImage: async () => undefined,
      storeInputImage: async () => undefined,
      cacheImage: () => undefined,
      putTask: async (task) => {
        saved.push(task)
      },
      executeTask: () => undefined,
    })
    const category = {
      workflow: 'amazon-listing' as const,
      projectId: 'project-a',
      projectSlotId: 'slot-a',
      amazonSlot: 'MAIN',
    }
    await service.submitPrepared({
      profile: state.settings.profiles[0],
      requestSettings: state.settings,
      prompt: 'Mug',
      inputImages: [{ id: 'ref', dataUrl: 'image' }],
      params: DEFAULT_PARAMS,
      category,
      maskTargetImageId: null,
      maskImageId: null,
      clearInputAfterSubmit: true,
    })
    expect(state.clearInputImages).not.toHaveBeenCalled()
    await service.retry({ ...saved[0], status: 'error', error: 'temporary failure' })
    expect(saved).toHaveLength(2)
    expect(saved.map((item) => item.category)).toEqual([category, category])
    expect(saved[1].id).not.toBe(saved[0].id)
  })
})
