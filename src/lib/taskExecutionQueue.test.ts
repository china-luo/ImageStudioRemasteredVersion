import { describe, expect, it, vi } from 'vitest'
import { createTaskExecutionQueue } from './taskExecutionQueue'

describe('task execution queue', () => {
  it('limits concurrent work and drains pending tasks', async () => {
    const queue = createTaskExecutionQueue(2)
    const resolvers: Array<() => void> = []
    const run = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)))
    queue.enqueue('a', run)
    queue.enqueue('b', run)
    queue.enqueue('c', run)
    expect(queue.snapshot()).toEqual({ active: ['a', 'b'], pending: ['c'] })
    resolvers[0]()
    await vi.waitFor(() => expect(queue.snapshot().active).toContain('c'))
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('releases a remote polling slot without submitting the same task twice', () => {
    const queue = createTaskExecutionQueue(1)
    const run = vi.fn(() => new Promise<void>(() => undefined))
    queue.enqueue('remote', run)
    queue.enqueue('next', run)
    queue.release('remote')
    queue.enqueue('remote', run)
    expect(queue.snapshot()).toEqual({ active: ['next'], pending: [] })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('cancels pending work, releases active slots and ignores old same-id completions', async () => {
    const queue = createTaskExecutionQueue(1)
    let finishOld!: () => void
    queue.enqueue(
      'same',
      () =>
        new Promise<void>((resolve) => {
          finishOld = resolve
        }),
    )
    const pending = vi.fn(async () => undefined)
    queue.enqueue('pending', pending)
    queue.cancelAll()
    expect(queue.snapshot()).toEqual({ active: [], pending: [] })
    queue.enqueue('same', () => new Promise<void>(() => undefined))
    finishOld()
    await Promise.resolve()
    await Promise.resolve()
    expect(queue.snapshot()).toEqual({ active: ['same'], pending: [] })
    expect(pending).not.toHaveBeenCalled()
    queue.cancel('same')
    expect(queue.snapshot()).toEqual({ active: [], pending: [] })
  })

  it('deduplicates the same task id', () => {
    const queue = createTaskExecutionQueue(1)
    const run = () => new Promise<void>(() => undefined)
    queue.enqueue('a', run)
    queue.enqueue('a', run)
    expect(queue.snapshot()).toEqual({ active: ['a'], pending: [] })
  })
})
