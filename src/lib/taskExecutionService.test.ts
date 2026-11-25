import { afterEach, describe, expect, it, vi } from 'vitest'
import { callImageApi as requestImage } from './api'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { getSelectedImageMentionLabel } from './promptImageMentions'
import { createTaskExecutionService, type TaskExecutionDependencies } from './taskExecutionService'
import { DEFAULT_PARAMS, type TaskParams, type TaskRecord } from '../types'
import { canResumeTaskRecovery } from './taskRecovery'

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

function createHarness(
  task: TaskRecord,
  overrides: Partial<TaskExecutionDependencies> = {},
  settings = DEFAULT_SETTINGS,
) {
  let tasks = [task]
  const showToast = vi.fn()
  const setDetailTaskId = vi.fn()
  const scheduleFalRecovery = vi.fn()
  const clearWatchdog = vi.fn()
  const state = () => ({
    settings,
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
    removeTask: () => {
      tasks = []
    },
    showToast,
    setDetailTaskId,
    scheduleFalRecovery,
    clearWatchdog,
  }
}

describe('createTaskExecutionService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
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

  it.each(['queued-model', undefined, ' '])(
    'uses the saved model %s when present, with the original account',
    async (apiModel) => {
      const original = createDefaultOpenAIProfile({
        id: 'original',
        model: 'current-model',
        apiMode: 'responses',
        apiKey: 'original-test-key',
      })
      const active = createDefaultOpenAIProfile({ id: 'active', model: 'other-model', apiKey: 'other-test-key' })
      const settings = { ...DEFAULT_SETTINGS, profiles: [original, active], activeProfileId: active.id }
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'AA==' }] })))
      const harness = createHarness(
        createTask({ apiProfileId: original.id, apiModel, apiMode: 'images' }),
        { callImageApi: requestImage },
        settings,
      )
      await harness.service.execute('task-1')
      expect(fetchMock).toHaveBeenCalledOnce()
      const init = fetchMock.mock.calls[0][1]
      expect(JSON.parse(String(init?.body)).model).toBe(apiModel?.trim() ? apiModel : original.model)
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${original.apiKey}` })
      expect(harness.getTask()).toMatchObject({ status: 'done', apiModel, apiProfileId: original.id })
      expect(settings.profiles[0].model).toBe('current-model')
    },
  )

  it.each([
    ['echo', 1],
    ['echo', 2],
    ['whitespace', 1],
    ['unwrapped', 1],
    ['rewrite', 1],
    ['mixed', 2],
    ['missing', 1],
  ] as const)('classifies Responses %s with %i request(s) against the exact sent text', async (kind, n) => {
    const profile = createDefaultOpenAIProfile({ id: 'responses', apiMode: 'responses', apiKey: 'test-key' })
    const settings = { ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id }
    const showCodexCliPrompt = vi.fn()
    const reference = 'data:image/png;base64,YQ=='
    const expectedText =
      'Use the following text as the complete prompt. Do not rewrite it:\nKeep [image 1] unchanged.\n\nTechnical output requirement (not visible text): expected image resolution 1024x1024 px.'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.input[0].content[0]).toEqual({ type: 'input_text', text: expectedText })
      const rewrite = kind === 'rewrite' || (kind === 'mixed' && fetchMock.mock.calls.length === 2)
      const revised =
        kind === 'missing'
          ? undefined
          : rewrite
            ? 'changed text'
            : kind === 'unwrapped'
              ? expectedText.slice(expectedText.indexOf('\n') + 1)
              : kind === 'whitespace'
                ? `\n${expectedText}  `
                : body.input[0].content[0].text
      return new Response(
        JSON.stringify({ output: [{ type: 'image_generation_call', result: 'AA==', revised_prompt: revised }] }),
      )
    })
    const task = createTask({
      apiProfileId: profile.id,
      apiMode: profile.apiMode,
      prompt: `Keep ${getSelectedImageMentionLabel(0)} unchanged.`,
      params: { ...DEFAULT_PARAMS, n, size: '1024x1024' },
      inputImageIds: ['ref'],
    })
    const harness = createHarness(
      task,
      { callImageApi: requestImage, showCodexCliPrompt, ensureImageCached: async () => reference },
      settings,
    )
    await harness.service.execute(task.id)
    expect(fetchMock).toHaveBeenCalledTimes(n)
    expect(harness.getTask()).toMatchObject({ status: 'done', prompt: task.prompt })
    expect(harness.getTask()).not.toHaveProperty('submittedPrompt')
    if (kind === 'rewrite' || kind === 'mixed') expect(showCodexCliPrompt).toHaveBeenCalledExactlyOnceWith()
    else if (kind === 'missing')
      expect(showCodexCliPrompt).toHaveBeenCalledExactlyOnceWith(false, '接口没有返回官方 API 会返回的部分信息')
    else expect(showCodexCliPrompt).not.toHaveBeenCalled()
  })

  it('does not start the watchdog until image preparation finishes', async () => {
    const scheduleWatchdog = vi.fn()
    let prepared!: () => void
    const preparePayload: NonNullable<TaskExecutionDependencies['preparePayload']> = (dataUrls, maskDataUrl) =>
      new Promise((resolve) => {
        prepared = () =>
          resolve({
            dataUrls,
            maskDataUrl,
            originalBytes: 0,
            payloadBytes: 0,
            compressedCount: 0,
            pass: 'none',
            notice: '',
          })
      })
    const harness = createHarness(createTask(), { scheduleWatchdog, preparePayload })
    const execution = harness.service.execute('task-1')
    expect(scheduleWatchdog).not.toHaveBeenCalled()
    prepared()
    await execution
    expect(scheduleWatchdog).toHaveBeenCalledExactlyOnceWith('task-1', DEFAULT_SETTINGS.timeout)
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

  it.each(['fal', 'custom'] as const)(
    'queries an existing %s remote identity instead of submitting it again',
    async (kind) => {
      const callImageApi = vi.fn<NonNullable<TaskExecutionDependencies['callImageApi']>>()
      const scheduleCustomRecovery = vi.fn()
      const task =
        kind === 'fal'
          ? createTask({ apiProvider: 'fal', falRequestId: 'same-id', falEndpoint: 'model' })
          : createTask({ apiProvider: 'custom-provider', customTaskId: 'same-id' })
      const harness = createHarness(task, { callImageApi, scheduleCustomRecovery })
      await harness.service.execute(task.id)
      expect(callImageApi).not.toHaveBeenCalled()
      expect(kind === 'fal' ? harness.scheduleFalRecovery : scheduleCustomRecovery).toHaveBeenCalledWith(task.id)
    },
  )

  it('releases the submit slot as soon as a remote id is known and aborts local polling', async () => {
    const releaseSubmissionSlot = vi.fn()
    const storeGeneratedImage = vi.fn(async () => 'late-image')
    let finish!: (result: { images: string[] }) => void
    let requestSignal: AbortSignal | undefined
    const callImageApi = vi.fn<NonNullable<TaskExecutionDependencies['callImageApi']>>(async (options) => {
      requestSignal = options.signal
      options.onCustomTaskEnqueued?.({ taskId: 'remote-1' })
      return new Promise<{ images: string[] }>((resolve) => {
        finish = resolve
      })
    })
    const harness = createHarness(createTask({ apiProvider: 'custom-provider' }), {
      callImageApi,
      releaseSubmissionSlot,
      storeGeneratedImage,
    })
    const running = harness.service.execute('task-1')
    await vi.waitFor(() => expect(releaseSubmissionSlot).toHaveBeenCalledWith('task-1'))
    expect(harness.getTask().customTaskId).toBe('remote-1')
    harness.service.cancel('task-1')
    await running
    expect(requestSignal?.aborted).toBe(true)
    finish({ images: ['late'] })
    await Promise.resolve()
    expect(storeGeneratedImage).not.toHaveBeenCalled()
    expect(harness.getTask().status).toBe('running')
    expect(harness.showToast).not.toHaveBeenCalled()
  })

  it('has a finite independent polling budget and preserves the remote identity', async () => {
    vi.useFakeTimers()
    const harness = createHarness(createTask({ apiProvider: 'custom-provider' }), {
      callImageApi: vi.fn<NonNullable<TaskExecutionDependencies['callImageApi']>>(async (options) => {
        options.onCustomTaskEnqueued?.({ taskId: 'remote-1' })
        return new Promise<never>(() => undefined)
      }),
    })
    const running = harness.service.execute('task-1')
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    await running
    expect(harness.getTask()).toMatchObject({ status: 'error', customTaskId: 'remote-1', customRecoverable: true })
    expect(harness.getTask().error).toContain('超时')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['fal', 'save'],
    ['fal', 'metadata'],
    ['custom', 'save'],
    ['custom', 'metadata'],
  ] as const)('%s 在 %s 阶段超时后暂停查询，保留远端 ID 且忽略迟到结果', async (kind, phase) => {
    vi.useFakeTimers()
    let finishWrite!: (id: string) => void
    let finishMetadata!: (values: Array<Partial<TaskParams> | undefined>) => void
    const storeGeneratedImage = vi.fn(() =>
      phase === 'save'
        ? new Promise<string>((resolve) => {
            finishWrite = resolve
          })
        : Promise.resolve('saved-image'),
    )
    const readMetadata = vi.fn(() =>
      phase === 'metadata'
        ? new Promise<Array<Partial<TaskParams> | undefined>>((resolve) => {
            finishMetadata = resolve
          })
        : Promise.resolve([]),
    )
    const cacheImage = vi.fn()
    const scheduleCustomRecovery = vi.fn()
    const callImageApi = vi.fn<NonNullable<TaskExecutionDependencies['callImageApi']>>(async (options) => {
      if (kind === 'fal') options.onFalRequestEnqueued?.({ requestId: 'remote-1', endpoint: 'model' })
      else options.onCustomTaskEnqueued?.({ taskId: 'remote-1' })
      return { images: ['data'], actualParamsList: [{ size: '512x512' }] }
    })
    const harness = createHarness(createTask({ apiProvider: kind === 'fal' ? 'fal' : 'custom-provider' }), {
      callImageApi,
      storeGeneratedImage,
      cacheImage,
      resolveImageSizeParamsList: readMetadata,
      readImageSizeParamsList: readMetadata,
      scheduleCustomRecovery,
    })
    const running = harness.service.execute('task-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(phase === 'save' ? storeGeneratedImage : readMetadata).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(harness.getTask()).toMatchObject({ status: 'error', recoveryPausedReason: 'timeout', outputImages: [] })
    expect(harness.getTask()).toMatchObject(
      kind === 'fal'
        ? { falRequestId: 'remote-1', falEndpoint: 'model', falRecoverable: true }
        : { customTaskId: 'remote-1', customRecoverable: true },
    )
    expect(canResumeTaskRecovery(harness.getTask())).toBe(true)
    await running
    const cacheCalls = cacheImage.mock.calls.length
    if (phase === 'save') finishWrite('late-id')
    else finishMetadata([{ size: '512x512' }])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cacheImage).toHaveBeenCalledTimes(cacheCalls)
    expect(harness.getTask().status).toBe('error')
    expect(harness.showToast).not.toHaveBeenCalled()
    expect(harness.scheduleFalRecovery).not.toHaveBeenCalled()
    expect(scheduleCustomRecovery).not.toHaveBeenCalled()
    expect(callImageApi).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('元数据读取中取消后不发布失败、完成或恢复任务', async () => {
    vi.useFakeTimers()
    let finish!: (values: []) => void
    const readImageSizeParamsList = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve
        }),
    )
    const scheduleCustomRecovery = vi.fn()
    const harness = createHarness(createTask({ apiProvider: 'custom-provider' }), {
      callImageApi: vi.fn(async (options) => {
        options.onCustomTaskEnqueued?.({ taskId: 'remote-1' })
        return { images: ['data'] }
      }),
      readImageSizeParamsList,
      scheduleCustomRecovery,
    })
    const running = harness.service.execute('task-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(readImageSizeParamsList).toHaveBeenCalledTimes(1)
    harness.service.cancelAll()
    await running
    finish([])
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(harness.getTask().status).toBe('running')
    expect(harness.showToast).not.toHaveBeenCalled()
    expect(scheduleCustomRecovery).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['save', 'metadata'] as const)('删除任务后忽略 %s 阶段的超时和迟到结果', async (phase) => {
    vi.useFakeTimers()
    let finish!: () => void
    const storeGeneratedImage = vi.fn(() =>
      phase === 'save'
        ? new Promise<string>((resolve) => {
            finish = () => resolve('late-id')
          })
        : Promise.resolve('saved-image'),
    )
    const readImageSizeParamsList = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          finish = () => resolve([])
        }),
    )
    const cacheImage = vi.fn()
    const scheduleCustomRecovery = vi.fn()
    const harness = createHarness(createTask({ apiProvider: 'custom-provider' }), {
      callImageApi: vi.fn(async (options) => {
        options.onCustomTaskEnqueued?.({ taskId: 'remote-1' })
        return { images: ['data'] }
      }),
      storeGeneratedImage,
      cacheImage,
      readImageSizeParamsList,
      scheduleCustomRecovery,
    })
    const running = harness.service.execute('task-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(phase === 'save' ? storeGeneratedImage : readImageSizeParamsList).toHaveBeenCalledTimes(1)
    const cacheCalls = cacheImage.mock.calls.length
    harness.removeTask()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    await running
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.getTask()).toBeUndefined()
    expect(cacheImage).toHaveBeenCalledTimes(cacheCalls)
    expect(harness.showToast).not.toHaveBeenCalled()
    expect(harness.setDetailTaskId).not.toHaveBeenCalled()
    expect(scheduleCustomRecovery).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start an API call after cancellation during payload preparation', async () => {
    let finish!: () => void
    const callImageApi = vi.fn<NonNullable<TaskExecutionDependencies['callImageApi']>>()
    const harness = createHarness(createTask(), {
      callImageApi,
      preparePayload: () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ dataUrls: [], originalBytes: 0, payloadBytes: 0, compressedCount: 0, pass: 'none', notice: '' })
        }),
    })
    const running = harness.service.execute('task-1')
    harness.service.cancelAll()
    await running
    finish()
    await Promise.resolve()
    expect(callImageApi).not.toHaveBeenCalled()
    expect(harness.getTask().status).toBe('running')
  })

  it('suppresses cache and task publication after cancellation during an already-issued disk write', async () => {
    let finish!: (id: string) => void
    const cacheImage = vi.fn()
    const storeGeneratedImage = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const harness = createHarness(createTask(), { storeGeneratedImage, cacheImage })
    const running = harness.service.execute('task-1')
    await vi.waitFor(() => expect(storeGeneratedImage).toHaveBeenCalledTimes(1))
    harness.service.cancelAll()
    finish('late-id')
    await running
    expect(cacheImage).not.toHaveBeenCalled()
    expect(harness.getTask().status).toBe('running')
    expect(harness.showToast).not.toHaveBeenCalled()
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
