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

function images(count: number) {
  return Array.from({ length: count }, (_, index) => `image-${index + 1}`)
}

describe('support prompt trigger policy', () => {
  it('uses a production milestone of ten successful images', () => {
    expect(SUPPORT_PROMPT_IMAGE_THRESHOLD).toBe(10)
  })

  it('does not open before reaching the next ten-image milestone', () => {
    const history = task({ id: 'history', status: 'done', outputImages: images(8) })
    const previous = [history, task()]
    const next = [history, task({ status: 'done', outputImages: ['image-9'] })]

    expect(shouldOpenSupportPromptForTaskCompletion(previous, next, 'task-a')).toBe(false)
  })

  it('opens when the total reaches ten successful images', () => {
    const history = task({ id: 'history', status: 'done', outputImages: images(9) })
    const previous = [history, task()]
    const next = [history, task({ status: 'done', outputImages: ['image-10'] })]

    expect(shouldOpenSupportPromptForTaskCompletion(previous, next, 'task-a')).toBe(true)
  })

  it('waits for the next milestone after the total has passed ten', () => {
    const history = task({ id: 'history', status: 'done', outputImages: images(10) })
    const previous = [history, task()]
    const next = [history, task({ status: 'done', outputImages: ['image-11'] })]

    expect(shouldOpenSupportPromptForTaskCompletion(previous, next, 'task-a')).toBe(false)
  })

  it('opens again when the total reaches twenty successful images', () => {
    const history = task({ id: 'history', status: 'done', outputImages: images(19) })
    const previous = [history, task()]
    const next = [history, task({ status: 'done', outputImages: ['image-20'] })]

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

  it('opens once when a batch result crosses a milestone', () => {
    const history = task({ id: 'history', status: 'done', outputImages: images(8) })
    const previous = [history, task()]
    const next = [history, task({ status: 'done', outputImages: ['image-9', 'image-10', 'image-11'] })]

    expect(shouldOpenSupportPromptForTaskCompletion(previous, next, 'task-a')).toBe(true)
  })
})
