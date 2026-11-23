import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'
import { isPlannerTaskFailed, isPlannerTaskPending } from './plannerTaskSafety'

const task = (overrides: Partial<TaskRecord>): TaskRecord => ({
  id: '任务',
  prompt: '',
  params: DEFAULT_PARAMS,
  inputImageIds: [],
  outputImages: [],
  status: 'error',
  error: null,
  createdAt: 1,
  finishedAt: null,
  elapsed: null,
  ...overrides,
})

describe('策划图片位提交保护', () => {
  it.each([
    { status: 'running' as const },
    { customTaskId: '远端任务', customRecoverable: true },
    { apiProvider: 'fal' as const, falRequestId: '远端任务', falEndpoint: '端点', falRecoverable: true },
    { customTaskId: '远端任务', customRecoverable: true, recoveryPausedReason: 'timeout' as const },
    { recoveryPausedReason: 'missing-profile' as const },
    { recoveryPausedReason: 'missing-poll' as const },
  ])('仍在生成、重连或暂停的任务不能重复提交：%j', (overrides) => {
    expect(isPlannerTaskPending(task(overrides))).toBe(true)
    expect(isPlannerTaskFailed(task(overrides))).toBe(false)
  })

  it('完成及真正终态失败允许主动生成新版本', () => {
    expect(isPlannerTaskPending(task({ status: 'done' }))).toBe(false)
    expect(isPlannerTaskFailed(task({ status: 'done' }))).toBe(false)
    expect(isPlannerTaskPending(task({ customTaskId: '已失败', customRecoverable: false }))).toBe(false)
    expect(isPlannerTaskFailed(task({ customTaskId: '已失败', customRecoverable: false }))).toBe(true)
    expect(isPlannerTaskFailed(undefined)).toBe(false)
  })
})
