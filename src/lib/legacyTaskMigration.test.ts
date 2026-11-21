import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { migrateLegacyTaskStreamFields } from './legacyTaskMigration'

function createTask(): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: ['input-1'],
    outputImages: ['output-1'],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

describe('migrateLegacyTaskStreamFields', () => {
  it('removes legacy intermediate image ids without changing final image references', () => {
    const source = {
      ...createTask(),
      streamPartialImageIds: ['partial-1', 'partial-2'],
    } as TaskRecord

    const result = migrateLegacyTaskStreamFields(source)

    expect(result.changed).toBe(true)
    expect(result.removedImageIds).toEqual(['partial-1', 'partial-2'])
    expect(result.task.inputImageIds).toEqual(['input-1'])
    expect(result.task.outputImages).toEqual(['output-1'])
    expect(result.task).not.toHaveProperty('streamPartialImageIds')
    expect(source).toHaveProperty('streamPartialImageIds')
  })

  it('returns current tasks unchanged', () => {
    const task = createTask()
    expect(migrateLegacyTaskStreamFields(task)).toEqual({
      task,
      removedImageIds: [],
      changed: false,
    })
  })
})
