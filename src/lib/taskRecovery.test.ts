import { describe, expect, it } from 'vitest'
import {
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
