import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { createTaskExecutionService, type TaskExecutionDependencies } from './taskExecutionService'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'product photo',
    params: { ...DEFAULT_PARAMS },
    apiProvider: 'openai',
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 100,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

function createHarness(task: TaskRecord, overrides: Partial<TaskExecutionDependencies> = {}) {
  let tasks = [task]
  const showToast = vi.fn()
  const setDetailTaskId = vi.fn()
  const scheduleFalRecovery = vi.fn()
  const clearWatchdog = vi.fn()
  const state = () => ({
    settings: DEFAULT_SETTINGS,
    tasks,
    maskDraft: null,
    showToast,
    clearMaskDraft: vi.fn(),
    setDetailTaskId,
  })
  const dependencies: TaskExecutionDependencies = {
    getState: state,
    updateTask: (taskId, patch) => {
      tasks = tasks.map((item) => (item.id === taskId ? { ...item, ...patch } : item))
    },
    ensureImageCached: vi.fn(async () => null),
    storeGeneratedImage: vi.fn(async () => 'output-1'),
    cacheImage: vi.fn(),
    forgetCachedImage: vi.fn(),
    scheduleWatchdog: vi.fn(),
    clearWatchdog,
    scheduleFalRecovery,
    scheduleCustomRecovery: vi.fn(),
    resolveImageSizeParamsList: vi.fn(async (_images, values) => values ?? []),
    readImageSizeParamsList: vi.fn(async () => []),
    isRecoverableConnectionError: (error) => error instanceof TypeError,
    getNetworkErrorHint: () => null,
    getRawErrorPayload: () => ({}),
    showCodexCliPrompt: vi.fn(),
    callImageApi: vi.fn(async () => ({
      images: ['data:image/png;base64,AA=='],
      actualParams: { size: '1024x1024' },
      actualParamsList: [{ size: '1024x1024' }],
    })),
    preparePayload: vi.fn(async (dataUrls, maskDataUrl) => ({
      dataUrls,
      maskDataUrl,
      originalBytes: 0,
      payloadBytes: 0,
      compressedCount: 0,
      pass: 'none' as const,
      notice: '',
    })),
    now: () => 200,
    ...overrides,
  }
  return {
    service: createTaskExecutionService(dependencies),
    getTask: () => tasks[0],
    showToast,
    setDetailTaskId,
    scheduleFalRecovery,
    clearWatchdog,
  }
}

describe('createTaskExecutionService', () => {
  it('stores generated images and completes a running task', async () => {
    const harness = createHarness(createTask())
    await harness.service.execute('task-1')

    expect(harness.getTask()).toMatchObject({
      status: 'done',
      outputImages: ['output-1'],
      elapsed: 100,
      falRecoverable: false,
      customRecoverable: false,
    })
    expect(harness.showToast).toHaveBeenCalledWith('生成完成，共 1 张图片', 'success')
  })

  it('fails without calling the API when the recorded profile no longer exists', async () => {
    const callImageApi = vi.fn<NonNullable<TaskExecutionDependencies['callImageApi']>>()
    const harness = createHarness(createTask({ apiProfileId: 'missing-profile' }), { callImageApi })
    await harness.service.execute('task-1')

    expect(callImageApi).not.toHaveBeenCalled()
    expect(harness.getTask()).toMatchObject({ status: 'error', error: '找不到此任务所使用的 API 配置。' })
  })

  it('records API errors and opens task details', async () => {
    const harness = createHarness(createTask(), {
      callImageApi: vi.fn(async () => {
        throw new Error('request failed')
      }),
    })
    await harness.service.execute('task-1')

    expect(harness.getTask()).toMatchObject({ status: 'error', error: 'request failed' })
    expect(harness.setDetailTaskId).toHaveBeenCalledWith('task-1')
    expect(harness.clearWatchdog).toHaveBeenCalledWith('task-1')
  })

  it('marks an enqueued fal task recoverable after a connection error', async () => {
    const harness = createHarness(createTask({ apiProvider: 'fal' }), {
      callImageApi: vi.fn(async (options) => {
        options.onFalRequestEnqueued?.({ requestId: 'request-1', endpoint: 'fal-ai/model' })
        throw new TypeError('fetch failed')
      }),
    })
    await harness.service.execute('task-1')

    expect(harness.getTask()).toMatchObject({
      status: 'error',
      falRequestId: 'request-1',
      falEndpoint: 'fal-ai/model',
      falRecoverable: true,
    })
    expect(harness.scheduleFalRecovery).toHaveBeenCalledWith('task-1')
  })
})
