import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile, AppSettings, TaskRecord } from '../types'
import { createTaskRecoveryManager, type TaskRecoveryManagerDependencies } from './taskRecoveryManager'
import { canResumeTaskRecovery } from './taskRecovery'

const mocks = vi.hoisted(() => ({ getCustomQueuedImageResult: vi.fn(), getFalQueuedImageResult: vi.fn() }))

vi.mock('./openaiCompatibleImageApi', () => ({ getCustomQueuedImageResult: mocks.getCustomQueuedImageResult }))
vi.mock('./falAiImageApi', () => ({
  getFalErrorMessage: () => null,
  getFalQueuedImageResult: mocks.getFalQueuedImageResult,
}))

const profile = { id: 'custom', provider: 'custom-provider' } as ApiProfile

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'prompt',
    params: { size: '1024x1024' } as TaskRecord['params'],
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 100,
    finishedAt: null,
    elapsed: null,
    apiProvider: 'custom-provider',
    customTaskId: 'remote-1',
    ...overrides,
  }
}

function createHarness(task = createTask()) {
  const state = {
    settings: {
      customProviders: [
        {
          id: 'custom-provider',
          name: 'Custom',
          submit: { path: 'submit' },
          poll: {
            path: 'tasks/{id}',
            statusPath: 'status',
            successValues: ['done'],
            failureValues: ['error'],
            result: {},
          },
        },
      ],
    } as AppSettings,
    tasks: [task],
    showToast: vi.fn(),
  }
  const updateTask = vi.fn((taskId: string, patch: Partial<TaskRecord>) => {
    state.tasks = state.tasks.map((item) => (item.id === taskId ? { ...item, ...patch } : item))
  })
  const getCustomProfile = vi.fn<() => ApiProfile | null>(() => profile)
  const getFalProfile = vi.fn<() => ApiProfile | null>(() => ({ ...profile, provider: 'fal' }))
  const storeGeneratedImage = vi.fn(async () => 'result')
  const cacheImage = vi.fn()
  const readImageSizeParamsList = vi.fn<TaskRecoveryManagerDependencies['readImageSizeParamsList']>(async () => [])
  const resolveImageSizeParamsList = vi.fn<TaskRecoveryManagerDependencies['resolveImageSizeParamsList']>(
    async () => [],
  )
  const manager = createTaskRecoveryManager({
    getState: () => state,
    updateTask,
    getCustomProfile,
    getFalProfile,
    isFalConnectionRecoverableError: (error) => error instanceof TypeError,
    getRawErrorPayload: () => ({}),
    readImageSizeParamsList,
    resolveImageSizeParamsList,
    storeGeneratedImage,
    cacheImage,
  })
  return {
    state,
    manager,
    updateTask,
    getCustomProfile,
    getFalProfile,
    storeGeneratedImage,
    cacheImage,
    readImageSizeParamsList,
    resolveImageSizeParamsList,
  }
}

describe('task recovery manager', () => {
  beforeEach(() => {
    mocks.getCustomQueuedImageResult.mockReset()
    mocks.getFalQueuedImageResult.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('completes a custom queued task through injected state and persistence adapters', async () => {
    const task = createTask()
    const state = {
      settings: {
        customProviders: [
          {
            id: 'custom-provider',
            name: 'Custom',
            submit: { path: 'submit' },
            poll: {
              path: 'tasks/{id}',
              statusPath: 'status',
              successValues: ['done'],
              failureValues: ['error'],
              result: {},
            },
          },
        ],
      } as AppSettings,
      tasks: [task],
      showToast: vi.fn(),
    }
    const updateTask = vi.fn((taskId: string, patch: Partial<TaskRecord>) => {
      state.tasks = state.tasks.map((item) => (item.id === taskId ? { ...item, ...patch } : item))
    })
    mocks.getCustomQueuedImageResult.mockResolvedValue({ images: ['data:image/png;base64,result'] })
    const manager = createTaskRecoveryManager({
      getState: () => state,
      updateTask,
      getFalProfile: () => null,
      getCustomProfile: () => profile,
      isFalConnectionRecoverableError: () => false,
      getRawErrorPayload: () => ({}),
      readImageSizeParamsList: async () => [{ size: '512x512' }],
      resolveImageSizeParamsList: async () => [],
      storeGeneratedImage: async () => 'stored-result',
    })

    await manager.recoverCustom(task.id)

    expect(mocks.getCustomQueuedImageResult).toHaveBeenCalledWith(
      profile,
      expect.any(Object),
      'remote-1',
      task.params,
      expect.any(AbortSignal),
    )
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: 'done', outputImages: ['stored-result'], customRecoverable: false }),
    )
    expect(state.showToast).toHaveBeenCalledWith('自定义异步任务已恢复，共 1 张图片', 'success')
  })

  it.each(['fal', 'custom'] as const)(
    'cancels %s polling, deduplicates it and ignores a late SDK result',
    async (kind) => {
      const task =
        kind === 'fal'
          ? createTask({
              apiProvider: 'fal',
              customTaskId: undefined,
              falRequestId: 'fal-remote',
              falEndpoint: 'model',
            })
          : createTask()
      const harness = createHarness(task)
      const request = kind === 'fal' ? mocks.getFalQueuedImageResult : mocks.getCustomQueuedImageResult
      let finish!: (result: { images: string[] }) => void
      request.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      const recover = kind === 'fal' ? harness.manager.recoverFal : harness.manager.recoverCustom
      const running = recover(task.id)
      await recover(task.id)
      expect(request).toHaveBeenCalledTimes(1)
      const signal = request.mock.calls[0][4] as AbortSignal
      harness.manager.cancel(task.id)
      harness.state.tasks = []
      await running
      expect(signal.aborted).toBe(true)
      finish({ images: ['late'] })
      await Promise.resolve()
      expect(harness.storeGeneratedImage).not.toHaveBeenCalled()
      expect(harness.updateTask).not.toHaveBeenCalled()
      expect(harness.state.showToast).not.toHaveBeenCalled()
    },
  )

  it('does not cache or publish after cancellation while an image write is already pending', async () => {
    const harness = createHarness()
    mocks.getCustomQueuedImageResult.mockResolvedValue({ images: ['data'] })
    let finishWrite!: (id: string) => void
    harness.storeGeneratedImage.mockReturnValue(
      new Promise((resolve) => {
        finishWrite = resolve
      }),
    )
    const running = harness.manager.recoverCustom('task-1')
    await vi.waitFor(() => expect(harness.storeGeneratedImage).toHaveBeenCalledTimes(1))
    harness.manager.cancelAll()
    finishWrite('late-id')
    await running
    expect(harness.cacheImage).not.toHaveBeenCalled()
    expect(harness.updateTask).not.toHaveBeenCalled()
  })

  it('元数据读取中取消后不发布失败、完成或继续查询', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    mocks.getCustomQueuedImageResult.mockResolvedValue({ images: ['data'] })
    let finish!: () => void
    harness.readImageSizeParamsList.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve([])
      }),
    )
    const running = harness.manager.recoverCustom('task-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.readImageSizeParamsList).toHaveBeenCalledTimes(1)
    harness.manager.cancelAll()
    await running
    finish()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(harness.state.tasks[0].status).toBe('running')
    expect(harness.updateTask).not.toHaveBeenCalled()
    expect(harness.storeGeneratedImage).not.toHaveBeenCalled()
    expect(harness.state.showToast).not.toHaveBeenCalled()
    expect(mocks.getCustomQueuedImageResult).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('makes missing original configuration visible without a ten-second retry loop, then resumes it', async () => {
    vi.useFakeTimers()
    const harness = createHarness(createTask({ apiProfileId: 'original-account', apiProfileName: 'Original' }))
    harness.getCustomProfile.mockReturnValue(null)
    await harness.manager.recoverCustom('task-1')
    expect(harness.state.tasks[0]).toMatchObject({
      apiProfileId: 'original-account',
      customTaskId: 'remote-1',
      status: 'error',
      customRecoverable: true,
    })
    expect(harness.state.tasks[0].error).toContain('Original')
    expect(harness.state.tasks[0].recoveryPausedReason).toBe('missing-profile')
    expect(vi.getTimerCount()).toBe(0)
    harness.manager.resumeBlocked()
    expect(vi.getTimerCount()).toBe(0)
    harness.getCustomProfile.mockReturnValue(profile)
    mocks.getCustomQueuedImageResult.mockResolvedValue({ images: ['image'] })
    harness.manager.resumeBlocked()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.tasks[0].status).toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses fal recovery for a missing original profile rather than using another account or retrying silently', async () => {
    vi.useFakeTimers()
    const harness = createHarness(
      createTask({
        apiProvider: 'fal',
        apiProfileId: 'missing-fal',
        customTaskId: undefined,
        falRequestId: 'same-fal-remote',
        falEndpoint: 'model',
      }),
    )
    harness.getFalProfile.mockReturnValue(null)
    await harness.manager.recoverFal('task-1')
    expect(harness.state.tasks[0]).toMatchObject({
      status: 'error',
      recoveryPausedReason: 'missing-profile',
      falRecoverable: true,
      apiProfileId: 'missing-fal',
      falRequestId: 'same-fal-remote',
    })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.getFalQueuedImageResult).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses visibly when poll is missing and resumes only after it is restored', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    const provider = harness.state.settings.customProviders![0]
    const poll = provider.poll
    provider.poll = undefined
    await harness.manager.recoverCustom('task-1')
    expect(harness.state.tasks[0].error).toContain('poll')
    expect(harness.state.tasks[0].recoveryPausedReason).toBe('missing-poll')
    expect(harness.state.tasks[0].customRecoverable).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    provider.poll = poll
    mocks.getCustomQueuedImageResult.mockResolvedValue({ images: ['image'] })
    harness.manager.resumeBlocked()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.state.tasks[0].status).toBe('done')
  })

  it('bounds even an SDK that ignores abort and keeps the remote id recoverable', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    mocks.getCustomQueuedImageResult.mockReturnValue(new Promise(() => undefined))
    const running = harness.manager.recoverCustom('task-1')
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    await running
    expect(harness.state.tasks[0]).toMatchObject({ status: 'error', customTaskId: 'remote-1', customRecoverable: true })
    expect(harness.state.tasks[0].error).toContain('超时')
    expect(harness.state.tasks[0].recoveryPausedReason).toBe('timeout')
    expect(mocks.getCustomQueuedImageResult.mock.calls[0][4].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['fal', 'save', 'running'],
    ['fal', 'metadata', 'running'],
    ['custom', 'save', 'running'],
    ['custom', 'metadata', 'running'],
    ['fal', 'save', 'error'],
    ['fal', 'metadata', 'error'],
    ['custom', 'save', 'error'],
    ['custom', 'metadata', 'error'],
  ] as const)('%s 在 %s 阶段超时将 %s 任务转为可手动恢复状态', async (kind, phase, status) => {
    vi.useFakeTimers()
    const task = createTask({
      status,
      ...(kind === 'fal'
        ? {
            apiProvider: 'fal',
            customTaskId: undefined,
            falRequestId: 'remote-fal',
            falEndpoint: 'model',
            falRecoverable: true,
          }
        : { customRecoverable: true }),
    })
    const harness = createHarness(task)
    const request = kind === 'fal' ? mocks.getFalQueuedImageResult : mocks.getCustomQueuedImageResult
    const readMetadata = kind === 'fal' ? harness.resolveImageSizeParamsList : harness.readImageSizeParamsList
    request.mockResolvedValue({ images: ['data'] })
    let finish!: () => void
    if (phase === 'save') {
      harness.storeGeneratedImage.mockReturnValue(
        new Promise((resolve) => {
          finish = () => resolve('late-id')
        }),
      )
    } else {
      readMetadata.mockReturnValue(
        new Promise((resolve) => {
          finish = () => resolve([{ size: '512x512' }])
        }),
      )
    }
    const recover = kind === 'fal' ? harness.manager.recoverFal : harness.manager.recoverCustom
    const running = recover(task.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(phase === 'save' ? harness.storeGeneratedImage : readMetadata).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(harness.state.tasks[0]).toMatchObject({ status: 'error', recoveryPausedReason: 'timeout', outputImages: [] })
    expect(harness.state.tasks[0]).toMatchObject(
      kind === 'fal'
        ? { falRequestId: 'remote-fal', falEndpoint: 'model', falRecoverable: true }
        : { customTaskId: 'remote-1', customRecoverable: true },
    )
    expect(canResumeTaskRecovery(harness.state.tasks[0])).toBe(true)
    await running
    const updates = harness.updateTask.mock.calls.length
    finish()
    await vi.advanceTimersByTimeAsync(30_000)
    await recover(task.id)
    expect(harness.updateTask).toHaveBeenCalledTimes(updates)
    expect(request).toHaveBeenCalledTimes(1)
    expect(harness.cacheImage).not.toHaveBeenCalled()
    expect(harness.state.showToast).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['save', 'metadata'] as const)('删除任务后忽略 %s 阶段的超时和迟到结果', async (phase) => {
    vi.useFakeTimers()
    const harness = createHarness()
    mocks.getCustomQueuedImageResult.mockResolvedValue({ images: ['data'] })
    let finish!: () => void
    if (phase === 'save') {
      harness.storeGeneratedImage.mockReturnValue(
        new Promise((resolve) => {
          finish = () => resolve('late-id')
        }),
      )
    } else {
      harness.readImageSizeParamsList.mockReturnValue(
        new Promise((resolve) => {
          finish = () => resolve([])
        }),
      )
    }
    const running = harness.manager.recoverCustom('task-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(phase === 'save' ? harness.storeGeneratedImage : harness.readImageSizeParamsList).toHaveBeenCalledTimes(1)
    harness.state.tasks = []
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    await running
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.updateTask).not.toHaveBeenCalled()
    expect(harness.cacheImage).not.toHaveBeenCalled()
    expect(harness.state.showToast).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels pending recovery timers and configuration-resume work synchronously', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.getCustomProfile.mockReturnValue(null)
    await harness.manager.recoverCustom('task-1')
    harness.manager.scheduleCustom('task-1')
    harness.manager.scheduleFal('other')
    harness.manager.cancelAll()
    harness.getCustomProfile.mockReturnValue(profile)
    harness.manager.resumeBlocked()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.getCustomQueuedImageResult).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
