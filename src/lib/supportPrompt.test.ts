import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import {
  SUPPORT_PROMPT_IMAGE_THRESHOLD,
  shouldOpenSupportPromptForTaskCompletion,
} from './supportPrompt'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'test',
    params: {
      size: 'auto',
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
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
    ...overrides,
  }
}

describe('support prompt trigger policy', () => {
  it('opens when the first successful output reaches the test threshold', () => {
    const previous = [task()]
    const next = [task({ status: 'done', outputImages: ['image-a'] })]

    expect(SUPPORT_PROMPT_IMAGE_THRESHOLD).toBe(1)
    expect(shouldOpenSupportPromptForTaskCompletion(previous, next, 'task-a')).toBe(true)
  })

  it('opens on the next success when existing history already meets the threshold', () => {
    const history = task({ id: 'history', status: 'done', outputImages: ['old-image'] })
    const previous = [history, task()]
    const next = [history, task({ status: 'done', outputImages: ['new-image'] })]

    expect(shouldOpenSupportPromptForTaskCompletion(previous, next, 'task-a')).toBe(true)
  })

  it.each([
    ['failed task', task({ status: 'error' })],
    ['empty done task', task({ status: 'done', outputImages: [] })],
    ['Agent task', task({ status: 'done', outputImages: ['image-a'], sourceMode: 'agent' })],
  ])('does not open for a %s', (_label, nextTask) => {
    expect(shouldOpenSupportPromptForTaskCompletion([task()], [nextTask], 'task-a')).toBe(false)
  })

  it('does not open when a completed task is updated again', () => {
    const done = task({ status: 'done', outputImages: ['image-a'] })

    expect(shouldOpenSupportPromptForTaskCompletion([done], [done], 'task-a')).toBe(false)
  })

  it('opens once when a batch result crosses the threshold', () => {
    const previous = [task()]
    const next = [task({ status: 'done', outputImages: ['image-a', 'image-b'] })]

    expect(shouldOpenSupportPromptForTaskCompletion(previous, next, 'task-a')).toBe(true)
  })
})
