import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import {
  canResumeTaskRecovery,
  isTaskReconnecting,
  firstActualParams,
  mapActualParamsByImage,
  shouldRecoverCustomTask,
  shouldRecoverFalTask,
} from './taskRecovery'

describe('task recovery helpers', () => {
  it('selects and maps actual image parameters', () => {
    expect(firstActualParams([undefined, { size: '1024x1024' }])).toEqual({ size: '1024x1024' })
    expect(mapActualParamsByImage(['a', 'b'], [undefined, { size: '2k' }])).toEqual({ b: { size: '2k' } })
    expect(mapActualParamsByImage(['a'], [undefined])).toBeUndefined()
  })

  it.each(['missing-profile', 'missing-poll', 'timeout'] as const)(
    'shows %s as paused, not reconnecting, while allowing the same remote task to resume',
    (recoveryPausedReason) => {
      const custom = {
        status: 'error',
        customTaskId: 'remote',
        customRecoverable: true,
        recoveryPausedReason,
      } as TaskRecord
      const fal = {
        status: 'error',
        apiProvider: 'fal',
        falRequestId: 'remote',
        falEndpoint: 'model',
        falRecoverable: true,
        recoveryPausedReason,
      } as TaskRecord
      expect(isTaskReconnecting(custom)).toBe(false)
      expect(isTaskReconnecting(fal)).toBe(false)
      expect(canResumeTaskRecovery(custom)).toBe(true)
      expect(canResumeTaskRecovery(fal)).toBe(true)
      if (recoveryPausedReason === 'timeout') {
        expect(shouldRecoverCustomTask(custom)).toBe(false)
        expect(shouldRecoverFalTask(fal)).toBe(false)
      }
      expect(isTaskReconnecting({ ...custom, recoveryPausedReason: undefined })).toBe(true)
      expect(canResumeTaskRecovery({ ...custom, customTaskId: undefined })).toBe(false)
    },
  )

  it('identifies recoverable fal and custom tasks', () => {
    expect(shouldRecoverFalTask({ apiProvider: 'fal', falRequestId: 'r', falEndpoint: 'e', status: 'error' })).toBe(
      false,
    )
    expect(
      shouldRecoverFalTask({
        apiProvider: 'fal',
        falRequestId: 'r',
        falEndpoint: 'e',
        status: 'error',
        falRecoverable: true,
      }),
    ).toBe(true)
    expect(shouldRecoverCustomTask({ customTaskId: 'c', status: 'running' })).toBe(true)
    expect(shouldRecoverCustomTask({ customTaskId: 'c', status: 'error' })).toBe(false)
  })
})
