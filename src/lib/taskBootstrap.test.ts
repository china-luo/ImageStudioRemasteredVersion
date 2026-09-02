import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { markInterruptedOpenAIRunningTasks, OPENAI_INTERRUPTED_ERROR } from './taskBootstrap'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    prompt: 'product photo',
    params: {
      size: '1024x1024',
      quality: 'auto',
      output_format: 'jpeg',
      output_compression: 70,
      moderation: 'auto',
      n: 1,
    },
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

describe('task bootstrap', () => {
  it('marks interrupted OpenAI tasks as errors and preserves other tasks', () => {
    const running = task({ id: 'openai-running', apiProvider: 'openai' })
    const fal = task({ id: 'fal-running', apiProvider: 'fal' })
    const done = task({ id: 'done', status: 'done', finishedAt: 200 })

    const result = markInterruptedOpenAIRunningTasks([running, fal, done], 500)

    expect(result.tasks[0]).toMatchObject({
      id: 'openai-running',
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      finishedAt: 500,
      elapsed: 400,
    })
    expect(result.tasks[1]).toBe(fal)
    expect(result.tasks[2]).toBe(done)
    expect(result.interruptedTasks).toEqual([result.tasks[0]])
  })

  it('does not interrupt recoverable custom tasks', () => {
    const custom = task({ apiProvider: 'custom-provider', customTaskId: 'queue-1' })
    const result = markInterruptedOpenAIRunningTasks([custom], 500)
    expect(result.tasks[0]).toBe(custom)
    expect(result.interruptedTasks).toHaveLength(0)
  })
})
