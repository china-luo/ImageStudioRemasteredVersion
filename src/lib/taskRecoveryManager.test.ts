import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile, AppSettings, TaskRecord } from '../types'
import { createTaskRecoveryManager } from './taskRecoveryManager'

const mocks = vi.hoisted(() => ({ getCustomQueuedImageResult: vi.fn() }))

vi.mock('./openaiCompatibleImageApi', () => ({ getCustomQueuedImageResult: mocks.getCustomQueuedImageResult }))
vi.mock('./falAiImageApi', () => ({
  getFalErrorMessage: () => null,
  getFalQueuedImageResult: vi.fn(),
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

describe('task recovery manager', () => {
  beforeEach(() => {
    mocks.getCustomQueuedImageResult.mockReset()
  })

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

    expect(mocks.getCustomQueuedImageResult).toHaveBeenCalledWith(profile, expect.any(Object), 'remote-1', task.params)
    expect(updateTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({ status: 'done', outputImages: ['stored-result'], customRecoverable: false }),
    )
    expect(state.showToast).toHaveBeenCalledWith('自定义异步任务已恢复，共 1 张图片', 'success')
  })
})
